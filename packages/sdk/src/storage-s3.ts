/**
 * S3-compatible object storage for @power/sdk.
 *
 * The fs driver in index.ts proves the `Storage` interface; this is the driver
 * a deployed app actually runs on. It speaks the S3 REST API directly with
 * `fetch` and `node:crypto` rather than pulling in @aws-sdk, because four
 * operations and one signature are a page of code, and the SDK is a large
 * dependency tree to audit and keep current for that page. Signature Version 4
 * is a published, frozen algorithm, so the maintenance argument that usually
 * favours a vendor SDK does not apply.
 *
 * Every S3-compatible provider is reachable from here: endpoint, region and
 * addressing style are configuration, so Cloudflare R2, Backblaze B2 and MinIO
 * work with the same code path as AWS.
 *
 * The secret access key is used only as HMAC input. It is never put in a thrown
 * message, a URL that is returned, or a log line, so a stack trace that reaches
 * a user or a log aggregator cannot leak it. Provider response bodies are not
 * forwarded to callers either: they quote request details back, and the status
 * code is what a caller can act on.
 */
import { createHash, createHmac } from 'node:crypto';
import type { Storage } from './index.js';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const EMPTY_PAYLOAD_SHA256 = createHash('sha256').update('').digest('hex');

/**
 * A presigned GET is signed without knowing the body, which is exactly what
 * this literal tells S3. It is part of the signed string, not a placeholder.
 */
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

/**
 * Duplicated from index.ts, which does not export its cap. Both drivers must
 * refuse to mint a URL that outlives fifteen minutes, so if that number ever
 * moves, it has to move in both places; a signed URL is a bearer credential and
 * the fs driver's promise about its lifetime is the one callers rely on.
 */
const MAX_SIGNED_URL_TTL = 15 * 60;

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Base URL of the provider, e.g. `https://<account>.r2.cloudflarestorage.com`. */
  endpoint: string;
  /** `https://host/bucket/key` instead of `https://bucket.host/key`. */
  forcePathStyle: boolean;
  /**
   * Set when the credentials are temporary, which is the normal case for a
   * hosted deployment: an instance role or any `sts:AssumeRole` hands back a
   * key, a secret and this token, and S3 rejects the first two on their own
   * with an opaque InvalidAccessKeyId. Long-lived keys leave it undefined.
   */
  sessionToken?: string;
}

export interface S3StorageOptions {
  /** Injected by tests. Defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Injected by tests so a signature has a fixed, assertable input. */
  now?: () => Date;
}

