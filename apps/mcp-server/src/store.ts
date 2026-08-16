/**
 * Persistence behind an interface.
 *
 * The shape is deliberately that of a handful of Postgres tables keyed by
 * project id, so swapping the in-memory implementation for the real one is a
 * mechanical change and nothing above this file has to know.
 *
 * Run state is stored as a JSON string and parsed on every read, even in memory.
 * That is on purpose: the whole design rests on the state machine surviving a
 * reload from a row, and exercising that path on every local call means a bug
 * in it cannot hide until production.
 */
import type { GateError } from '@power/gates';
import { parseRunState, type RunState } from '@power/runstate';

export interface Project {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

/**
 * The two human decisions. Both are set only by a person in the browser and
 * never by a tool call — the server refuses to let the conversation clear them.
 */
export interface Approvals {
  spec_approved_at: string | null;
  spec_approval_requested_at: string | null;
  /** One-shot: consumed by the publish that uses it. */
  publish_confirmed_at: string | null;
  /** One-shot: typed confirmation for a destructive migration. Never set from chat. */
  migration_confirmed_at: string | null;
}

export type ArtifactName = 'SPEC.md' | 'verification.json' | 'research.json' | 'migration.json';

export interface Store {
  createProject(project: Project, state: RunState): Promise<void>;
  getProject(id: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;

  getRun(projectId: string): Promise<RunState>;
  putRun(projectId: string, state: RunState): Promise<void>;

  putArtifact(projectId: string, name: ArtifactName, raw: string): Promise<void>;
  getArtifacts(projectId: string): Promise<Partial<Record<ArtifactName, string>>>;

  /** The most recent failures per stage, so `open_gate_failures` can be rebuilt on any node. */
  putGateErrors(projectId: string, stage: string, errors: GateError[]): Promise<void>;
  getGateErrors(projectId: string): Promise<Partial<Record<string, GateError[]>>>;

  getApprovals(projectId: string): Promise<Approvals>;
  putApprovals(projectId: string, approvals: Approvals): Promise<void>;
}

export class NotFound extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFound';
  }
}

const emptyApprovals = (): Approvals => ({
  spec_approved_at: null,
  spec_approval_requested_at: null,
  publish_confirmed_at: null,
  migration_confirmed_at: null,
});

export class MemoryStore implements Store {
  private projects = new Map<string, Project>();
  private runs = new Map<string, string>();
  private artifacts = new Map<string, Partial<Record<ArtifactName, string>>>();
  private gateErrors = new Map<string, Partial<Record<string, GateError[]>>>();
  private approvals = new Map<string, Approvals>();

  async createProject(project: Project, state: RunState): Promise<void> {
    this.projects.set(project.id, project);
    this.runs.set(project.id, JSON.stringify(state));
    this.approvals.set(project.id, emptyApprovals());
  }

  async getProject(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getRun(projectId: string): Promise<RunState> {
    const raw = this.runs.get(projectId);
    if (raw === undefined) throw new NotFound(`run for project ${projectId}`);
    return parseRunState(raw);
  }

  async putRun(projectId: string, state: RunState): Promise<void> {
    this.runs.set(projectId, JSON.stringify(state));
  }

  async putArtifact(projectId: string, name: ArtifactName, raw: string): Promise<void> {
    const current = this.artifacts.get(projectId) ?? {};
    this.artifacts.set(projectId, { ...current, [name]: raw });
  }

  async getArtifacts(projectId: string): Promise<Partial<Record<ArtifactName, string>>> {
    return { ...(this.artifacts.get(projectId) ?? {}) };
  }

  async putGateErrors(projectId: string, stage: string, errors: GateError[]): Promise<void> {
    const current = this.gateErrors.get(projectId) ?? {};
    this.gateErrors.set(projectId, { ...current, [stage]: errors });
  }

  async getGateErrors(projectId: string): Promise<Partial<Record<string, GateError[]>>> {
    return { ...(this.gateErrors.get(projectId) ?? {}) };
  }

  async getApprovals(projectId: string): Promise<Approvals> {
    return { ...(this.approvals.get(projectId) ?? emptyApprovals()) };
  }

  async putApprovals(projectId: string, approvals: Approvals): Promise<void> {
    this.approvals.set(projectId, { ...approvals });
  }
}
