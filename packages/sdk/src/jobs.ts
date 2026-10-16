/**
 * Scheduled and background work for the apps Power builds.
 *
 * The second capability whose absence capped everything else. A booking page
 * has to send a reminder the morning before, a waitlist has to send the digest
 * on Monday, an importer has to keep going after the request that started it
 * has returned. Without somewhere to put work that outlives a request, all of
 * that has to happen inside the request, and the request times out.
 *
 * Shaped exactly like `auth.ts`, for the same reason: it owns one table in the
 * app's OWN database and uses only Node built-ins, so an exported project runs
 * unchanged outside Power with nothing to re-wire and no third-party queue to
 * provision. The database is already there; it is a perfectly good queue at
 * the scale these apps run at.
 *
 * The property that everything else rests on: a job is claimed with a single
 * atomic `UPDATE ... RETURNING` over `FOR UPDATE SKIP LOCKED`. Two instances
 * of the same app, which is the normal state of affairs the moment anything is
 * deployed behind more than one process, cannot run the same job twice. Every
 * other guarantee here is worth nothing if that one does not hold, so it is
 * tested by racing two claims directly.
 *
 * Times are UTC. A schedule does not shift with the host's timezone or with
 * daylight saving, because an app that moves its nightly job by an hour twice
 * a year is a support ticket nobody can reproduce.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from './index.js';

/**
 * Hard caps, all of them overridable. The research into the competitor found
 * it enforces its own limits here, and the reason is sound: a scheduled job is
 * the one primitive a generated app can use to bill its owner for infinity. A
 * loop that enqueues itself every second costs real money, so the ceiling is
 * low by default and raising it is a decision somebody has to make on purpose.
 */
const DEFAULT_MAX_SCHEDULED = 10;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_POLL_MS = 1_000;

/**
 * How long a claimed job may stay claimed before another instance may take it
 * back. This is the recovery path for an instance that was killed mid-job, so
 * it has to be comfortably longer than the slowest handler an app is likely to
 * write, or a slow job gets executed twice while the first run is still going.
 */
const DEFAULT_VISIBILITY_MS = 5 * 60 * 1_000;

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60 * 60 * 1_000;

/**
 * How long an instance that has no handler for a job holds it off for.
 *
 * Long enough that giving the job back is not a spin, short enough that the
 * job still runs promptly once an instance that does know the name picks it
 * up. This is the rolling-deploy window, so it is measured in seconds.
 */
const UNKNOWN_HANDLER_DELAY_MS = 5_000;

/**
 * The floor on an interval. Zero or a negative number would turn the poll loop
 * into a spin, and a typo in `everySeconds` should not be able to do that.
 */
const MIN_INTERVAL_MS = 1_000;

/** Enough of the failure to debug it, short enough that one bad job cannot fill the table. */
const MAX_ERROR_CHARS = 500;

export type JobState = 'pending' | 'running' | 'done' | 'dead';

export interface JobContext {
  id: string;
  name: string;
  /** 1 on the first run, so `attempt === maxAttempts` means this is the last chance. */
  attempt: number;
  maxAttempts: number;
}

export type JobHandler = (payload: unknown, ctx: JobContext) => void | Promise<void>;

/**
 * Interval scheduling is the baseline and is what an app should reach for.
 * A number is seconds, because that is what people mean when they say "every
 * 30". A bare string is a five-field cron expression; see `parseCron` for the
 * subset that is supported, which is deliberately small and fully tested.
 */
export type ScheduleSpec = number | string | { everySeconds: number } | { everyMs: number } | { cron: string };

export interface JobRun {
  id: string;
  name: string;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  /**
   * The handler's message, truncated, with no stack. It is for the person who
   * owns the app, shown on an admin page or read out of the table by hand. It
   * is never put in front of an end user and never logged, because a handler
   * that fails while talking to a third party tends to put the credential it
   * was using into the message.
   */
  lastError: string | null;
  scheduleKey: string | null;
}