/**
 * Reads the same variable names the exported `.env` documents. Region falls
 * back to `auto` only when a custom endpoint is set: R2 requires exactly that
 * value and has no meaningful region, while on AWS a wrong region produces a
 * confusing 400 from the wrong host, so there the variable stays mandatory.
 */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv): S3Config {
  const endpointVar = env.S3_ENDPOINT?.trim();
  const bucket = required(env, 'S3_BUCKET');
  const region = endpointVar ? (env.S3_REGION?.trim() || 'auto') : required(env, 'S3_REGION');
  return {
    bucket,
    region,
    accessKeyId: required(env, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: required(env, 'S3_SECRET_ACCESS_KEY'),
    endpoint: endpointVar || `https://s3.${region}.amazonaws.com`,
    // Virtual-host style is right for AWS and is what its DNS is built for, but
    // a self-hosted MinIO or a plain IP endpoint has no wildcard DNS to put a
    // bucket name in front of. So a custom endpoint defaults to path style and
    // the variable is there for the providers that want the other one.
    forcePathStyle: env.S3_FORCE_PATH_STYLE
      ? /^(1|true|yes)$/i.test(env.S3_FORCE_PATH_STYLE.trim())
      : Boolean(endpointVar),
    // AWS_SESSION_TOKEN is read too because that is the name the SDKs and the
    // instance metadata service already use, so a role-based deployment works
    // with the variables it is given rather than needing them renamed.
    ...(env.S3_SESSION_TOKEN?.trim() || env.AWS_SESSION_TOKEN?.trim()
      ? { sessionToken: (env.S3_SESSION_TOKEN?.trim() || env.AWS_SESSION_TOKEN?.trim())! }
      : {}),
  };
}

export function s3Storage(config: S3Config, options: S3StorageOptions = {}): Storage {
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());

  const send = async (
    method: 'PUT' | 'GET' | 'DELETE',
    key: string,
    body?: Uint8Array,
    contentType?: string,
  ): Promise<Response> => {
    const target = resolve(config, key);
    const date = now();
    const payloadHash = body ? createHash('sha256').update(body).digest('hex') : EMPTY_PAYLOAD_SHA256;
    // Every header here is signed, and the date is signed with the rest on
    // purpose: S3 refuses a request whose `x-amz-*` headers are not covered by
    // SignedHeaders, so adding the date after signing would 403 every call.
    const headers: Record<string, string> = {
      host: target.host,
      'x-amz-date': amzDate(date),
      // S3 rejects an unsigned-payload header on a normal request, and this is
      // also what makes the body tamper-evident in transit.
      'x-amz-content-sha256': payloadHash,
    };
    if (contentType) headers['content-type'] = contentType;
    // Signed with the rest, not added afterwards: S3 requires every x-amz-*
    // header to be covered by SignedHeaders, so a token attached after signing
    // would 403 every call.
    if (config.sessionToken) headers['x-amz-security-token'] = config.sessionToken;

    const signed = signV4({
      method,
      path: target.path,
      query: [],
      headers,
      payloadHash,
      date,
      region: config.region,
      service: 's3',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });

    return doFetch(`${target.origin}${target.path}`, {
      method,
      headers: { ...headers, authorization: signed.authorization },
      ...(body ? { body } : {}),
    });
  };

  return {
    async put(key, body, contentType) {
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
      const res = await send('PUT', key, bytes, contentType);
      if (!res.ok) throw failure('put', key, res.status);
      return { key };
    },

    async get(key) {
      const res = await send('GET', key);
      // Absent is not an error, because the fs driver returns null for a missing
      // object and app code written against one driver has to work on the other.
      if (res.status === 404) return null;
      if (!res.ok) throw failure('get', key, res.status);
      return new Uint8Array(await res.arrayBuffer());
    },

    async delete(key) {
      const res = await send('DELETE', key);
      // S3 answers 204 for a key that was never there, and so must we: delete
      // is idempotent in the interface and callers retry it.
      if (!res.ok && res.status !== 404) throw failure('delete', key, res.status);
    },

    async signedUrl(key, ttlSeconds = MAX_SIGNED_URL_TTL) {
      return presignGetUrl(config, key, Math.min(ttlSeconds, MAX_SIGNED_URL_TTL), now());
    },
  };
}

/**
 * A browser-fetchable GET URL, signed in the query string so no header is
 * needed. Headers other than `host` are deliberately not signed: a browser
 * sends its own, and signing one it will not reproduce turns every link into a
 * 403.
 */
