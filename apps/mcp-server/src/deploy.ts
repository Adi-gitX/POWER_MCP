/**
 * Publishing, for real.
 *
 * Power operates no hosting. `publish_app` deploys to the account the person
 * already has, with a credential they supply through the browser form that
 * already exists, so what they get at the end is an app on infrastructure they
 * own and can keep without us.
 *
 * Before this, `publish_app` tagged git and copied a directory, and
 * `get_preview_url` returned a filesystem path. Both reported success and
 * neither produced anything anyone could open — which is the sort of thing a
 * reviewer finds in the first minute.
 *
 * The files come from the published tag rather than the working directory, so
 * a release can only contain committed work.
 */
import { createHash } from 'node:crypto';
import type { Sandbox } from './sandbox.js';

export type DeployTarget = 'production' | 'preview';
export type ReadyState = 'QUEUED' | 'INITIALIZING' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED';

export interface DeployCredential {
  token: string;
  teamId: string | null;
}

export interface Deployment {
  id: string;
  /** Host only, no scheme, as the provider returns it. */
  url: string;
  aliases: string[];
  ready_state: ReadyState;
  target: DeployTarget;
  created_at: string;
  inspector_url?: string;
}

export interface DeployRequest {
  projectName: string;
  target: DeployTarget;
  files: { path: string; bytes: Buffer }[];
  env?: Record<string, string>;
  meta?: Record<string, string>;
}

/**
 * Why a deploy failed, split into what the caller should do about it.
 *
 * `auth` means ask for a new credential; `quota` and `transport` mean try
 * later; `config` and `build` mean fix something and they will not improve on
 * their own. Reporting a 4xx as "try again later" is how a model ends up in a
 * retry loop against a broken configuration.
 */
export type DeployErrorKind = 'auth' | 'quota' | 'build' | 'transport' | 'config';

export class DeployError extends Error {
  constructor(
    message: string,
    readonly kind: DeployErrorKind,
    readonly logs: string[] = [],
  ) {
    super(message);
    this.name = 'DeployError';
  }

  get transient(): boolean {
    return this.kind === 'quota' || this.kind === 'transport';
  }
}

export interface Deployer {
  readonly provider: string;
  /** Does publishing need a credential from the person? Local development does not. */
  readonly requiresCredential: boolean;
  /** Check a credential and resolve the account it belongs to. */
  whoami(cred: DeployCredential): Promise<{ account: string }>;
  create(req: DeployRequest, cred: DeployCredential): Promise<Deployment>;
  waitForReady(id: string, cred: DeployCredential, budgetMs: number): Promise<Deployment>;
  get(id: string, cred: DeployCredential): Promise<Deployment>;
  list(projectName: string, cred: DeployCredential, target: DeployTarget, limit?: number): Promise<Deployment[]>;
  /** Make an already-ready deployment the production one. No rebuild. */
  promote(projectName: string, deploymentId: string, cred: DeployCredential): Promise<Deployment>;
  remove(id: string, cred: DeployCredential): Promise<void>;
  /**
   * Whether the account already has a hosting project of this name. Asked
   * before a project's first publish, so Power never deploys into a project it
   * did not create. Providers without named projects omit it.
   */
  projectExists?(projectName: string, cred: DeployCredential): Promise<boolean>;
  buildLogs(id: string, cred: DeployCredential, limit?: number): Promise<string[]>;
}

/** Collect a release's files from git, with the guards a deploy needs. */
export async function collectRelease(
  sandbox: Sandbox,
  projectId: string,
  ref: string,
  limits = { maxFiles: 10_000, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 100 * 1024 * 1024 },
): Promise<{ path: string; bytes: Buffer }[]> {
  const listed = await sandbox.filesAt(projectId, ref);
  if (listed.length === 0) throw new DeployError(`${ref} contains no files to deploy`, 'config');
  if (listed.length > limits.maxFiles) {
    throw new DeployError(`${ref} has ${listed.length} files, more than the ${limits.maxFiles} a deploy allows`, 'config');
  }

  const tooBig = listed.filter((f) => f.size > limits.maxFileBytes);
  if (tooBig.length) {
    // Name them: "something is too big" is not something a model can act on.
    throw new DeployError(
      `these files are larger than ${limits.maxFileBytes} bytes and cannot be deployed: ${tooBig.map((f) => f.path).join(', ')}`,
      'config',
    );
  }

  const total = listed.reduce((sum, f) => sum + f.size, 0);
  if (total > limits.maxTotalBytes) {
    throw new DeployError(`${ref} is ${total} bytes, more than the ${limits.maxTotalBytes} a deploy allows`, 'config');
  }

  const files: { path: string; bytes: Buffer }[] = [];
  for (const file of listed) {
    files.push({ path: file.path, bytes: await sandbox.readAt(projectId, ref, file.path) });
  }
  return files;
}

export const sha1 = (bytes: Buffer): string => createHash('sha1').update(bytes).digest('hex');

/** A project name the provider will accept, derived from the slug. */
/**
 * The hosting project a Power app publishes to.
 *
 * Prefixed and suffixed with the project id, because a hosting account is
 * shared with everything else its owner runs: a bare slug like `site` or
 * `dashboard` names a project that may already exist, and Vercel deploys into
 * an existing project of the same name, replacing that app's production.
 */
export function deployProjectName(slug: string, projectId: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  const id = clean(projectId).replace(/-/g, '').slice(0, 6) || 'app';
  const base = clean(slug).slice(0, 100 - 'power--'.length - id.length).replace(/-+$/, '') || 'app';
  return `power-${base}-${id}`;
}
