import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PowerAdapter, SelfHostAdapter, power, type Db } from './index.js';

const fakeDb = (): Db => ({ query: async () => [], one: async () => null, close: async () => {} });

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'power-sdk-')); });
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('adapter selection is decided by the environment, never the app', () => {
  it('picks PowerAdapter inside Power', () => {
    const a = power({ env: { POWER_ENV: 'live', DATABASE_URL: 'postgres://x' }, makeDb: fakeDb });
    expect(a.env).toBe('live');
  });

  it('picks SelfHostAdapter anywhere else', () => {
    const a = power({ env: { DATABASE_URL: 'postgres://x', STORAGE_DIR: dir }, makeDb: fakeDb });
    expect(a.env).toBe('self-hosted');
  });

  it('PowerAdapter refuses to run outside Power rather than guessing', () => {
    expect(() => PowerAdapter({ env: { DATABASE_URL: 'postgres://x' }, makeDb: fakeDb })).toThrow(/POWER_ENV/);
  });

  it('names the missing variable and where to get it', () => {
    expect(() => SelfHostAdapter({ env: {}, makeDb: fakeDb })).toThrow(/DATABASE_URL.*\.env/);
  });
});

describe('the same code runs against both adapters', () => {
  const both = () => [
    PowerAdapter({ env: { POWER_ENV: 'workbench', DATABASE_URL: 'postgres://x', STORAGE_DIR: join(dir, 'p') }, makeDb: fakeDb }),
    SelfHostAdapter({ env: { DATABASE_URL: 'postgres://x', STORAGE_DIR: join(dir, 's') }, makeDb: fakeDb }),
  ];

  it('storage round-trips and refuses path escapes', async () => {
    for (const a of both()) {
      await a.storage.put('docs/a.txt', 'hello');
      expect(new TextDecoder().decode((await a.storage.get('docs/a.txt'))!)).toBe('hello');
      await a.storage.delete('docs/a.txt');
      expect(await a.storage.get('docs/a.txt')).toBeNull();
      await expect(a.storage.put('../escape', 'x')).rejects.toThrow(/invalid storage key/);
    }
  });

  it('signed URLs are capped at fifteen minutes', async () => {
    for (const a of both()) {
      const url = await a.storage.signedUrl('k', 86_400);
      const expires = Number(new URL(url, 'http://x').searchParams.get('expires'));
      expect(expires - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(15 * 60);
    }
  });

  it('email without a provider logs instead of failing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const a of both()) {
      const { id } = await a.email.send({ to: 'x@y.z', subject: 'hi', text: 'body' });
      expect(id).toMatch(/^mail_/);
    }
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
