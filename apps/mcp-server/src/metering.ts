/**
 * Metering: build actions, reserved before a call and settled after.
 *
 * Two-phase on purpose. `reserve` increments the counter atomically before the
 * handler runs, so two concurrent calls cannot both squeeze under the cap.
 * `release` decrements it when the call was refused by a gate, crashed, or was
 * not metered after all — so a user is never charged for our own failures or
 * for a gate saying no. "You only pay for work that passed" is implemented
 * here, not on the pricing page.
 *
 * The quota store is the authority for *now*; the ledger is the record of
 * *what happened*. Redis and Postgres respectively in production. Locally, an
 * in-memory quota store and a JSON-lines ledger — same interface, same tests.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Redis } from 'ioredis';
import { PLANS, type Plan } from '@power/protocol';

export { PLANS, type Plan };

export interface QuotaStore {
  /** Increment both windows and return the new counts. */
  increment(userId: string, day: string, week: string): Promise<{ day: number; week: number }>;
  decrement(userId: string, day: string, week: string): Promise<void>;
  usage(userId: string, day: string, week: string): Promise<{ day: number; week: number }>;
}

export interface LedgerEntry {
  at: string;
  request_id: string;
  user_id: string;
  project_id: string | null;
  tool: string;
  outcome: 'ok' | 'refused' | 'error';
  billable: boolean;
  duration_ms: number;
}

export interface Ledger {
  append(entry: LedgerEntry): Promise<void>;
}

export interface Reservation {
  granted: boolean;
  /** Present when not granted: which window is exhausted and when it resets. */
  exhausted?: { window: 'day' | 'week'; limit: number; resets_at: string };
  remaining: { day: number; week: number | null };
}

export function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** ISO week, so the "rolling" pool is approximated by calendar weeks in v0. */
export function weekKey(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function nextMidnightUtc(now = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString();
}

export class Meter {
  constructor(
    private readonly quota: QuotaStore,
    private readonly ledger: Ledger,
    private readonly planOf: (userId: string) => Promise<Plan>,
  ) {}

  async reserve(userId: string, now = new Date()): Promise<Reservation> {
    const limits = PLANS[await this.planOf(userId)];
    const day = dayKey(now);
    const week = weekKey(now);
    const counts = await this.quota.increment(userId, day, week);

    if (counts.day > limits.per_day) {
      await this.quota.decrement(userId, day, week);
      return {
        granted: false,
        exhausted: { window: 'day', limit: limits.per_day, resets_at: nextMidnightUtc(now) },
        remaining: { day: 0, week: limits.per_week ? Math.max(0, limits.per_week - counts.week + 1) : null },
      };
    }
    if (limits.per_week !== null && counts.week > limits.per_week) {
      await this.quota.decrement(userId, day, week);
      return {
        granted: false,
        exhausted: { window: 'week', limit: limits.per_week, resets_at: 'when the rolling seven-day pool frees up' },
        remaining: { day: Math.max(0, limits.per_day - counts.day + 1), week: 0 },
      };
    }
    return {
      granted: true,
      remaining: {
        day: limits.per_day - counts.day,
        week: limits.per_week === null ? null : limits.per_week - counts.week,
      },
    };
  }

  async release(userId: string, now = new Date()): Promise<void> {
    await this.quota.decrement(userId, dayKey(now), weekKey(now));
  }

  async record(entry: LedgerEntry): Promise<void> {
    await this.ledger.append(entry);
  }

  async remaining(userId: string, now = new Date()): Promise<{ plan: Plan; day: number; week: number | null }> {
    const plan = await this.planOf(userId);
    const limits = PLANS[plan];
    const used = await this.quota.usage(userId, dayKey(now), weekKey(now));
    return {
      plan,
      day: Math.max(0, limits.per_day - used.day),
      week: limits.per_week === null ? null : Math.max(0, limits.per_week - used.week),
    };
  }
}

// ---------------------------------------------------------------- stores

export class MemoryQuota implements QuotaStore {
  private counts = new Map<string, number>();
  private bump(key: string, by: number): number {
    const next = Math.max(0, (this.counts.get(key) ?? 0) + by);
    this.counts.set(key, next);
    return next;
  }
  async increment(u: string, day: string, week: string) {
    return { day: this.bump(`${u}:d:${day}`, 1), week: this.bump(`${u}:w:${week}`, 1) };
  }
  async decrement(u: string, day: string, week: string) {
    this.bump(`${u}:d:${day}`, -1);
    this.bump(`${u}:w:${week}`, -1);
  }
  async usage(u: string, day: string, week: string) {
    return { day: this.counts.get(`${u}:d:${day}`) ?? 0, week: this.counts.get(`${u}:w:${week}`) ?? 0 };
  }
}

/** Redis: INCR is atomic, and the TTLs make the keys self-cleaning. */
export class RedisQuota implements QuotaStore {
  constructor(private readonly redis: Redis) {}
  async increment(u: string, day: string, week: string) {
    const results = await this.redis
      .multi()
      .incr(`q:${u}:d:${day}`)
      .expire(`q:${u}:d:${day}`, 2 * 86_400)
      .incr(`q:${u}:w:${week}`)
      .expire(`q:${u}:w:${week}`, 9 * 86_400)
      .exec();
    // exec() yields [error, value] per command; INCR results are at 0 and 2.
    return { day: Number(results?.[0]?.[1] ?? 0), week: Number(results?.[2]?.[1] ?? 0) };
  }
  async decrement(u: string, day: string, week: string) {
    await this.redis.multi().decr(`q:${u}:d:${day}`).decr(`q:${u}:w:${week}`).exec();
  }
  async usage(u: string, day: string, week: string) {
    const [d, w] = await this.redis.mget(`q:${u}:d:${day}`, `q:${u}:w:${week}`);
    return { day: Number(d ?? 0), week: Number(w ?? 0) };
  }
}

export class MemoryLedger implements Ledger {
  entries: LedgerEntry[] = [];
  async append(entry: LedgerEntry) {
    this.entries.push(entry);
  }
}

export class FileLedger implements Ledger {
  constructor(private readonly path: string) {}
  async append(entry: LedgerEntry) {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(entry)}\n`);
  }
}
