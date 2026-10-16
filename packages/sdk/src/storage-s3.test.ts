/**
 * The signature tests are the point of this file. Everything else about an
 * object store fails loudly, but a wrong signature fails as a flat 403 with no
 * hint about which of the canonical request's lines was wrong, so the exact
 * Authorization header for fixed inputs is pinned here against AWS's own
 * published vectors. A refactor that changes signing has to change these
 * strings, and changing them means proving the new value against AWS again.
 */
import { describe, expect, it } from 'vitest';
import {
  presignGetUrl,
  s3ConfigFromEnv,
  s3Storage,
  signV4,
  type S3Config,
} from './storage-s3.js';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Cloudflare R2 shaped: custom endpoint, path style, region `auto`. */
const r2: S3Config = {
  bucket: 'assets',
  region: 'auto',
  accessKeyId: 'AKEXAMPLE',
  secretAccessKey: 'tops3cret-never-in-output',
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  forcePathStyle: true,
};

const at = (iso: string) => () => new Date(iso);

// Taken from the global fetch rather than written out, because this package's
// lib is ES2023 with no DOM: `RequestInfo` and `BodyInit` are not in scope, the
// request types come from @types/node, and hand-written ones would drift.
type FetchArgs = Parameters<typeof globalThis.fetch>;
type ResponseBody = ConstructorParameters<typeof Response>[0];

/** A fetch double that records the one request it was given. */
function recorder(respond: () => Response) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
  const fetchDouble = (async (input: FetchArgs[0], init?: FetchArgs[1]) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    });
    return respond();
  }) as typeof globalThis.fetch;
  return { calls, fetchDouble };
}

const ok = (body: ResponseBody = null, status = 200) => () => new Response(body, { status });