export class JobsError extends Error {
  constructor(
    message: string,
    readonly code: 'unknown_job' | 'bad_schedule' | 'too_many_schedules' | 'bad_name',
  ) {
    super(message);
    this.name = 'JobsError';
  }
}

export interface JobsOptions {
  /** How many jobs may run at once in this process. */
  concurrency?: number;
  /** How many distinct recurring schedules this app may register. */
  maxScheduled?: number;
  /** Attempts before a job goes to `dead`. Overridable per job in `define`. */
  maxAttempts?: number;
  pollIntervalMs?: number;
  visibilityTimeoutMs?: number;
  /** Identifies this process in `locked_by`. Defaults to a random id per instance. */
  instanceId?: string;
  /**
   * Called when a handler throws, so an app can forward the failure to its own
   * error reporting. It is given the error, never the payload, and anything it
   * throws is swallowed: a broken reporter must not take the queue down.
   */
  onError?: (error: unknown, ctx: JobContext) => void;
}

export interface Jobs {
  /** Create the table. Idempotent, so call it at startup every time. */
  migrate(): Promise<void>;
  /**
   * Register the code for a job name. In-process only: nothing is written to
   * the database, so every instance that should be able to run a job has to
   * call this on every boot.
   */
  define(name: string, handler: JobHandler, options?: { maxAttempts?: number }): void;
  /**
   * Run `name` repeatedly. Safe to call from every instance on every boot: the
   * occurrence row is shared, so ten instances booting produce one schedule.
   */
  schedule(name: string, spec: ScheduleSpec): Promise<void>;
  /** Queue one run. `runAt` in the future delays it. */
  enqueue(name: string, payload?: unknown, runAt?: Date): Promise<{ id: string }>;
  /** Begin polling. Idempotent. */
  start(): void;
  /** Stop polling and wait for whatever is already running to finish. */
  stop(): Promise<void>;
  /**
   * One poll pass, resolving when everything it claimed has finished. `start`
   * calls this on a timer; a test, or an app that would rather drive the queue
   * from its own loop or from an external cron, can call it directly.
   */
  tick(): Promise<number>;
  get(id: string): Promise<JobRun | null>;
  counts(): Promise<Record<JobState, number>>;
}

/**
 * One table. `jobs_queue` holds both one-off work and the next occurrence of
 * each schedule, which is what keeps this to a single claim path: a recurring
 * job is an ordinary row that happens to queue its successor when it finishes.
 *
 * The partial unique index is the load-bearing part of the recurring design.
 * It allows at most one live occurrence per schedule, so `schedule()` being
 * called by every booting instance cannot produce duplicates, and a retrying
 * occurrence cannot have a second one queued alongside it.
 */
export const JOBS_SCHEMA_SQL = `
create table if not exists jobs_queue (
  id text primary key,
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'pending',
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  interval_ms bigint,
  cron text,
  schedule_key text,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_queue_claimable on jobs_queue (run_at) where state = 'pending';
create index if not exists jobs_queue_stuck on jobs_queue (locked_at) where state = 'running';
create unique index if not exists jobs_queue_live_schedule on jobs_queue (schedule_key) where state in ('pending', 'running');
`;

interface ClaimedRow {
  id: string;
  name: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  run_at: string;
  interval_ms: string | number | null;
  cron: string | null;
  schedule_key: string | null;
}

/**
 * The claim. Exported because it is the one piece worth exercising on its own,
 * and because an app that wants to run a single job from an external worker
 * should not have to reimplement it and get the locking subtly wrong.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes this safe under real parallelism: the
 * row is locked inside the same statement that flips its state, and a second
 * instance arriving at the same moment steps over the locked row instead of
 * blocking on it. Without SKIP LOCKED, every instance queues behind the same
 * row and the pool serialises; without the row lock at all, two instances can
 * both read the row as pending before either writes.
 */
