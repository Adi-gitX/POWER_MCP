import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  backoffMs,
  claimNextJob,
  createJobs,
  JobsError,
  nextCronTime,
  parseCron,
  parseSchedule,
  type Jobs,
} from './jobs.js';
import type { Db } from './index.js';

/** The app's own database, which is where everything jobs owns lives. */
class PgliteDb implements Db {
  constructor(private readonly pg: PGlite) {}
  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { rows } = await this.pg.query<T>(sql, params);
    return rows;
  }
  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
  }
  async close(): Promise<void> {
    await this.pg.close();
  }
}

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await pg.waitReady;
  return new PgliteDb(pg);
}

/**
 * Drags a job's due time into the past. Retries are deliberately delayed by a
 * real backoff, and the assertions below are about the state machine, not
 * about whether a test can sit still for a second.
 */
async function makeDue(db: Db, id: string): Promise<void> {
  await db.query(`update jobs_queue set run_at = now() - interval '1 hour' where id = $1`, [id]);
}

const stateOf = async (db: Db, id: string): Promise<string | null> =>
  (await db.one<{ state: string }>(`select state from jobs_queue where id = $1`, [id]))?.state ?? null;

describe('running a job', () => {
  let db: Db;
  let jobs: Jobs;

  beforeAll(async () => {
    db = await freshDb();
    jobs = createJobs(db, { concurrency: 2 });
    await jobs.migrate();
    // Idempotent: a generated app calls this on every boot.
    await jobs.migrate();
  });

  it('hands the handler its payload and marks the job done', async () => {
    const seen: unknown[] = [];
    jobs.define('greet', (payload) => {
      seen.push(payload);
    });

    const { id } = await jobs.enqueue('greet', { who: 'ada' });
    expect(await jobs.tick()).toBe(1);

    expect(seen).toEqual([{ who: 'ada' }]);
    expect(await jobs.get(id)).toMatchObject({ state: 'done', attempts: 1, lastError: null });
  });

  it('leaves a job alone until its runAt arrives', async () => {
    jobs.define('later', () => undefined);
    const { id } = await jobs.enqueue('later', {}, new Date(Date.now() + 60_000));

    expect(await jobs.tick()).toBe(0);
    expect(await stateOf(db, id)).toBe('pending');

    // The same job runs the moment it is due, so nothing above was a typo in
    // the name quietly making the job unclaimable.
    await makeDue(db, id);
    expect(await jobs.tick()).toBe(1);
  });

  it('claims no more than the concurrency limit in one pass', async () => {
    jobs.define('bulk', () => undefined);
    for (let i = 0; i < 5; i += 1) await jobs.enqueue('bulk', { i });

    // Without a cap, a backlog of ten thousand rows would be claimed in one
    // pass and the app would run out of memory before it ran out of jobs.
    expect(await jobs.tick()).toBe(2);
    expect(await jobs.tick()).toBe(2);
    expect(await jobs.tick()).toBe(1);
    expect(await jobs.tick()).toBe(0);
  });

  it('reports the counts an admin page needs', async () => {
    const counts = await jobs.counts();
    expect(counts.done).toBeGreaterThan(0);
    expect(counts.pending).toBe(0);
  });
});

/**
 * The property the whole design rests on. Two instances of one app is the
 * normal state of affairs the moment anything is deployed, and a reminder
 * email sent twice, or a card charged twice, is the failure people notice.
 *
 * PGlite runs one statement at a time, so these two claims interleave rather
 * than truly collide. What the test pins down is still the thing that matters:
 * the claim and the state change are one statement, so the second claim cannot
 * see the row as pending after the first has taken it. `FOR UPDATE SKIP
 * LOCKED` is what extends that to real parallel connections, and removing
 * either half of the statement makes this test fail.
 */
describe('claiming a job exactly once', () => {
  it('lets exactly one of two racing claims win', async () => {
    const db = await freshDb();
    const jobs = createJobs(db);
    await jobs.migrate();
    jobs.define('once', () => undefined);
    const { id } = await jobs.enqueue('once', {});

    const [first, second] = await Promise.all([claimNextJob(db, 'instance-a'), claimNextJob(db, 'instance-b')]);

    const winners = [first, second].filter((row) => row !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.id).toBe(id);
    expect(winners[0]!.attempts).toBe(1);
    // Exactly one attempt was spent, so the loser did not also increment it.
    expect(await stateOf(db, id)).toBe('running');
  });

  it('runs a job once even when two instances poll at the same moment', async () => {
    const db = await freshDb();
    const runs: string[] = [];
    const a = createJobs(db, { instanceId: 'a' });
    const b = createJobs(db, { instanceId: 'b' });
    await a.migrate();
    a.define('send-reminder', () => {
      runs.push('a');
    });
    b.define('send-reminder', () => {
      runs.push('b');
    });

    await a.enqueue('send-reminder', { booking: 1 });
    await Promise.all([a.tick(), b.tick()]);

    expect(runs).toHaveLength(1);
  });
});