export function presignGetUrl(config: S3Config, key: string, expiresSeconds: number, date: Date): string {
  const target = resolve(config, key);
  const stamp = amzDate(date);
  const query: Array<[string, string]> = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${config.accessKeyId}/${stamp.slice(0, 8)}/${config.region}/s3/aws4_request`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(Math.max(1, Math.floor(expiresSeconds)))],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  // On a presigned URL the token travels in the query string and has to be
  // part of what is signed, which is why it goes in before signV4 rather than
  // being appended next to the signature.
  if (config.sessionToken) query.push(['X-Amz-Security-Token', config.sessionToken]);

  const signed = signV4({
    method: 'GET',
    path: target.path,
    query,
    headers: { host: target.host },
    payloadHash: UNSIGNED_PAYLOAD,
    date,
    region: config.region,
    service: 's3',
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });

  const withSignature = canonicalQuery([...query, ['X-Amz-Signature', signed.signature]]);
  return `${target.origin}${target.path}?${withSignature}`;
}

// ---------------------------------------------------------------- signature v4

export interface SignV4Input {
  method: string;
  /**
   * The percent-encoded path exactly as it goes on the wire. S3 signs the path
   * as sent and must not encode it a second time, unlike every other AWS
   * service, which is the classic cause of a signature that fails only for keys
   * containing a space or a plus.
   */
  path: string;
  query: Array<[string, string]>;
  /** Header names in any case; `host` is required. Values are trimmed for signing. */
  headers: Record<string, string>;
  payloadHash: string;
  date: Date;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SignV4Result {
  authorization: string;
  amzDate: string;
  signature: string;
  /** Returned so tests can pin the intermediate values, not for callers. */
  canonicalRequest: string;
  stringToSign: string;
}

export function signV4(input: SignV4Input): SignV4Result {
  const stamp = amzDate(input.date);
  const dateStamp = stamp.slice(0, 8);

  const entries = Object.entries(input.headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = entries.map(([name]) => name).join(';');

  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery(input.query),
    `${entries.map(([name, value]) => `${name}:${value}`).join('\n')}\n`,
    signedHeaders,
    input.payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');

  // The four-step key: each HMAC takes the previous digest as its key, so the
  // derived key is scoped to one date, region and service and a leaked
  // signature cannot be replayed outside that scope.
  let key = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  key = hmac(key, input.region);
  key = hmac(key, input.service);
  key = hmac(key, 'aws4_request');
  const signature = hmac(key, stringToSign).toString('hex');

  return {
    authorization: `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate: stamp,
    signature,
    canonicalRequest,
    stringToSign,
  };
}

/**
 * RFC 3986 encoding, which is not what encodeURIComponent does: it leaves
 * `!'()*` alone, and S3 expects those escaped. A key named `it's (final).pdf`
 * is the kind of thing that then fails only in production.
 */
function uriEncode(value: string, encodeSlash = true): string {
  let out = '';
  for (const char of value) {
    if (/[A-Za-z0-9\-._~]/.test(char)) {
      out += char;
    } else if (char === '/' && !encodeSlash) {
      out += char;
    } else {
      for (const byte of new TextEncoder().encode(char)) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
  }
  return out;
}

/** Sorted by encoded name, then encoded value, as the canonical form requires. */
function canonicalQuery(query: Array<[string, string]>): string {
  return query
    .map(([name, value]) => [uriEncode(name), uriEncode(value)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

function amzDate(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const hmac = (key: string | Buffer, value: string): Buffer =>
  createHmac('sha256', key).update(value, 'utf8').digest();

// ---------------------------------------------------------------- addressing

interface Target {
  origin: string;
  host: string;
  path: string;
}

function resolve(config: S3Config, key: string): Target {
  const endpoint = new URL(config.endpoint);
  const prefix = endpoint.pathname.replace(/\/+$/, '');
  const encodedKey = uriEncode(validateKey(key), false);
  if (config.forcePathStyle) {
    return {
      origin: endpoint.origin,
      host: endpoint.host,
      path: `${prefix}/${uriEncode(config.bucket)}/${encodedKey}`,
    };
  }
  const host = `${config.bucket}.${endpoint.host}`;
  return { origin: `${endpoint.protocol}//${host}`, host, path: `${prefix}/${encodedKey}` };
}

/**
 * The same keys the fs driver rejects, rejected here with the same message.
 * S3 has no filesystem to escape from, but an app written against one driver
 * must behave identically on the other, and a key with a `..` segment is a hole
 * waiting for the day its objects are mirrored onto a disk.
 */
function validateKey(key: string): string {
  const segments = key.split('/');
  if (!key || key.startsWith('/') || segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`invalid storage key: ${key}`);
  }
  return key;
}

function failure(operation: string, key: string, status: number): Error {
  // The provider's XML body is not included on purpose: it echoes request
  // details back, and this message travels into app logs and error pages.
  return new Error(`s3: ${operation} of ${JSON.stringify(key)} failed with status ${status}`);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Inside Power it is injected automatically; self-hosted, copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}