export async function claimNextJob(db: Db, lockedBy: string): Promise<ClaimedRow | null> {
  return db.one<ClaimedRow>(
    `update jobs_queue set
       state = 'running',
       attempts = attempts + 1,
       locked_at = now(),
       locked_by = $1,
       updated_at = now()
     where id = (
       select id from jobs_queue
         where state = 'pending' and run_at <= now()
         order by run_at
         limit 1
         for update skip locked
     )
     returning id, name, payload, attempts, max_attempts, run_at, interval_ms, cron, schedule_key`,
    [lockedBy],
  );
}

/** Exponential, capped, no jitter. Pure, so the schedule it produces is a thing a test can assert. */
export function backoffMs(attempt: number, baseMs = BACKOFF_BASE_MS, capMs = BACKOFF_CAP_MS): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(capMs, baseMs * 2 ** exponent);
}

export function createJobs(db: Db, options: JobsOptions = {}): Jobs {
  return new DbJobs(db, options);
}

class DbJobs implements Jobs {
  private readonly handlers = new Map<string, { handler: JobHandler; maxAttempts: number }>();
  private readonly instanceId: string;
  private readonly concurrency: number;
  private readonly maxScheduled: number;
  private readonly maxAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly visibilityTimeoutMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<unknown> | null = null;
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly options: JobsOptions,
  ) {
    this.instanceId = options.instanceId ?? `job_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    this.concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    this.maxScheduled = Math.max(0, options.maxScheduled ?? DEFAULT_MAX_SCHEDULED);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.pollIntervalMs = Math.max(50, options.pollIntervalMs ?? DEFAULT_POLL_MS);
    this.visibilityTimeoutMs = Math.max(1_000, options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_MS);
  }

  async migrate(): Promise<void> {
    // Split because some drivers refuse more than one statement per call.
    for (const statement of JOBS_SCHEMA_SQL.split(';')) {
      if (statement.trim()) await this.db.query(statement);
    }
  }

  define(name: string, handler: JobHandler, options: { maxAttempts?: number } = {}): void {
    assertName(name);
    this.handlers.set(name, { handler, maxAttempts: Math.max(1, options.maxAttempts ?? this.maxAttempts) });
  }

  async schedule(name: string, spec: ScheduleSpec): Promise<void> {
    assertName(name);
    // Requiring the handler first turns a misspelled name into an error at
    // boot instead of a schedule that quietly never runs anything.
    if (!this.handlers.has(name)) {
      throw new JobsError(`No handler is defined for "${name}". Call define() before schedule().`, 'unknown_job');
    }
    const parsed = parseSchedule(spec);
    await this.assertUnderScheduleCap(name);

    const first =
      parsed.kind === 'interval'
        ? new Date(Date.now() + parsed.ms)
        : nextCronTime(parsed.fields, new Date());
    await this.insertOccurrence(name, parsed, first);
  }

  async enqueue(name: string, payload: unknown = {}, runAt?: Date): Promise<{ id: string }> {
    assertName(name);
    // Deliberately not requiring a handler here. The normal deployment splits
    // a web process that enqueues from a worker process that runs, and the web
    // process has no reason to have the handler code loaded.
    const id = newJobId();
    await this.db.query(
      `insert into jobs_queue (id, name, payload, run_at, max_attempts) values ($1, $2, $3::jsonb, $4, $5)`,
      [id, name, JSON.stringify(payload ?? {}), (runAt ?? new Date()).toISOString(), this.maxAttemptsFor(name)],
    );
    return { id };
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      // A pass still in flight means the database or the handlers are slower
      // than the poll interval. Starting another would pile passes up, and it
      // would also leave stop() awaiting only the newest of them while the
      // older ones still held rows in 'running'.
      if (this.running) return;
      void this.tick().catch(() => {
        // A tick that cannot reach the database must not become an unhandled
        // rejection and take the host app's process down with it. The next
        // tick retries, which is the right behaviour for a database that is
        // briefly unreachable during a failover.
      });
    }, this.pollIntervalMs);
    // Without unref the interval keeps the event loop alive, so a CLI or a
    // one-off script that happens to build the adapter never exits.
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Let whatever is mid-flight finish rather than abandoning rows in
    // 'running', which would otherwise sit there until the visibility timeout.
    await this.running?.catch(() => undefined);
  }

  async tick(): Promise<number> {
    const pass = this.runPass();
    this.running = pass;
    try {
      return await pass;
    } finally {
      if (this.running === pass) this.running = null;
    }
  }

  async get(id: string): Promise<JobRun | null> {
    const row = await this.db.one<{
      id: string;
      name: string;
      state: JobState;
      attempts: number;
      max_attempts: number;
      run_at: string;
      last_error: string | null;
      schedule_key: string | null;
    }>(
      `select id, name, state, attempts, max_attempts, run_at, last_error, schedule_key
         from jobs_queue where id = $1`,
      [id],
    );
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      state: row.state,
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      runAt: new Date(row.run_at).toISOString(),
      lastError: row.last_error,
      scheduleKey: row.schedule_key,
    };
  }

  async counts(): Promise<Record<JobState, number>> {
    // count(*) is a bigint, which pg hands back as a string. Cast in SQL so
    // the caller is not quietly comparing '0' to 0.
    const rows = await this.db.query<{ state: JobState; n: number }>(
      `select state, count(*)::int as n from jobs_queue group by state`,
    );
    const counts: Record<JobState, number> = { pending: 0, running: 0, done: 0, dead: 0 };
    for (const row of rows) counts[row.state] = Number(row.n);
    return counts;
  }

  // -------------------------------------------------------------- internals

  private async runPass(): Promise<number> {
    await this.reapStuck();

    const claimed: ClaimedRow[] = [];
    for (let i = 0; i < this.concurrency; i += 1) {
      if (this.stopped) break;
      const row = await claimNextJob(this.db, this.instanceId);
      if (!row) break;
      claimed.push(row);
    }
    if (claimed.length === 0) return 0;

    // allSettled, not all: one handler that rejects in a way `execute` somehow
    // did not catch still must not stop its siblings from being settled.
    await Promise.allSettled(claimed.map((row) => this.execute(row)));
    return claimed.length;
  }

  /**
   * Returns a job whose handler this instance does not have, and does it
   * without consuming the attempt. This happens during a rolling deploy, when
   * a new job name exists in the new instances and not the old ones. Counting
   * it as a failed attempt would mean a job could reach `dead` purely because
   * the wrong instance looked at it five times.
   */
  private async execute(row: ClaimedRow): Promise<void> {
    const entry = this.handlers.get(row.name);
    if (!entry) {
      // Pushing run_at forward matters as much as giving the job back. An
      // instance that cannot run this name will claim it again the instant it
      // is due, so without the delay a rolling deploy turns into a hot loop
      // between the old instances and one job they will never be able to run.
      await this.db
        .query(
          `update jobs_queue set state = 'pending', attempts = greatest(0, attempts - 1),
             run_at = now() + ($3::double precision * interval '1 millisecond'),
             locked_at = null, locked_by = null, updated_at = now()
           where id = $1 and state = 'running' and locked_by = $2`,
          [row.id, this.instanceId, UNKNOWN_HANDLER_DELAY_MS],
        )
        .catch(() => undefined);
      return;
    }

    const ctx: JobContext = {
      id: row.id,
      name: row.name,
      attempt: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
    };

    try {
      // jsonb comes back parsed from pg and from PGlite, but a driver that
      // hands back the raw text would otherwise give the handler a string
      // where it expects an object.
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      await entry.handler(payload, ctx);
      await this.succeed(row);
    } catch (error) {
      // The whole point of this clause: a handler an app wrote badly, at three
      // in the morning, must not be able to crash the host app.
      try {
        this.options.onError?.(error, ctx);
      } catch {
        // A reporter that itself throws is not a reason to lose the job.
      }
      await this.fail(row, error);
    }
  }

  private async succeed(row: ClaimedRow): Promise<void> {
    await this.db.query(
      `update jobs_queue set state = 'done', locked_at = null, locked_by = null,
         last_error = null, updated_at = now()
       where id = $1`,
      [row.id],
    );
    await this.queueNext(row);
  }

  private async fail(row: ClaimedRow, error: unknown): Promise<void> {
    const attempts = Number(row.attempts);
    const maxAttempts = Number(row.max_attempts);
    const message = describe(error);

    if (attempts >= maxAttempts) {
      await this.db.query(
        `update jobs_queue set state = 'dead', locked_at = null, locked_by = null,
           last_error = $2, updated_at = now()
         where id = $1`,
        [row.id, message],
      );
      // A schedule survives its own bad day. If an exhausted occurrence did
      // not queue the next one, one outage would silently end the schedule for
      // the life of the app.
      await this.queueNext(row);
      return;
    }

    // The delay is computed by the database's clock, not this process's, so
    // instances whose clocks disagree still agree on when the retry is due.
    await this.db.query(
      `update jobs_queue set state = 'pending',
         run_at = now() + ($2::double precision * interval '1 millisecond'),
         locked_at = null, locked_by = null, last_error = $3, updated_at = now()
       where id = $1`,
      [row.id, backoffMs(attempts), message],
    );
  }

  /**
   * An occurrence that has reached a terminal state queues its successor. The
   * interval is measured from the occurrence's own due time so a schedule does
   * not drift by however long the handler took, but if the app was down long
   * enough that the next slot is already past, it starts again from now rather
   * than firing a backlog of missed runs all at once.
   */
  private async queueNext(row: ClaimedRow): Promise<void> {
    if (!row.schedule_key) return;

    let next: Date;
    if (row.cron) {
      next = nextCronTime(parseCron(row.cron), new Date());
    } else {
      // bigint arrives as a string from pg and as a number from PGlite.
      const ms = Math.max(MIN_INTERVAL_MS, Number(row.interval_ms ?? MIN_INTERVAL_MS));
      const fromDue = new Date(row.run_at).getTime() + ms;
      next = new Date(fromDue <= Date.now() ? Date.now() + ms : fromDue);
    }

    const spec: ParsedSchedule = row.cron
      ? { kind: 'cron', expr: row.cron, fields: parseCron(row.cron) }
      : { kind: 'interval', ms: Math.max(MIN_INTERVAL_MS, Number(row.interval_ms ?? MIN_INTERVAL_MS)) };
    await this.insertOccurrence(row.schedule_key, spec, next);
  }

  /**
   * The cap counts live schedules in the database, not in this process.
   *
   * It used to be a Set on the instance, which meant every process got its own
   * fresh budget while they all wrote the same table: two instances with a cap
   * of two could register four. A scheduled job is the one primitive that can
   * bill its owner forever, so the ceiling has to hold across the whole app.
   *
   * "Live" means the same thing the partial unique index means -- an
   * occurrence that is pending or running -- so a schedule counts once however
   * many times it has already run. Re-registering a name that is already live
   * is free, because a generated app calls schedule() on every boot.
   */
  private async assertUnderScheduleCap(name: string): Promise<void> {
    const row = await this.db.one<{ live: number; mine: number }>(
      `select count(distinct schedule_key)::int as live,
              count(*) filter (where schedule_key = $1)::int as mine
         from jobs_queue
        where schedule_key is not null and state in ('pending', 'running')`,
      [name],
    );
    if (Number(row?.mine ?? 0) > 0) return;
    if (Number(row?.live ?? 0) >= this.maxScheduled) {
      throw new JobsError(
        `This app already has ${this.maxScheduled} scheduled jobs, which is the cap. Raise maxScheduled if you mean to.`,
        'too_many_schedules',
      );
    }
  }

  private async insertOccurrence(name: string, spec: ParsedSchedule, runAt: Date): Promise<void> {
    // The conflict target names the partial index's predicate so Postgres can
    // infer it. Reaching here concurrently from two booting instances is the
    // expected case, and the loser doing nothing is the correct outcome.
    await this.db.query(
      `insert into jobs_queue (id, name, payload, run_at, max_attempts, interval_ms, cron, schedule_key)
         values ($1, $2, '{}'::jsonb, $3, $4, $5, $6, $7)
       on conflict (schedule_key) where state in ('pending', 'running') do nothing`,
      [
        newJobId(),
        name,
        runAt.toISOString(),
        this.maxAttemptsFor(name),
        spec.kind === 'interval' ? spec.ms : null,
        spec.kind === 'cron' ? spec.expr : null,
        name,
      ],
    );
  }

  /**
   * Hands back a job whose owner died holding it. The attempt it already spent
   * is not refunded on purpose: a handler that reliably kills the process
   * would otherwise be retried forever instead of reaching `dead`.
   */
  private async reapStuck(): Promise<void> {
    await this.db.query(
      `update jobs_queue set state = 'pending', locked_at = null, locked_by = null, updated_at = now()
       where state = 'running'
         and locked_at < now() - ($1::double precision * interval '1 millisecond')`,
      [this.visibilityTimeoutMs],
    );
  }

  private maxAttemptsFor(name: string): number {
    return this.handlers.get(name)?.maxAttempts ?? this.maxAttempts;
  }
}

// ---------------------------------------------------------------- schedules

type ParsedSchedule = { kind: 'interval'; ms: number } | { kind: 'cron'; expr: string; fields: CronFields };

export function parseSchedule(spec: ScheduleSpec): ParsedSchedule {
  if (typeof spec === 'number') return { kind: 'interval', ms: seconds(spec) };
  if (typeof spec === 'string') return { kind: 'cron', expr: spec.trim(), fields: parseCron(spec) };
  if ('everySeconds' in spec) return { kind: 'interval', ms: seconds(spec.everySeconds) };
  if ('everyMs' in spec) {
    if (!Number.isFinite(spec.everyMs)) throw new JobsError('An interval has to be a finite number.', 'bad_schedule');
    return { kind: 'interval', ms: Math.max(MIN_INTERVAL_MS, Math.floor(spec.everyMs)) };
  }
  return { kind: 'cron', expr: spec.cron.trim(), fields: parseCron(spec.cron) };
}

function seconds(value: number): number {
  if (!Number.isFinite(value)) throw new JobsError('An interval has to be a finite number of seconds.', 'bad_schedule');
  return Math.max(MIN_INTERVAL_MS, Math.floor(value * 1_000));
}

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  /**
   * Whether the field was narrowed from `*`. When both day fields are narrowed
   * the match is an OR, which is how every other cron behaves and is the one
   * rule people get wrong when they write their own.
   */
  domRestricted: boolean;
  dowRestricted: boolean;
}

/**
 * Five fields, UTC: minute hour day-of-month month day-of-week.
 *
 * The supported subset is `*`, a number, a `a-b` range, a `a,b` list, and a
 * `/n` step on either `*` or a range. That is all; there is no `@daily`, no
 * `L`, no `W`, no `#`, and no seconds field. Anything else is rejected at
 * schedule time, because a cron expression that is silently misread is worse
 * than one that will not load: the app boots, nothing ever runs, and there is
 * nothing in the logs to say why.
 */
export function parseCron(expr: string): CronFields {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new JobsError(
      'A cron expression needs exactly five fields: minute hour day-of-month month day-of-week.',
      'bad_schedule',
    );
  }
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  return {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dom: parseField(dom, 1, 31),
    month: parseField(month, 1, 12),
    // 7 and 0 are both Sunday, which is near-universal and is what people type.
    dow: new Set([...parseField(dow, 0, 7)].map((d) => (d === 7 ? 0 : d))),
    domRestricted: dom.trim() !== '*',
    dowRestricted: dow.trim() !== '*',
  };
}

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepText, ...rest] = part.split('/');
    if (rest.length > 0 || range === undefined || range === '') {
      throw new JobsError(`"${field}" is not a cron field this supports.`, 'bad_schedule');
    }
    let step = 1;
    if (stepText !== undefined) {
      step = Number(stepText);
      if (!Number.isInteger(step) || step < 1) {
        throw new JobsError(`"${field}" has a step that is not a whole number above zero.`, 'bad_schedule');
      }
    }

    let from: number;
    let to: number;
    if (range === '*') {
      from = min;
      to = max;
    } else if (range.includes('-')) {
      const bounds = range.split('-');
      if (bounds.length !== 2) throw new JobsError(`"${field}" is not a cron field this supports.`, 'bad_schedule');
      from = Number(bounds[0]);
      to = Number(bounds[1]);
    } else {
      from = Number(range);
      to = from;
    }

    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) {
      throw new JobsError(`"${field}" is outside ${min}-${max}, or its range runs backwards.`, 'bad_schedule');
    }
    for (let value = from; value <= to; value += step) out.add(value);
  }
  if (out.size === 0) throw new JobsError(`"${field}" matches nothing.`, 'bad_schedule');
  return out;
}