describe('when a handler fails', () => {
  let db: Db;
  let jobs: Jobs;
  const reported: unknown[] = [];

  beforeAll(async () => {
    db = await freshDb();
    jobs = createJobs(db, {
      maxAttempts: 3,
      onError: (error) => {
        reported.push(error);
      },
    });
    await jobs.migrate();
  });

  it('does not let the failure escape the tick', async () => {
    jobs.define('explode', () => {
      throw new Error('the third party is down');
    });
    const { id } = await jobs.enqueue('explode', {});

    // If this rejected, a generated app's poll loop would take the whole
    // process down the first time any handler had a bad day.
    await expect(jobs.tick()).resolves.toBe(1);
    expect(await jobs.get(id)).toMatchObject({ state: 'pending', attempts: 1 });
    expect(reported).toHaveLength(1);
  });

  it('delays the retry instead of spinning on it', async () => {
    const { id } = await jobs.enqueue('explode', {});
    await jobs.tick();

    const row = await jobs.get(id);
    // A failed job that stayed due would be retried as fast as the loop can
    // go, which turns one broken handler into a denial of service on the
    // app's own database.
    expect(new Date(row!.runAt).getTime()).toBeGreaterThan(Date.now());
    expect(await jobs.tick()).toBe(0);
  });

  it('gives up after the maximum attempts and lands in dead', async () => {
    const { id } = await jobs.enqueue('explode', {});
    for (let i = 0; i < 3; i += 1) {
      await makeDue(db, id);
      await jobs.tick();
    }

    const row = await jobs.get(id);
    expect(row).toMatchObject({ state: 'dead', attempts: 3 });
    // Dead means dead. A row that kept being claimed would retry forever.
    await makeDue(db, id);
    expect(await jobs.tick()).toBe(0);
    expect(row!.lastError).toContain('the third party is down');
  });

  it('honours a per-job attempt count', async () => {
    jobs.define(
      'fragile',
      () => {
        throw new Error('nope');
      },
      { maxAttempts: 1 },
    );
    const { id } = await jobs.enqueue('fragile', {});
    await jobs.tick();
    // One attempt, so there is no retry at all and it is dead immediately.
    expect(await jobs.get(id)).toMatchObject({ state: 'dead', attempts: 1 });
  });

  it('keeps the payload out of the stored error', async () => {
    jobs.define('leaky', () => {
      throw new Error('upstream rejected the request');
    });
    const { id } = await jobs.enqueue('leaky', { apiKey: 'sk-do-not-store-me' });
    await jobs.tick();

    const row = await jobs.get(id);
    // The error column is read by whoever owns the app, and handlers routinely
    // fail while holding a credential. Storing only the message, with no stack
    // and no payload, is what keeps a secret out of the table.
    expect(row!.lastError).toBe('upstream rejected the request');
    expect(JSON.stringify(row)).not.toContain('sk-do-not-store-me');
  });

  it('survives a handler that rejects with something that is not an Error', async () => {
    jobs.define('weird', async () => {
      throw 'just a string';
    });
    const { id } = await jobs.enqueue('weird', {});
    await expect(jobs.tick()).resolves.toBe(1);
    expect((await jobs.get(id))!.lastError).toBe('just a string');
  });
});

describe('instances that do not know a job', () => {
  it('gives the job back without spending an attempt', async () => {
    const db = await freshDb();
    const ignorant = createJobs(db, { instanceId: 'old-release' });
    await ignorant.migrate();
    // Enqueue is allowed without a handler on purpose: the web process queues
    // work that only the worker process has the code for.
    const { id } = await ignorant.enqueue('new-feature', {});

    expect(await ignorant.tick()).toBe(1);
    // Back to pending with the attempt refunded. Counting it would let a
    // rolling deploy kill a job by having the old instances look at it.
    expect(await ignorant.get(id)).toMatchObject({ state: 'pending', attempts: 0 });

    // And held off, not handed straight back. An instance that cannot run this
    // name would otherwise re-claim it the instant it was returned, so a
    // rolling deploy would spin at full poll rate on a job nobody can run.
    const held = await ignorant.get(id);
    expect(new Date(held!.runAt).getTime()).toBeGreaterThan(Date.now());
    expect(await ignorant.tick()).toBe(0);

    const informed = createJobs(db, { instanceId: 'new-release' });
    let ran = false;
    informed.define('new-feature', () => {
      ran = true;
    });
    // The hold is a delay, not a block: once it lapses the instance that does
    // know the name runs it.
    await makeDue(db, id);
    await informed.tick();
    expect(ran).toBe(true);
  });
});

