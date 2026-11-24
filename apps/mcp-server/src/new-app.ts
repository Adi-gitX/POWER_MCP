/**
 * "New app": the server half of the dialog.
 *
 * One request starts a setup job; the dialog polls it every two seconds and
 * shows each stage as the server finishes it, the way the reference flow
 * does. Every stage does real work: the project and its workbench, the
 * assistant's connection, the hosting account, the database. A stage that
 * needs the person (hosting not connected yet) stops the job with a banner
 * and resumes by itself once the condition holds.
 *
 * Jobs live in memory: they last a minute, belong to one browser tab, and a
 * restart just means starting the dialog again. The project they create is
 * persisted like any other.
 */
import { randomBytes } from 'node:crypto';

export type StageId = 'prepare' | 'project' | 'connect' | 'hosting' | 'database' | 'finish';
export type StageState = 'waiting' | 'working' | 'done' | 'attention' | 'skipped' | 'failed';

export interface StageView {
  id: StageId;
  title: string;
  state: StageState;
  detail?: string;
}

export interface Blocker {
  stage: StageId;
  title: string;
  description: string;
  /** Opens in a new tab; the job notices when it is done. */
  action?: { label: string; href: string };
  canSkip: boolean;
}

export interface AppJob {
  id: string;
  user: string;
  tool: string;
  name: string;
  description: string;
  mode: 'standard' | 'power_up';
  importPath: string | null;
  projectId: string | null;
  /** A one-time setup code when the tool is not connected yet, for the hand-off message. */
  installCode: string | null;
  stages: StageView[];
  blocker: Blocker | null;
  failure: string | null;
  done: boolean;
  createdAt: number;
}

export interface JobDeps {
  /** Reserves one build action, as create_project does. False when the allowance is spent. */
  reserve(user: string): Promise<boolean>;
  createProject(job: AppJob): Promise<string>;
  /** Is this tool already connected to the account? */
  toolConnected(user: string, tool: string): Promise<boolean>;
  mintSetupCode(user: string, tool: string): Promise<string>;
  /** The hosting account, when one is connected. */
  hosting(user: string): Promise<{ account: string } | null>;
  /** Whether this server publishes to Vercel at all, or to local previews. */
  hostingLabel: string;
  provisionDatabase(projectId: string): Promise<void>;
  finish(job: AppJob): Promise<void>;
  toolName(tool: string): string;
  connectHref: string;
}

const STAGES: ReadonlyArray<{ id: StageId; title: (job: AppJob, deps: JobDeps) => string }> = [
  { id: 'prepare', title: () => 'Preparing setup' },
  { id: 'project', title: (j) => (j.importPath ? 'Setting up the project for your code' : 'Creating the project and its workbench') },
  { id: 'connect', title: (j, d) => `Connecting ${d.toolName(j.tool)} to your account` },
  { id: 'hosting', title: () => 'Setting up hosting on Vercel' },
  { id: 'database', title: () => 'Preparing the database' },
  { id: 'finish', title: () => 'Finishing setup' },
];

/** A visible stage takes at least this long, so the checklist reads as progress rather than a flash. */
const MIN_STAGE_MS = 450;
const JOB_TTL_MS = 30 * 60 * 1000;

export class AppJobs {
  private readonly jobs = new Map<string, AppJob>();

  constructor(private readonly deps: JobDeps) {}

  start(input: { user: string; tool: string; name: string; description: string; mode: 'standard' | 'power_up'; importPath: string | null }): AppJob {
    this.sweep();
    const job: AppJob = {
      id: randomBytes(9).toString('base64url'),
      ...input,
      projectId: null,
      installCode: null,
      stages: [],
      blocker: null,
      failure: null,
      done: false,
      createdAt: Date.now(),
    };
    job.stages = STAGES.map((s) => ({ id: s.id, title: s.title(job, this.deps), state: 'waiting' as const }));
    this.jobs.set(job.id, job);
    void this.run(job);
    return job;
  }

  /** A job for its owner only; someone else's id reads as no job at all. */
  get(id: string, user: string): AppJob | null {
    const job = this.jobs.get(id);
    return job && job.user === user ? job : null;
  }

