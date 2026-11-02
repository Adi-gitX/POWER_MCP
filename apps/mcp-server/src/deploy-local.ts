/**
 * A deployer for local development and for the end-to-end suite.
 *
 * It writes the release to a directory the server serves, so `publish_app`
 * produces a URL you can actually open without anyone having a hosting
 * account. That matters for more than tests: the first thing someone does
 * with Power is run it locally, and a publish that cannot be opened teaches
 * them nothing.
 *
 * It is selected explicitly with `POWER_DEPLOYER=local` and never by falling
 * back, because a publish that silently went nowhere real would be exactly
 * the failure this whole change set exists to remove.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  type DeployCredential,
  type DeployRequest,
  type Deployer,
  type Deployment,
  type DeployTarget,
} from './deploy.js';

export class LocalDeployer implements Deployer {
  readonly provider = 'local';
  /** Nothing to authenticate against: the files land on this machine. */
  readonly requiresCredential = false;

  private sequence = 0;

  constructor(
    private readonly root: string,
    private readonly baseUrl: string,
  ) {}

  async whoami(): Promise<{ account: string }> {
    return { account: 'local' };
  }

  async create(req: DeployRequest): Promise<Deployment> {
    this.sequence += 1;
    const id = `dpl_local_${Date.now().toString(36)}_${this.sequence}`;
    const dir = this.dirFor(id);
    await rm(dir, { recursive: true, force: true });

    for (const file of req.files) {
      const target = resolve(dir, file.path);
      // A path in the release must not escape the deployment directory.
      if (target !== dir && !target.startsWith(dir + sep)) {
        throw new Error(`refusing to write outside the deployment: ${file.path}`);
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.bytes);
    }

    return {
      id,
      url: `${this.hostPart()}/previews/${id}/`,
      aliases: [],
      ready_state: 'READY',
      target: req.target,
      created_at: new Date().toISOString(),
    };
  }

  async waitForReady(id: string): Promise<Deployment> {
    return this.get(id);
  }

  async get(id: string): Promise<Deployment> {
    return {
      id,
      url: `${this.hostPart()}/previews/${id}/`,
      aliases: [],
      ready_state: 'READY',
      target: 'production',
      created_at: new Date().toISOString(),
    };
  }

  async list(): Promise<Deployment[]> {
    return [];
  }

  async promote(_projectName: string, deploymentId: string): Promise<Deployment> {
    return this.get(deploymentId);
  }

  async remove(id: string): Promise<void> {
    await rm(this.dirFor(id), { recursive: true, force: true });
  }

  async buildLogs(): Promise<string[]> {
    return ['local deployer: files written, no build step'];
  }

  dirFor(id: string): string {
    if (!/^dpl_local_[a-z0-9_]+$/.test(id)) throw new Error(`not a local deployment id: ${id}`);
    return resolve(join(this.root, id));
  }

  /** Callers prepend https://, so the scheme is stripped here and added back by the route. */
  /**
   * A deployment URL is a URL, not a host and a path glued together. It used to
   * drop the scheme, which made every stored link unparseable: `new URL()` reads
   * `localhost:` as a protocol, and a browser treats the result as relative.
   */
  private hostPart(): string {
    return this.baseUrl.replace(/\/+$/, '');
  }
}

export const unusedCredential: DeployCredential = { token: '', teamId: null };
export type { DeployTarget };