describe('an instance that died holding a job', () => {
  it('hands the job back once the visibility timeout passes', async () => {
    const db = await freshDb();
    const jobs = createJobs(db, { visibilityTimeoutMs: 1_000 });
    await jobs.migrate();
    jobs.define('interrupted', () => undefined);
    const { id } = await jobs.enqueue('interrupted', {});

    // Claimed and never finished, which is what a killed process leaves behind.
    await claimNextJob(db, 'instance-that-died');
    expect(await stateOf(db, id)).toBe('running');
    expect(await jobs.tick()).toBe(0);

    await db.query(`update jobs_queue set locked_at = now() - interval '1 hour' where id = $1`, [id]);
    expect(await jobs.tick()).toBe(1);
    // The spent attempt is not refunded: a handler that reliably kills the
    // process has to be able to reach dead rather than cycling forever.
    expect(await jobs.get(id)).toMatchObject({ state: 'done', attempts: 2 });
  });
});

describe('scheduling on an interval', () => {
  let db: Db;
  let jobs: Jobs;

  beforeAll(async () => {
    db = await freshDb();
    jobs = createJobs(db, { maxScheduled: 2 });
    await jobs.migrate();
  });

  it('queues one occurrence however many instances boot', async () => {
    jobs.define('digest', () => undefined);
    await jobs.schedule('digest', { everySeconds: 60 });
    await jobs.schedule('digest', { everySeconds: 60 });

    const rows = await db.query(`select id from jobs_queue where schedule_key = 'digest'`);
    // Ten instances booting must not produce ten digests.
    expect(rows).toHaveLength(1);
  });

  it('queues the next occurrence when one finishes, without drifting', async () => {
    const due = await db.one<{ id: string; run_at: string }>(
      `select id, run_at from jobs_queue where schedule_key = 'digest' and state = 'pending'`,
    );
    await makeDue(db, due!.id);
    await jobs.tick();

    const next = await db.one<{ id: string; run_at: string }>(
      `select id, run_at from jobs_queue where schedule_key = 'digest' and state = 'pending'`,
    );
    expect(next).not.toBeNull();
    expect(next!.id).not.toBe(due!.id);
    // The occurrence we ran was an hour overdue, so the next one is measured
    // from now. Measuring from the missed slot would fire a backlog of every
    // run the app was down for, all at once.
    expect(new Date(next!.run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('keeps the schedule alive after an occurrence dies', async () => {
    const jobsB = createJobs(db, { maxAttempts: 1 });
    jobsB.define('flaky-schedule', () => {
      throw new Error('still down');
    });
    await jobsB.schedule('flaky-schedule', { everySeconds: 30 });

    const first = await db.one<{ id: string }>(
      `select id from jobs_queue where schedule_key = 'flaky-schedule' and state = 'pending'`,
    );
    await makeDue(db, first!.id);
    await jobsB.tick();

    expect(await jobsB.get(first!.id)).toMatchObject({ state: 'dead' });
    const next = await db.one<{ id: string }>(
      `select id from jobs_queue where schedule_key = 'flaky-schedule' and state = 'pending'`,
    );
    // One outage must not silently end a schedule for the life of the app.
    expect(next).not.toBeNull();
    expect(next!.id).not.toBe(first!.id);
  });

  it('refuses a schedule for a job with no handler', async () => {
    // A misspelled name should fail at boot, not become a schedule that
    // quietly never runs anything.
    await expect(jobs.schedule('dijest', 5)).rejects.toThrow(JobsError);
  });

  it('enforces the cap on scheduled jobs', async () => {
    // A scheduled job is the one primitive that can bill forever, so the
    // ceiling has to be a decision somebody makes on purpose.
    const ownDb = await freshDb();
    const capped = createJobs(ownDb, { maxScheduled: 2 });
    await capped.migrate();
    for (const name of ['one', 'two', 'three']) capped.define(name, () => undefined);

    await capped.schedule('one', 60);
    await capped.schedule('two', 60);
    await expect(capped.schedule('three', 60)).rejects.toThrow(/cap/);

    // Re-registering a name that is already live is free, because a generated
    // app calls schedule() on every boot.
    await expect(capped.schedule('one', 60)).resolves.toBeUndefined();
  });

  it('holds the cap across instances, not per process', async () => {
    // The defect this replaced: the cap was a Set on the instance, so every
    // process got its own fresh budget while they all wrote the same table.
    const ownDb = await freshDb();
    const first = createJobs(ownDb, { maxScheduled: 2 });
    await first.migrate();
    first.define('a', () => undefined);
    first.define('b', () => undefined);
    await first.schedule('a', 60);
    await first.schedule('b', 60);

    const second = createJobs(ownDb, { maxScheduled: 2 });
    second.define('c', () => undefined);
    await expect(second.schedule('c', 60)).rejects.toThrow(/cap/);
  });

  it('refuses a name that could be confused for something else', async () => {
    expect(() => jobs.define('../etc/passwd', () => undefined)).toThrow(JobsError);
    expect(() => jobs.define('', () => undefined)).toThrow(/1-64/);
  });
});

describe('the poll loop', () => {
  it('starts, drains work on its own, and stops cleanly', async () => {
    const db = await freshDb();
    const jobs = createJobs(db, { pollIntervalMs: 50 });
    await jobs.migrate();
    let ran = 0;
    jobs.define('tiny', () => {
      ran += 1;
    });
    await jobs.enqueue('tiny', {});

    jobs.start();
    jobs.start(); // Idempotent: a second start must not double the poll rate.
    const deadline = Date.now() + 5_000;
    while (ran === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    await jobs.stop();

    expect(ran).toBe(1);
    // Nothing is left mid-flight, so no row is stranded in 'running' waiting
    // for the visibility timeout after a graceful shutdown.
    expect((await jobs.counts()).running).toBe(0);
  });
});

describe('backoff', () => {
  it('doubles and then stops doubling', () => {
    expect(backoffMs(1)).toBe(1_000);
    expect(backoffMs(2)).toBe(2_000);
    expect(backoffMs(3)).toBe(4_000);
    // Capped, or attempt 40 would schedule the retry after the heat death of
    // the universe and the job would look lost rather than delayed.
    expect(backoffMs(40)).toBe(60 * 60 * 1_000);
  });
});

describe('schedule specs', () => {
  it('reads seconds from a bare number', () => {
    expect(parseSchedule(30)).toEqual({ kind: 'interval', ms: 30_000 });
    expect(parseSchedule({ everySeconds: 2 })).toEqual({ kind: 'interval', ms: 2_000 });
    expect(parseSchedule({ everyMs: 5_000 })).toEqual({ kind: 'interval', ms: 5_000 });
  });

  it('floors an interval so a typo cannot turn the loop into a spin', () => {
    expect(parseSchedule(0)).toEqual({ kind: 'interval', ms: 1_000 });
    expect(parseSchedule({ everyMs: -5 })).toEqual({ kind: 'interval', ms: 1_000 });
  });

  it('rejects an interval that is not a number', () => {
    expect(() => parseSchedule(Number.NaN)).toThrow(JobsError);
    expect(() => parseSchedule({ everyMs: Number.POSITIVE_INFINITY })).toThrow(JobsError);
  });
});

/**
 * The cron subset is small on purpose, so these tests are the whole contract.
 * Everything outside the subset is rejected at schedule time, because a cron
 * expression that is silently misread gives an app that boots, never runs the
 * job, and logs nothing to say why.
 */
describe('the cron parser', () => {
  const at = (iso: string) => new Date(iso);

  it('finds the next minute', () => {
    expect(nextCronTime('* * * * *', at('2026-03-01T10:00:30Z')).toISOString()).toBe('2026-03-01T10:01:00.000Z');
  });

  it('is strictly after the given time, so a schedule cannot re-fire itself', () => {
    // Were this inclusive, an occurrence finishing exactly on its minute would
    // queue its successor for the same minute and run twice.
    expect(nextCronTime('* * * * *', at('2026-03-01T10:00:00Z')).toISOString()).toBe('2026-03-01T10:01:00.000Z');
  });

  it('rolls over to tomorrow for a daily time that has passed', () => {
    expect(nextCronTime('0 9 * * *', at('2026-03-01T10:00:00Z')).toISOString()).toBe('2026-03-02T09:00:00.000Z');
  });

  it('handles steps, lists and ranges', () => {
    expect(nextCronTime('*/15 * * * *', at('2026-03-01T10:02:00Z')).toISOString()).toBe('2026-03-01T10:15:00.000Z');
    expect(nextCronTime('0,30 * * * *', at('2026-03-01T10:05:00Z')).toISOString()).toBe('2026-03-01T10:30:00.000Z');
    expect(nextCronTime('0 9-17 * * *', at('2026-03-01T08:10:00Z')).toISOString()).toBe('2026-03-01T09:00:00.000Z');
    expect(nextCronTime('0 0-23/6 * * *', at('2026-03-01T01:00:00Z')).toISOString()).toBe('2026-03-01T06:00:00.000Z');
  });

  it('skips whole months and days it cannot match', () => {
    expect(nextCronTime('30 2 1 * *', at('2026-03-02T00:00:00Z')).toISOString()).toBe('2026-04-01T02:30:00.000Z');
    expect(nextCronTime('0 0 1 1 *', at('2026-03-02T00:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('lands on the right weekday, and treats 7 as Sunday like every other cron', () => {
    expect(nextCronTime('0 0 * * 1', at('2026-03-01T12:00:00Z')).getUTCDay()).toBe(1);
    expect(nextCronTime('0 0 * * 0', at('2026-03-01T12:00:00Z')).getUTCDay()).toBe(0);
    expect(nextCronTime('0 0 * * 7', at('2026-03-01T12:00:00Z')).toISOString()).toBe(
      nextCronTime('0 0 * * 0', at('2026-03-01T12:00:00Z')).toISOString(),
    );
  });

  it('ORs the two day fields when both are narrowed', () => {
    // This is the rule people get wrong writing their own: with both day
    // fields set, cron matches either, not both. If it were an AND, a job set
    // for "the 13th or any Friday" would only ever run on Friday the 13th.
    const fields = parseCron('0 0 13 * 5');
    const first = nextCronTime(fields, at('2026-03-01T00:00:00Z'));
    expect(first.getUTCDate() === 13 || first.getUTCDay() === 5).toBe(true);
    expect(first.getTime()).toBeLessThan(at('2026-03-14T00:00:00Z').getTime());
  });

  it('rejects everything outside the subset rather than guessing', () => {
    expect(() => parseCron('* * *')).toThrow(/five fields/);
    expect(() => parseCron('@daily')).toThrow(JobsError);
    expect(() => parseCron('60 * * * *')).toThrow(JobsError);
    expect(() => parseCron('* 24 * * *')).toThrow(JobsError);
    expect(() => parseCron('* * 0 * *')).toThrow(JobsError);
    expect(() => parseCron('*/0 * * * *')).toThrow(JobsError);
    expect(() => parseCron('5-1 * * * *')).toThrow(JobsError);
    expect(() => parseCron('a * * * *')).toThrow(JobsError);
    expect(() => parseCron('0 0 1 1 1 1')).toThrow(JobsError);
  });

  it('refuses a date that never comes instead of searching forever', () => {
    // February 30th. Without the ceiling in nextCronTime this is a hang, and
    // a hang inside schedule() means the app never finishes booting.
    expect(() => nextCronTime('0 0 30 2 *', at('2026-03-01T00:00:00Z'))).toThrow(/never comes round/);
  });
});

describe('scheduling on cron', () => {
  it('queues the occurrence at the cron time and the next one after it runs', async () => {
    const db = await freshDb();
    const jobs = createJobs(db);
    await jobs.migrate();
    jobs.define('nightly', () => undefined);
    await jobs.schedule('nightly', { cron: '*/5 * * * *' });

    const first = await db.one<{ id: string; run_at: string; cron: string }>(
      `select id, run_at, cron from jobs_queue where schedule_key = 'nightly'`,
    );
    expect(first!.cron).toBe('*/5 * * * *');
    expect(new Date(first!.run_at).getUTCMinutes() % 5).toBe(0);

    await makeDue(db, first!.id);
    await jobs.tick();

    const next = await db.one<{ id: string; run_at: string }>(
      `select id, run_at from jobs_queue where schedule_key = 'nightly' and state = 'pending'`,
    );
    // The spec travels on the row, not just in this process's memory, so the
    // instance that happens to claim an occurrence can always work out when
    // the following one is due even if it never called schedule() itself.
    expect(next).not.toBeNull();
    expect(new Date(next!.run_at).getUTCMinutes() % 5).toBe(0);
    expect(new Date(next!.run_at).getTime()).toBeGreaterThan(Date.now());
  });
});