  /** Re-check whatever stopped the job; it carries on by itself if it now holds. */
  async retry(job: AppJob): Promise<void> {
    if (!job.blocker) return;
    if (job.blocker.stage === 'hosting' && (await this.deps.hosting(job.user))) {
      job.blocker = null;
      void this.run(job);
    }
  }

  skip(job: AppJob): void {
    if (!job.blocker?.canSkip) return;
    const stage = job.stages.find((s) => s.id === job.blocker!.stage)!;
    stage.state = 'skipped';
    stage.detail = 'Skipped. Previews work without it; Power asks again when you publish.';
    job.blocker = null;
    void this.run(job);
  }

  private set(job: AppJob, id: StageId, state: StageState, detail?: string): void {
    const stage = job.stages.find((s) => s.id === id)!;
    stage.state = state;
    if (detail === undefined) delete stage.detail;
    else stage.detail = detail;
  }

  /** Runs from the first unfinished stage. Re-entrant after a blocker clears. */
  private async run(job: AppJob): Promise<void> {
    const paced = async <T>(work: () => Promise<T>): Promise<T> => {
      const started = Date.now();
      const out = await work();
      const left = MIN_STAGE_MS - (Date.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      return out;
    };
    try {
      for (const stage of job.stages) {
        if (stage.state === 'done' || stage.state === 'skipped') continue;
        if (job.blocker || job.failure) return;
        this.set(job, stage.id, 'working');
        switch (stage.id) {
          case 'prepare': {
            const ok = await paced(() => this.deps.reserve(job.user));
            if (!ok) return this.fail(job, 'prepare', 'Today’s build actions are used up. They reset at midnight UTC.');
            this.set(job, 'prepare', 'done');
            break;
          }
          case 'project':
            job.projectId = await paced(() => this.deps.createProject(job));
            this.set(job, 'project', 'done', job.mode === 'power_up' ? 'Power Up: research, a plan you approve, verification' : 'Straight to the build');
            break;
          case 'connect': {
            const connected = await paced(() => this.deps.toolConnected(job.user, job.tool));
            if (!connected) job.installCode = await this.deps.mintSetupCode(job.user, job.tool);
            this.set(job, 'connect', 'done', connected ? 'Already connected' : `${this.deps.toolName(job.tool)} connects itself from the first message`);
            break;
          }
          case 'hosting': {
            const hosting = await paced(() => this.deps.hosting(job.user));
            if (!hosting) {
              this.set(job, 'hosting', 'attention');
              job.blocker = {
                stage: 'hosting',
                title: 'Connect your Vercel account',
                description: 'Apps publish to your own Vercel account. Connect it in the tab that opens, and setup carries on by itself.',
                action: { label: 'Connect Vercel', href: this.deps.connectHref },
                canSkip: true,
              };
              return;
            }
            this.set(job, 'hosting', 'done', `${hosting.account}${this.deps.hostingLabel ? ` · ${this.deps.hostingLabel}` : ''}`);
            break;
          }
          case 'database':
            await paced(() => this.deps.provisionDatabase(job.projectId!));
            this.set(job, 'database', 'done', 'A live branch and a safe copy to work against');
            break;
          case 'finish':
            await paced(() => this.deps.finish(job));
            this.set(job, 'finish', 'done');
            job.done = true;
            break;
        }
      }
    } catch (error) {
      const at = job.stages.find((s) => s.state === 'working')?.id ?? 'prepare';
      console.error('[power] new app setup failed at', at, error);
      this.fail(job, at, 'Setup hit an error. Try again; if it keeps happening, the server log says why.');
    }
  }

  private fail(job: AppJob, stage: StageId, message: string): void {
    this.set(job, stage, 'failed');
    job.failure = message;
  }

  private sweep(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of this.jobs) if (job.createdAt < cutoff) this.jobs.delete(id);
  }
}

/** What the dialog renders for a job: no internals, and the code only once setup is done. */
export function jobView(job: AppJob) {
  return {
    id: job.id,
    name: job.name,
    stages: job.stages,
    blocker: job.blocker,
    failure: job.failure,
    done: job.done,
    project_id: job.done ? job.projectId : null,
  };
}

/** App names become project slugs: lowercase letters, digits and single hyphens. */
export const APP_NAME = /^[a-z](?:[a-z0-9]|-[a-z0-9]){0,29}$/;