/**
 * The first UTC minute strictly after `after` that the expression matches.
 *
 * Minute-by-minute would be up to half a million iterations for a yearly job,
 * so this skips a whole month, day or hour as soon as that unit cannot match.
 * The five-year ceiling exists because expressions like `0 0 30 2 *` match no
 * date that will ever occur, and a search with no ceiling for those is a hang.
 */
export function nextCronTime(spec: string | CronFields, after: Date): Date {
  const fields = typeof spec === 'string' ? parseCron(spec) : spec;
  const start = new Date(after.getTime());
  start.setUTCSeconds(0, 0);
  let at = new Date(start.getTime() + 60_000);
  const ceiling = at.getTime() + 5 * 366 * 24 * 60 * 60 * 1_000;

  while (at.getTime() < ceiling) {
    if (!fields.month.has(at.getUTCMonth() + 1)) {
      at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 0, 0, 0, 0));
      continue;
    }
    if (!dayMatches(fields, at)) {
      at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1, 0, 0, 0, 0));
      continue;
    }
    if (!fields.hour.has(at.getUTCHours())) {
      at = new Date(
        Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours() + 1, 0, 0, 0),
      );
      continue;
    }
    if (!fields.minute.has(at.getUTCMinutes())) {
      at = new Date(at.getTime() + 60_000);
      continue;
    }
    return at;
  }
  throw new JobsError('That cron expression never comes round.', 'bad_schedule');
}

function dayMatches(fields: CronFields, at: Date): boolean {
  const domHit = fields.dom.has(at.getUTCDate());
  const dowHit = fields.dow.has(at.getUTCDay());
  if (fields.domRestricted && fields.dowRestricted) return domHit || dowHit;
  if (fields.domRestricted) return domHit;
  if (fields.dowRestricted) return dowHit;
  return true;
}

// ---------------------------------------------------------------- helpers

const newJobId = (): string => `job_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

function assertName(name: string): void {
  // The name is a schedule key and goes on an admin page, so keep it to
  // something that cannot be confused for anything else.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(name)) {
    throw new JobsError('A job name is 1-64 characters of letters, numbers, dot, colon, dash or underscore.', 'bad_name');
  }
}

/** Message only, truncated, never a stack and never the payload. */
function describe(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : 'the job failed';
  const message = raw.trim() || 'the job failed';
  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}…` : message;
}
