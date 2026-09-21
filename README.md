# Power

An MCP server that builds and hosts full-stack apps — where the AI's work is graded by code before the user ever sees it.

You bring the model (Claude, ChatGPT, Cursor — anything that speaks MCP). Power provides the workbench, the database, the secrets, checks the work against deterministic gates, and ships it. Bring-your-own-inference, metered tool calls, flat pricing — and one structural difference from every other AI app builder: **the AI can't mark its own homework.**

```
plan (submit_spec) → human approves → build (run_tests until green) → verify (submit_verification) → publish_app
                                        └─ propose_migration → gate → promote_migration ─┘
```

Every arrow is a gate enforced by the server. A model that skips a step is told, in the tool result, exactly what to do instead.

## Run it locally

```sh
pnpm install
pnpm check        # typecheck + 88 unit tests
pnpm dev          # MCP at http://localhost:4321/mcp, web companion at http://localhost:4321/
```

Connect a client:

```sh
claude mcp add --transport http power http://localhost:4321/mcp
```

Then in Claude Code: *"With power, build me a tip splitter."* When it ships and you want more, *"add a whisper function"* starts a new run against the same project — same code, checkpoints, database and secrets, fresh plan and fresh retry budget. The four decisions only a human may make — approve the plan, confirm a publish, type a confirmation for a destructive data change, paste a secret — happen in the browser at URLs the assistant gives you. The conversation can ask; it cannot answer.

Two ways to exercise the whole pipeline without typing:

```sh
pnpm e2e                    # a real MCP client walks all 74 gate checks deterministically
scripts/eval-claude.sh      # a real Claude session does it, and the summary shows how it handled every refusal
```

The product site: `pnpm dev:web` → http://localhost:4000/ (or `pnpm build:web` → `apps/web/dist`). **Publishing it:** push to `main` and `.github/workflows/deploy-site.yml` deploys to GitHub Pages (enable Pages → Source: GitHub Actions once, and set the repo variable `SITE_URL` to your domain). Or connect the repo to Vercel with root `apps/web` — `vercel.json` is there. Third-party notices: `apps/web/THIRD_PARTY.md`.

Environment: `POWER_TOKENS=tok:alice:pro,…` switches on bearer auth; `REDIS_URL` moves quota to Redis; `POWER_LOCAL_ROOT` sets the data directory.

## Layout

| Path | What |
|---|---|
| `packages/gates` | Deterministic validators for `SPEC.md`, `verification.json`, `research.json`, and schema migrations. Pure functions; every failure names artifact, field, rule, remedy. |
| `packages/runstate` | The phase machine. Pure reducer over a plain object, reloaded from storage on every call. Counted retries, capped at 2, then the run blocks and asks a human. |
| `packages/protocol` | The response envelope, tool registry, guard, and `next_action` derivation. The part the whole product rests on. |
| `packages/sdk` | `@power/sdk`: what a generated app imports. `PowerAdapter` and `SelfHostAdapter` behind one interface, so an export runs unchanged. |
| `apps/web` | The product site: landing, pricing, docs, proof. Static HTML generated from the tool registry, plan limits and the committed eval transcripts, so it cannot drift from what the server does. `pnpm dev:web`. |
| `apps/mcp-server` | Streamable HTTP MCP server; handlers; git-backed sandbox; Postgres control plane with forced RLS (PGlite locally); database driver with live/workbench branches; metering; secrets; async jobs; the web companion. |

## The ideas, and where each lives

**Refusals are not errors.** A gate rejection is a *successful* tool result whose payload says `ok: false`, with `failures[]` in an actionable shape and a concrete `next_action`. Client models treat protocol errors as "the tool is broken" and stop; they treat this as feedback and comply. — `packages/protocol/src/envelope.ts`

**Re-ground on every call.** Every response carries a `context` block: phase, open failures, retries left, next action. Nothing depends on the client remembering anything, so the pipeline survives context compaction, `/clear`, and switching from Claude to Cursor mid-project. — `packages/protocol/src/guidance.ts`

