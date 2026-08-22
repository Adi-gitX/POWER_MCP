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

export type JobOutcome<T> =
  | { settled: true; job: Job<T> }
  | { settled: false; handle: { status: 'running'; job_id: string; poll_with: 'get_job'; started_at: string } };

const JOB_TTL_MS = 30 * 60 * 1000;

export class Jobs {
  private jobs = new Map<string, { job: Job; promise: Promise<unknown> }>();

  /** Start `work`, wait up to `waitMs` for it, return either the result or a handle. */
  async run<T>(tool: string, work: () => Promise<T>, waitMs: number): Promise<JobOutcome<T>> {
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
    this.jobs.set(id, { job, promise });
    setTimeout(() => this.jobs.delete(id), JOB_TTL_MS).unref();

    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), waitMs).unref());
    const won = await Promise.race([promise.then(() => 'done' as const), timeout]);
    if (won === 'done') return { settled: true, job };
    return { settled: false, handle: { status: 'running', job_id: id, poll_with: 'get_job', started_at: job.started_at } };
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id)?.job;
  }
}
