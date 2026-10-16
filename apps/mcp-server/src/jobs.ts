/**
 * Async job handles for slow tools.
 *
 * MCP clients time out on slow tools — commonly around 60s, sometimes less —
 * and `run_tests`, `add_dependency` and `propose_migration` can all exceed it.
 * A tool that times out looks broken to the model, and a model that thinks the
 * tool is broken stops.
 *
 * So a slow tool runs its work here, waits up to `waitMs` for it, and if it is
 * still running returns `{ status: 'running', job_id, poll_with: 'get_job' }`.
 * The model polls (free, unmetered). Most jobs finish inside the wait and the
 * model never sees a handle at all.
 *
 * In-process on purpose: the hosted control plane replaces this with a queue
 * and a jobs table, behind the same two functions.
 */
import { randomBytes } from 'node:crypto';

export type JobStatus = 'running' | 'done' | 'failed';

export interface Job<T = unknown> {
  id: string;
  tool: string;
  status: JobStatus;
  started_at: string;
  finished_at?: string;
  result?: T;
  error?: string;
}

/**
 * Who a job belongs to.
 *
 * Recorded because a job id alone used to be enough to read a job: one
 * registry served every principal and `get` checked nothing, so a leaked or
 * guessed id returned another tenant's tool output. The project is here for
 * the same reason the user is -- a late result has to be scrubbed against the
 * right project's secrets, and the poll that fetches it carries no project of
 * its own.
 */
export interface JobOwner {
  userId: string;
  projectId: string | null;
}

export type JobOutcome<T> =
  | { settled: true; job: Job<T> }
  | { settled: false; handle: { status: 'running'; job_id: string; poll_with: 'get_job'; started_at: string } };

const JOB_TTL_MS = 30 * 60 * 1000;

interface Entry {
  job: Job;
  promise: Promise<unknown>;
  owner: JobOwner;
  /** A late result is billed once, when it is collected. */
  billed: boolean;
}

export class Jobs {
  private jobs = new Map<string, Entry>();

  /** Start `work`, wait up to `waitMs` for it, return either the result or a handle. */
  async run<T>(tool: string, work: () => Promise<T>, waitMs: number, owner: JobOwner): Promise<JobOutcome<T>> {
    const id = `job_${randomBytes(6).toString('hex')}`;
    const job: Job<T> = { id, tool, status: 'running', started_at: new Date().toISOString() };
    const promise = work().then(
      (result) => {
        job.status = 'done';
        job.result = result;
        job.finished_at = new Date().toISOString();
      },
      (error: unknown) => {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        job.finished_at = new Date().toISOString();
      },
    );
    this.jobs.set(id, { job, promise, owner, billed: false });
    setTimeout(() => this.jobs.delete(id), JOB_TTL_MS).unref();

    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), waitMs).unref());
    const won = await Promise.race([promise.then(() => 'done' as const), timeout]);
    if (won === 'done') return { settled: true, job };
    return { settled: false, handle: { status: 'running', job_id: id, poll_with: 'get_job', started_at: job.started_at } };
  }

  /**
   * A job, but only for the person it belongs to.
   *
   * An unknown id and someone else's id are deliberately indistinguishable, so
   * polling cannot be used to discover that a job exists.
   */
  get(id: string, userId: string): Job | undefined {
    const entry = this.jobs.get(id);
    return entry && entry.owner.userId === userId ? entry.job : undefined;
  }

  /** Which project's secrets a late result has to be scrubbed against. */
  projectOf(id: string, userId: string): string | null {
    const entry = this.jobs.get(id);
    return entry && entry.owner.userId === userId ? entry.owner.projectId : null;
  }

  /**
   * Claim the bill for a finished job, once.
   *
   * A job that outlived the client's wait was reported as a refusal and had its
   * reservation released, so without this every slow metered tool was free and
   * the ledger recorded it as refused. Returns the tool name the first time the
   * finished job is collected, and nothing afterwards.
   */
  claimBill(id: string, userId: string): { tool: string; projectId: string | null } | null {
    const entry = this.jobs.get(id);
    if (!entry || entry.owner.userId !== userId) return null;
    if (entry.billed || entry.job.status === 'running') return null;
    entry.billed = true;
    return { tool: entry.job.tool, projectId: entry.owner.projectId };
  }
}