**The client's model plays every role.** Architect, implementer and verifier briefs are delivered as tool-response payloads at the moment they're needed, not as system prompts we'd pay to run. Zero inference cost on our side, by construction. — `apps/mcp-server/src/prompts.ts`

**Two databases, a gate in between.** Every project has a *live* branch and a *safe copy*. There is no tool that runs SQL against live — `execute_sql` does not exist. Schema changes are rehearsed on a scratch copy of live (does `up` apply? does `down` reverse it exactly? will it lock a big table?) before they can be promoted, and a change that can lose data needs the project name typed in the browser. — `packages/gates/src/migration.ts`, `apps/mcp-server/src/db.ts`

**You only pay for work that passed.** A build action is reserved before a call and released if the outcome was a refusal or an error. Reads and `export_project` are free, permanently. — `apps/mcp-server/src/metering.ts`, `packages/protocol/src/tools.ts`

**Secrets never touch the conversation.** `request_secret` returns a single-use browser form. The value is injected into the sandbox as an environment variable, scoped to workbench or live, and a scrubber redacts every known value from every tool result — including a `console.log(process.env)` in the user's own tests. — `apps/mcp-server/src/secrets.ts`

**Git is the substrate.** Checkpoints are commits with `Power-*` trailers at gate boundaries; restore is `reset --hard`; publish is a tag plus a clean clone; rollback re-tags the previous release; export is a `git bundle` with full history. The template ships `.env.example` and `docker-compose.yml` so the export has somewhere to run. — `apps/mcp-server/src/sandbox.ts`

**Tenant isolation is a database policy, not application discipline.** Every control-plane table has forced row-level security keyed to a session setting; child tables are scoped by project *ownership*, which the test suite proves by trying a cross-tenant write. — `apps/mcp-server/src/pgstore.ts`

## What is local-only today, and what replaces it

| Today (local, tested) | Hosted (behind the same interface) |
|---|---|
| `LocalSandbox` — a directory + git per project | Fly Machines: one app per project, `workbench` and `prod` machines, in-VM agent daemon |
| `PgliteDriver` — branches are directory copies | Neon: one project per project, copy-on-write branches |
| `openPgliteControlPlane` | Managed Postgres, same schema and RLS |
| `MemorySecrets` | Envelope-encrypted store + per-project egress allowlist |
| `MemoryQuota` / `FileLedger` | Redis (`RedisQuota` is already here) / Postgres ledger |
| `DevAuthenticator` / `TokenAuthenticator` | OAuth 2.1 + dynamic client registration via a vendor IdP |
| `Jobs` (in-process) | Queue + jobs table |

Not started: preview URLs (the local sandbox has no dev server), click-to-select and annotation, GitHub mirror, custom domains, and integration playbooks. (The knowledge packs in the local product are Python/FastAPI-shaped and were deliberately not ported; they would mislead a TypeScript build.) The export-runs-anywhere CI job exists in `.github/workflows/ci.yml` but has not yet run on a hosted runner.

## Verified by running

- `pnpm check`: 88 unit tests across gates, run state, guard, migration gate, jobs, metering, secrets, DB driver (real Postgres via PGlite), and RLS.
- `pnpm e2e`: 74 end-to-end steps through a real MCP client — every phase gate, both human approvals, the migration gate and typed confirmation, a leaked secret caught by the scrubber, billing on the envelope, a second run started on the shipped project with the gates re-armed, and a `git log` with gate trailers at the end.
- `scripts/eval-claude.sh`: a real Claude Code session, three phases with human approvals between them, and a summary of what the model did after each `ok: false`. **First run (Sonnet 4.5, 2026-09-21): 12 tool calls, 1 refusal, 0 protocol errors.** The spec gate rejected the first plan for two tasks without requirement references; the model fixed exactly that and passed. It never attempted an out-of-phase call, stopped at both human gates, and shipped v1 with 15 passing tests. Report and transcripts: `docs/evals/`.
