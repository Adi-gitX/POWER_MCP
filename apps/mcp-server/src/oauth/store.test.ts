import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPgliteControlPlane, type ControlPlane } from '../pgstore.js';
import { PgOAuthStore, randomToken, sha256, type RefreshTokenRow } from './store.js';

let dir: string;
let cp: ControlPlane;
let store: PgOAuthStore;

const soon = (sec: number) => new Date(Date.now() + sec * 1000);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'power-oauth-'));
  cp = await openPgliteControlPlane(join(dir, 'cp'));
  store = new PgOAuthStore(cp.sql);
  await store.insertClient({
    client_id: 'cli_test',
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    token_endpoint_auth_method: 'none',
  } as never);
});

afterAll(async () => {
  await cp.close();
  await rm(dir, { recursive: true, force: true });
});

describe('clients', () => {
  it('round-trips a registration, including the arrays', async () => {
    const client = await store.getClient('cli_test');
    expect(client?.redirect_uris).toEqual(['https://claude.ai/api/mcp/auth_callback']);
    expect(client?.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(await store.getClient('nope')).toBeUndefined();
  });
});

describe('users and sessions', () => {
  it('creates a user and finds it by email, case-insensitively', async () => {
    const { user_id } = await store.createUser('Alice@Example.com');
    expect(user_id).toMatch(/^usr_/);
    expect(await store.userIdForEmail('alice@example.com')).toBe(user_id);
    expect(await store.userIdForEmail('ALICE@EXAMPLE.COM')).toBe(user_id);
    expect(await store.userIdForEmail('bob@example.com')).toBeNull();
  });

  it('a session can be read until it is deleted', async () => {
    const userId = (await store.userIdForEmail('alice@example.com'))!;
    const raw = randomToken();
    await store.insertSession({ id_hash: sha256(raw), user_id: userId, expires_at: soon(600) });

    expect((await store.readSession(sha256(raw)))?.user_id).toBe(userId);
    await store.deleteSession(sha256(raw));
    expect(await store.readSession(sha256(raw))).toBeNull();
  });

  it('an expired session does not read back', async () => {
    const userId = (await store.userIdForEmail('alice@example.com'))!;
    const raw = randomToken();
    await store.insertSession({ id_hash: sha256(raw), user_id: userId, expires_at: soon(-1) });
    expect(await store.readSession(sha256(raw))).toBeNull();
  });
});

describe('login challenges', () => {
  it('a magic link works exactly once', async () => {
    const raw = randomToken();
    await store.insertLoginChallenge({ token_hash: sha256(raw), email: 'carol@example.com', expires_at: soon(600) });

    expect((await store.consumeLoginChallenge(sha256(raw)))?.email).toBe('carol@example.com');
    // Clicking the same link again must not sign anyone in.
    expect(await store.consumeLoginChallenge(sha256(raw))).toBeNull();
  });

  it('an expired link does not work at all', async () => {
    const raw = randomToken();
    await store.insertLoginChallenge({ token_hash: sha256(raw), email: 'dan@example.com', expires_at: soon(-1) });
    expect(await store.consumeLoginChallenge(sha256(raw))).toBeNull();
  });
});

describe('authorization codes', () => {
  const makeCode = async (userId: string) => {
    const raw = randomToken();
    await store.insertCode({
      code_hash: sha256(raw),
      client_id: 'cli_test',
      user_id: userId,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: 'challenge',
      scopes: ['power.build'],
      resource: 'https://mcp.example.com/mcp',
      expires_at: soon(60),
    });
    return raw;
  };

  it('is readable before the exchange and consumable exactly once', async () => {
    const userId = (await store.userIdForEmail('alice@example.com'))!;
    const raw = await makeCode(userId);

    // challengeForAuthorizationCode reads without consuming.
    expect((await store.readCode(sha256(raw)))?.code_challenge).toBe('challenge');

    expect((await store.consumeCode(sha256(raw)))?.user_id).toBe(userId);
    // A replayed code is the classic attack, and it must return nothing.
    expect(await store.consumeCode(sha256(raw))).toBeNull();
  });

  it('an expired code cannot be exchanged', async () => {
    const userId = (await store.userIdForEmail('alice@example.com'))!;
    const raw = randomToken();
    await store.insertCode({
      code_hash: sha256(raw),
      client_id: 'cli_test',
      user_id: userId,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: 'c',
      scopes: [],
      resource: null,
      expires_at: soon(-1),
    });
    expect(await store.consumeCode(sha256(raw))).toBeNull();
  });
});

describe('access tokens', () => {
  it('reads back until revoked, and never after', async () => {
    const userId = (await store.userIdForEmail('alice@example.com'))!;
    const raw = randomToken();
    await store.insertAccessToken({
      token_hash: sha256(raw),
      client_id: 'cli_test',
      user_id: userId,
      scopes: ['power.build'],
      resource: 'https://mcp.example.com/mcp',
      expires_at: soon(3600),
    });

    expect((await store.readAccessToken(sha256(raw)))?.user_id).toBe(userId);
    await store.revokeAccessToken(sha256(raw));
    expect(await store.readAccessToken(sha256(raw))).toBeNull();
  });

  it('an expired token does not read back', async () => {
    const userId = (await store.userIdForEmail('alice@example.com'))!;
    const raw = randomToken();
    await store.insertAccessToken({
      token_hash: sha256(raw),
      client_id: 'cli_test',
      user_id: userId,
      scopes: [],
      resource: null,
      expires_at: soon(-1),
    });
    expect(await store.readAccessToken(sha256(raw))).toBeNull();
  });
});

describe('refresh token rotation', () => {
  const issue = async (userId: string, familyId: string): Promise<{ raw: string; row: RefreshTokenRow }> => {
    const raw = randomToken();
    const row: RefreshTokenRow = {
      token_hash: sha256(raw),
      family_id: familyId,
      client_id: 'cli_test',
      user_id: userId,
      scopes: ['power.build'],
      resource: 'https://mcp.example.com/mcp',
      expires_at: soon(3600),
    };
    return { raw, row };
  };

  it('rotates once, and a replay is detectable as a leak', async () => {
    const userId = (await store.userIdForEmail('alice@example.com'))!;
    const family = `fam_${randomToken().slice(0, 8)}`;

    const first = await issue(userId, family);
    await store.insertRefreshToken(first.row);

    const second = await issue(userId, family);
    const rotated = await store.rotateRefreshToken(first.row.token_hash, second.row);
    expect(rotated?.family_id).toBe(family);

    // The successor exists.
    expect(await store.readRefreshToken(second.row.token_hash)).not.toBeNull();

    // Presenting the old token again rotates nothing.
    const third = await issue(userId, family);
    expect(await store.rotateRefreshToken(first.row.token_hash, third.row)).toBeNull();

    // And the caller can tell a leak from an unknown token: the row is still
    // there, with rotated_to set. That is the signal to kill the family.
    const stale = await store.readRefreshToken(first.row.token_hash);
    expect(stale?.rotated_to).toBe(second.row.token_hash);
  });

  it('revoking a family kills every token in it', async () => {
    const userId = (await store.userIdForEmail('alice@example.com'))!;
    const family = `fam_${randomToken().slice(0, 8)}`;

    const a = await issue(userId, family);
    const b = await issue(userId, family);
    await store.insertRefreshToken(a.row);
    await store.insertRefreshToken(b.row);

    const access = randomToken();
    await store.insertAccessToken({
      token_hash: sha256(access),
      client_id: 'cli_test',
      user_id: userId,
      scopes: [],
      resource: null,
      expires_at: soon(3600),
    });

    await store.revokeFamily(family);

    // Neither refresh token can rotate any more.
    const next = await issue(userId, family);
    expect(await store.rotateRefreshToken(a.row.token_hash, next.row)).toBeNull();
    expect(await store.rotateRefreshToken(b.row.token_hash, next.row)).toBeNull();
    // And the access tokens issued alongside them are dead too, so a leak
    // does not stay usable for the rest of the hour.
    expect(await store.readAccessToken(sha256(access))).toBeNull();
  });

  it('an unknown refresh token is simply absent, not a leak', async () => {
    expect(await store.readRefreshToken(sha256('never issued'))).toBeNull();
  });
});