describe('signature version 4 matches AWS published test vectors', () => {
  it('signs the get-vanilla vector to the exact documented Authorization header', () => {
    // AWS SigV4 test suite, `get-vanilla`. If this string changes, requests
    // that used to be accepted will start coming back 403 in production with no
    // local test failing, which is the whole reason it is asserted literally.
    const signed = signV4({
      method: 'GET',
      path: '/',
      query: [],
      headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' },
      payloadHash: EMPTY_SHA256,
      date: new Date('2015-08-30T12:36:00Z'),
      region: 'us-east-1',
      service: 'service',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    });

    expect(signed.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('builds the canonical request in the exact byte layout AWS hashes', () => {
    // Pinned separately from the signature because when signing does break,
    // this is the assertion that says which line is wrong. The blank line after
    // the headers block and the trailing newline per header are both load
    // bearing and are the usual mistake.
    const signed = signV4({
      method: 'GET',
      path: '/',
      query: [],
      headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: EMPTY_SHA256,
      date: new Date('2015-08-30T12:36:00Z'),
      region: 'us-east-1',
      service: 'service',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    });

    expect(signed.canonicalRequest).toBe(
      ['GET', '/', '', 'host:example.amazonaws.com', 'x-amz-date:20150830T123600Z', '', 'host;x-amz-date', EMPTY_SHA256].join('\n'),
    );
    expect(signed.stringToSign.split('\n').slice(0, 3)).toEqual([
      'AWS4-HMAC-SHA256',
      '20150830T123600Z',
      '20150830/us-east-1/service/aws4_request',
    ]);
  });

  it('signs the S3 range-GET example, which proves header sorting and casing', () => {
    // AWS S3 docs, "Example: GET Object" with a Range header. Four headers
    // instead of two, so a signer that sorted headers by insertion order rather
    // than by lowercased name would pass the vector above and fail here.
    const signed = signV4({
      method: 'GET',
      path: '/test.txt',
      query: [],
      headers: {
        'X-Amz-Date': '20130524T000000Z',
        Range: 'bytes=0-9',
        Host: 'examplebucket.s3.amazonaws.com',
        'x-amz-content-sha256': EMPTY_SHA256,
      },
      payloadHash: EMPTY_SHA256,
      date: new Date('2013-05-24T00:00:00Z'),
      region: 'us-east-1',
      service: 's3',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });

    expect(signed.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });

  it('sorts repeated query parameters by value, not by the order given', () => {
    // A canonical query string that is not fully sorted is accepted by some
    // S3-compatible servers and rejected by AWS, so this breaks in production
    // only, and only for whichever provider is strict.
    const signed = signV4({
      method: 'GET',
      path: '/',
      query: [
        ['Param1', 'value2'],
        ['Param1', 'value1'],
      ],
      headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: EMPTY_SHA256,
      date: new Date('2015-08-30T12:36:00Z'),
      region: 'us-east-1',
      service: 'service',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    });

    expect(signed.canonicalRequest.split('\n')[2]).toBe('Param1=value1&Param1=value2');
  });
});

describe('presigned GET URLs', () => {
  it('reproduces the documented presigned URL signature exactly', () => {
    // AWS S3 docs, query-string authentication example. Query signing has its
    // own canonical form: the credential's slashes are percent-encoded, the
    // payload is signed as UNSIGNED-PAYLOAD, and only `host` is signed, so a
    // header signer reused here would produce a link that 403s in the browser.
    const url = presignGetUrl(
      {
        bucket: 'examplebucket',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        endpoint: 'https://s3.amazonaws.com',
        forcePathStyle: false,
      },
      'test.txt',
      86_400,
      new Date('2013-05-24T00:00:00Z'),
    );

    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z' +
        '&X-Amz-Expires=86400' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404' +
        '&X-Amz-SignedHeaders=host',
    );
  });

  it('caps the lifetime at fifteen minutes however long the caller asks for', async () => {
    // Same cap as the fs driver. A signed URL is a bearer credential that can
    // be forwarded, so a caller asking for a day must not get one.
    const storage = s3Storage(r2, { fetch: recorder(ok()).fetchDouble, now: at('2024-01-02T03:04:05Z') });
    const url = new URL(await storage.signedUrl('docs/a.txt', 86_400));
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');

    const defaulted = new URL(await storage.signedUrl('docs/a.txt'));
    expect(defaulted.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('never puts the secret key in the URL it hands out', async () => {
    // The whole point of signing is that the holder of the link cannot mint
    // another one. Leaking the key here would hand out the bucket.
    const storage = s3Storage(r2, { fetch: recorder(ok()).fetchDouble, now: at('2024-01-02T03:04:05Z') });
    const url = await storage.signedUrl('docs/a.txt');
    expect(url).not.toContain(r2.secretAccessKey);
    expect(url).toContain('X-Amz-Signature=');
  });
});

describe('the requests the driver actually sends', () => {
  it('signs the date header, so S3 does not reject the request outright', async () => {
    // S3 requires every x-amz-* header present on the wire to be covered by
    // SignedHeaders. Adding x-amz-date after signing is an easy and invisible
    // mistake: it looks correct and 403s every single call.
    const { calls, fetchDouble } = recorder(ok());
    await s3Storage(r2, { fetch: fetchDouble, now: at('2024-01-02T03:04:05Z') }).get('docs/a.txt');

    const headers = calls[0]!.headers;
    expect(headers['x-amz-date']).toBe('20240102T030405Z');
    expect(headers.authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date');
  });

  it('puts the object with its content type and the body hash it signed', async () => {
    // x-amz-content-sha256 must be the hash of the body being sent. If it were
    // the empty hash, or UNSIGNED-PAYLOAD, S3 would reject the upload.
    const { calls, fetchDouble } = recorder(ok());
    const result = await s3Storage(r2, { fetch: fetchDouble, now: at('2024-01-02T03:04:05Z') }).put(
      'docs/a.txt',
      'hello',
      'text/plain',
    );

    expect(result).toEqual({ key: 'docs/a.txt' });
    const call = calls[0]!;
    expect(call.method).toBe('PUT');
    expect(call.url).toBe('https://acct.r2.cloudflarestorage.com/assets/docs/a.txt');
    expect(call.headers['content-type']).toBe('text/plain');
    // sha256('hello')
    expect(call.headers['x-amz-content-sha256']).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(new TextDecoder().decode(call.body as Uint8Array)).toBe('hello');
  });

  it('round-trips bytes and deletes', async () => {
    const { fetchDouble } = recorder(ok('hello'));
    const storage = s3Storage(r2, { fetch: fetchDouble, now: at('2024-01-02T03:04:05Z') });
    expect(new TextDecoder().decode((await storage.get('docs/a.txt'))!)).toBe('hello');
    await expect(storage.delete('docs/a.txt')).resolves.toBeUndefined();
  });

  it('percent-encodes a key the way S3 signs it, not the way encodeURIComponent does', async () => {
    // encodeURIComponent leaves ( ) ' ! * alone and S3 expects them escaped. A
    // mismatch between the path on the wire and the path in the canonical
    // request is a 403 that only appears for keys with punctuation in them, so
    // it survives every test written with tidy key names.
    const { calls, fetchDouble } = recorder(ok());
    await s3Storage(r2, { fetch: fetchDouble, now: at('2024-01-02T03:04:05Z') }).put("docs/it's (final).pdf", 'x');

    expect(calls[0]!.url).toBe("https://acct.r2.cloudflarestorage.com/assets/docs/it%27s%20%28final%29.pdf");
  });

  it('addresses virtual-host style when path style is off', async () => {
    // AWS's own endpoint wants the bucket in the hostname, and the host header
    // is signed, so getting this wrong breaks the signature as well as routing.
    const { calls, fetchDouble } = recorder(ok());
    await s3Storage(
      { ...r2, endpoint: 'https://s3.eu-west-1.amazonaws.com', region: 'eu-west-1', forcePathStyle: false },
      { fetch: fetchDouble, now: at('2024-01-02T03:04:05Z') },
    ).get('docs/a.txt');

    expect(calls[0]!.url).toBe('https://assets.s3.eu-west-1.amazonaws.com/docs/a.txt');
    expect(calls[0]!.headers.host).toBe('assets.s3.eu-west-1.amazonaws.com');
  });

  it('rejects the same keys the fs driver rejects', async () => {
    // An app written against local storage must behave identically here, and a
    // `..` segment becomes a real traversal the moment these objects are
    // mirrored to a disk.
    const storage = s3Storage(r2, { fetch: recorder(ok()).fetchDouble });
    await expect(storage.put('../escape', 'x')).rejects.toThrow(/invalid storage key/);
    await expect(storage.get('/leading')).rejects.toThrow(/invalid storage key/);
    await expect(storage.delete('a//b')).rejects.toThrow(/invalid storage key/);
  });
});

describe('failures say what happened without saying too much', () => {
  it('reads a missing object as null, like the fs driver', async () => {
    // Callers branch on null. If a 404 threw, every app that checks for a
    // missing avatar would crash instead.
    const { fetchDouble } = recorder(ok('<Error><Code>NoSuchKey</Code></Error>', 404));
    expect(await s3Storage(r2, { fetch: fetchDouble }).get('gone.txt')).toBeNull();
  });

  it('treats deleting an absent object as success', async () => {
    // Delete is retried by callers and by queues; a second delete must not
    // raise.
    const { fetchDouble } = recorder(ok(null, 404));
    await expect(s3Storage(r2, { fetch: fetchDouble }).delete('gone.txt')).resolves.toBeUndefined();
  });

  it('never leaks the secret key or the provider body into the error', async () => {
    // This message lands in application logs and sometimes on an error page. S3
    // error bodies quote request details back, and a stack trace is the usual
    // way a credential escapes a process.
    const body = '<Error><Code>SignatureDoesNotMatch</Code><AWSAccessKeyId>AKEXAMPLE</AWSAccessKeyId></Error>';
    const { fetchDouble } = recorder(ok(body, 403));
    const failing = s3Storage(r2, { fetch: fetchDouble, now: at('2024-01-02T03:04:05Z') });

    await expect(failing.put('docs/a.txt', 'x')).rejects.toThrow(/status 403/);
    const message = await failing.put('docs/a.txt', 'x').then(
      () => '',
      (error: Error) => error.message,
    );
    expect(message).not.toContain(r2.secretAccessKey);
    expect(message).not.toContain('AWSAccessKeyId');
    expect(message).toContain('docs/a.txt');
  });
});

describe('configuration from the environment', () => {
  const keys = { S3_ACCESS_KEY_ID: 'AK', S3_SECRET_ACCESS_KEY: 'SK' };

  it('defaults to AWS virtual-host addressing for the region', () => {
    const config = s3ConfigFromEnv({ S3_BUCKET: 'assets', S3_REGION: 'eu-west-1', ...keys });
    expect(config.endpoint).toBe('https://s3.eu-west-1.amazonaws.com');
    expect(config.forcePathStyle).toBe(false);
  });

  it('defaults a custom endpoint to path style and region auto', () => {
    // R2 and MinIO are the common cases: no wildcard DNS for buckets, and R2
    // only accepts the literal region `auto`. Defaulting the other way makes
    // the first self-hosted deploy fail with a DNS error.
    const config = s3ConfigFromEnv({ S3_BUCKET: 'assets', S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', ...keys });
    expect(config.forcePathStyle).toBe(true);
    expect(config.region).toBe('auto');
  });

  it('lets S3_FORCE_PATH_STYLE override either default', () => {
    // Backblaze B2 has a custom endpoint and wants virtual-host style, so the
    // default above has to be overridable in both directions.
    const b2 = s3ConfigFromEnv({
      S3_BUCKET: 'assets',
      S3_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
      S3_FORCE_PATH_STYLE: 'false',
      ...keys,
    });
    expect(b2.forcePathStyle).toBe(false);

    const forced = s3ConfigFromEnv({ S3_BUCKET: 'assets', S3_REGION: 'us-east-1', S3_FORCE_PATH_STYLE: 'true', ...keys });
    expect(forced.forcePathStyle).toBe(true);
  });

  it('names the missing variable and where to get it, and does not echo values', () => {
    expect(() => s3ConfigFromEnv({ S3_REGION: 'us-east-1', ...keys })).toThrow(/S3_BUCKET.*\.env/s);
    expect(() => s3ConfigFromEnv({ S3_BUCKET: 'assets', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'AK' })).toThrow(
      /S3_SECRET_ACCESS_KEY/,
    );
    // The thrown message must not contain the value of any variable it read.
    let message = '';
    try {
      s3ConfigFromEnv({ S3_BUCKET: 'assets', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'AK' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('assets');
  });
});

describe('temporary credentials', () => {
  /**
   * The normal case for a hosted deployment. An instance role or an
   * `sts:AssumeRole` hands back three values, and sending only the first two
   * fails with an InvalidAccessKeyId that says nothing about the real cause.
   */
  const temporary: S3Config = { ...r2, sessionToken: 'FwoGZXIvYXdzEExample//////////' };

  it('signs the token as a header rather than attaching it afterwards', async () => {
    const { calls, fetchDouble } = recorder(ok());
    await s3Storage(temporary, { fetch: fetchDouble, now: at('2026-10-07T00:00:00Z') }).get('a.txt');

    expect(calls[0]!.headers['x-amz-security-token']).toBe(temporary.sessionToken);
    // Covered by the signature, not merely present. S3 rejects any x-amz-*
    // header the signature does not account for.
    expect(calls[0]!.headers.authorization).toContain('x-amz-security-token');
  });

  it('leaves the header off entirely for long-lived keys', async () => {
    const { calls, fetchDouble } = recorder(ok());
    await s3Storage(r2, { fetch: fetchDouble, now: at('2026-10-07T00:00:00Z') }).get('a.txt');

    expect(calls[0]!.headers['x-amz-security-token']).toBeUndefined();
    expect(calls[0]!.headers.authorization).not.toContain('security-token');
  });

  it('puts the token in the signed query of a presigned URL', () => {
    const url = presignGetUrl(temporary, 'a.txt', 600, new Date('2026-10-07T00:00:00Z'));
    const query = new URL(url).searchParams;

    expect(query.get('X-Amz-Security-Token')).toBe(temporary.sessionToken);
    // A browser sends no headers we control, so the token has to be signed as
    // a query parameter. Changing it must therefore change the signature.
    const without = new URL(presignGetUrl(r2, 'a.txt', 600, new Date('2026-10-07T00:00:00Z'))).searchParams;
    expect(query.get('X-Amz-Signature')).not.toBe(without.get('X-Amz-Signature'));
  });

  it('reads the token from either variable name', () => {
    const keys = { S3_BUCKET: 'assets', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'AK', S3_SECRET_ACCESS_KEY: 'SK' };
    expect(s3ConfigFromEnv({ ...keys, S3_SESSION_TOKEN: 'from-s3' }).sessionToken).toBe('from-s3');
    // The name the AWS SDKs and the instance metadata service already use, so
    // a role-based deployment works with the variables it is handed.
    expect(s3ConfigFromEnv({ ...keys, AWS_SESSION_TOKEN: 'from-aws' }).sessionToken).toBe('from-aws');
    expect(s3ConfigFromEnv(keys).sessionToken).toBeUndefined();
  });
});

describe('against a real fetch and a real socket', () => {
  /**
   * Every other test here injects a fetch double, which proves what the driver
   * means to send but not that it can send it. This one uses the global fetch
   * against a loopback server, so a Uint8Array body, a header name Node
   * rejects, or a URL that does not parse would fail here and nowhere else.
   */
  it('round-trips an object through the driver with nothing injected', async () => {
    const http = await import('node:http');
    const seen: Array<{ method: string; url: string; token: string | undefined; body: Buffer }> = [];
    const stored = new Map<string, Buffer>();

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        seen.push({
          method: req.method!,
          url: req.url!,
          token: req.headers['x-amz-security-token'] as string | undefined,
          body,
        });
        if (req.method === 'PUT') {
          stored.set(req.url!, body);
          res.writeHead(200).end();
        } else if (req.method === 'GET') {
          const found = stored.get(req.url!);
          if (!found) res.writeHead(404).end();
          else res.writeHead(200).end(found);
        } else {
          stored.delete(req.url!);
          res.writeHead(204).end();
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };

    try {
      const storage = s3Storage({
        bucket: 'assets',
        region: 'auto',
        accessKeyId: 'AKEXAMPLE',
        secretAccessKey: 'tops3cret-never-in-output',
        endpoint: `http://127.0.0.1:${port}`,
        forcePathStyle: true,
        sessionToken: 'FwoGZXIvYXdzEExample',
      });

      await storage.put('notes/hello.txt', 'hello there', 'text/plain');
      const back = await storage.get('notes/hello.txt');
      expect(back && Buffer.from(back).toString()).toBe('hello there');

      // Absent is null, not a throw, because the fs driver behaves that way
      // and app code written against one driver has to work on the other.
      expect(await storage.get('notes/missing.txt')).toBeNull();

      await storage.delete('notes/hello.txt');
      expect(await storage.get('notes/hello.txt')).toBeNull();

      expect(seen.map((r) => r.method)).toEqual(['PUT', 'GET', 'GET', 'DELETE', 'GET']);
      // The token survived a real HTTP round trip, not just a recorder.
      expect(seen.every((r) => r.token === 'FwoGZXIvYXdzEExample')).toBe(true);
      expect(seen[0]!.url).toBe('/assets/notes/hello.txt');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
