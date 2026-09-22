# Power

**An MCP server that builds, checks and hosts full-stack apps — where the model's work is graded by code before a person ever sees it.**

You bring the model. Claude, ChatGPT, Cursor, anything that speaks MCP. Power brings the workbench, the database, the secrets, the deterministic gates and the hosting. Inference runs on the subscription you already pay for, so there is no token markup; you are metered on build actions instead.

The structural difference from every other AI app builder is one sentence: **the AI cannot mark its own homework.**

```
intake → research → research_review → spec → spec_approval → build → verify → done
                                        │         │            │        │
                                   research    a human      tests    a human
                                     gate      approves     must be  confirms
                                                the plan     green   the publish
                                        └──────────── blocked ───────────┘
                                             (retries exhausted)
```

Every arrow is a gate enforced by the server, not a suggestion in a prompt. A model that skips a step gets a successful tool result whose payload says `ok: false` and names exactly what to do instead.

---

## Contents

- [Quick start](#quick-start)
- [What a run actually looks like](#what-a-run-actually-looks-like)
- [Repository map](#repository-map)
- [How a tool call flows through the server](#how-a-tool-call-flows-through-the-server)
- [The ideas, and where each one lives](#the-ideas-and-where-each-one-lives)
- [The tool registry](#the-tool-registry)
- [The phase machine](#the-phase-machine)
- [The gates](#the-gates)
- [Data: two branches and a gate between them](#data-two-branches-and-a-gate-between-them)
- [Metering and plans](#metering-and-plans)
- [Security and tenant isolation](#security-and-tenant-isolation)
- [The product site](#the-product-site)
- [Verification](#verification)
- [Configuration](#configuration)
- [Local today, hosted later](#local-today-hosted-later)
- [Not started](#not-started)

---

## Quick start

Requires Node 22 or newer and pnpm 10.

```sh
pnpm install
pnpm check        # typecheck + 88 unit tests
pnpm dev          # MCP at http://localhost:4321/mcp, browser companion at http://localhost:4321/
```

Point a client at it:

```sh
claude mcp add --transport http power http://localhost:4321/mcp
```

Then, in that client:

> *"With power, build me a tip splitter: enter the bill, the tip percentage and the number of people, get what each person owes."*

When it ships and you want the next thing, *"add a way to split unevenly"* starts a **new run against the same project** — same code, checkpoints, database and secrets, a fresh plan and a fresh retry budget.

### The decisions a model may never make

Four things happen in your browser, at URLs the assistant hands you, never in the conversation:

| Decision | Where | Why it is not the model's to make |
|---|---|---|
| Approve the plan | `/projects/:id` → approve-spec | Nothing is built until a person has read the spec |
| Confirm a publish | `/projects/:id` → confirm-publish | Publishing changes what real users see |
| Confirm a destructive migration | `/projects/:id` → confirm-migration | Requires typing the project name |
| Provide a secret | `/secrets/:token` | Single-use form; the value never enters the transcript |

The conversation can ask for any of these. It cannot answer them.

---

## What a run actually looks like

Two ways to watch the whole pipeline without typing anything.

```sh
# 1. A real MCP client walks all 74 gate checks, deterministically.
#    NOTE: this talks to a running server — start `pnpm dev` in another shell first.
pnpm dev &
pnpm e2e

# 2. A real Claude session does it, and the summary shows how it
#    handled every refusal along the way.
scripts/eval-claude.sh
```

The e2e run is organised as the product is: *plan · human approves in the browser · build · data (two branches, a gate in between) · secrets (never in the conversation) · verify · ship · the second hour (a new run on a shipped project) · the exit · metering.*

---

## Repository map

A pnpm workspace. Four libraries, two apps.

| Path | What it is |
|---|---|
| `packages/gates` | Deterministic validators for `research.json`, `SPEC.md`, `verification.json` and schema migrations. Pure functions. Every failure names the artifact, the field, a stable rule id, and what would satisfy it. |
| `packages/runstate` | The phase machine. A pure reducer over a plain object, reloaded from storage on every call. Retries are counted, capped at two, then the run blocks and asks a person. |
| `packages/protocol` | The response envelope, the 52-tool registry, the guard that decides what is legal right now, `next_action` derivation, and the plan limits. The part everything else rests on. |
| `packages/sdk` | `@power/sdk`, what a generated app imports. `PowerAdapter` and `SelfHostAdapter` behind one interface, so an exported project runs unchanged off our infrastructure. |
| `apps/mcp-server` | The server: Streamable HTTP MCP endpoint, tool handlers, git-backed sandbox, Postgres control plane with forced row-level security (PGlite locally), the database driver with live and workbench branches, metering, secrets, async jobs, and the browser companion. |
| `apps/site` | The product site: landing, pricing, docs, proof. Next.js 15, React 19, statically exported. Reads the tool registry, the plan limits and the committed eval transcripts at build time, so it cannot claim something the server does not do. |

### Inside `apps/mcp-server/src`

| File | Responsibility |
|---|---|
| `index.ts` | HTTP entry. Routes `/mcp`, `/health`, `/secrets/:token`, `/projects/:id` and its approval endpoints. |
| `server.ts` | MCP wiring: tool listing, dispatch, and the reload-state-after-every-handler rule. |
| `handlers.ts` | Every tool implementation. |
| `guard` (in `packages/protocol`) | Whether this tool is legal in this phase, with human checks last. |
| `respond.ts` | Builds the envelope: `ok`, `failures[]`, `context`, `next_action`. |
| `store.ts` / `pgstore.ts` | Control plane. Projects, runs, artifacts, approvals. RLS is forced at the table level. |
| `db.ts` | Project databases. Live and workbench branches, migration rehearsal, row caps. |
| `sandbox.ts` | `LocalSandbox`: a directory and a git repo per project. Checkpoints are commits. |
| `secrets.ts` | Single-use browser forms, env injection scoped to an environment, and a scrubber over every tool result. |
| `metering.ts` | Reserve before the call, release on refusal or error. |
| `jobs.ts` | In-process async jobs for the eleven slow tools. |
| `auth.ts` | `DevAuthenticator` and `TokenAuthenticator`. |
| `prompts.ts` | Architect, implementer and verifier briefs, delivered as tool-response payloads. |
| `e2e.ts` | The 74-step end-to-end walk. |
| `infra.test.ts` | 18 infrastructure tests, including a cross-tenant write that must fail. |

---

## How a tool call flows through the server

```
client tool call
      │
      ├─ auth.ts            resolve the principal (dev, or bearer token)
      ├─ store              load the project and the run state, fresh, every time
      ├─ guard              is this tool legal in this phase?
      │                     ordering matters: phase → gate → human, human checked last
      ├─ metering           reserve one build action (skipped for the 16 free tools)
      ├─ handlers           do the work
      ├─ gates              validate the artifact it produced, if any
      ├─ runstate           apply the resulting event; retries counted, capped at 2
      ├─ metering           release the reservation if the outcome was a refusal or an error
      ├─ secrets            scrub every known secret value out of the payload
      └─ respond            envelope: ok / failures[] / message, plus the context block
                            (phase, open gate failures, loops remaining, next_action)
```

Two properties fall out of this shape:

**State is never trusted from the client.** It is reloaded from storage after every handler, so a run survives context compaction, `/clear`, and switching from Claude to Cursor halfway through.

**A refusal is a success.** It is an HTTP 200 with a payload that says `ok: false`. Client models treat protocol errors as "this tool is broken" and give up; they treat this as feedback and comply.

---

## The ideas, and where each one lives

**Refusals are not errors.** A gate rejection is a *successful* tool result whose payload says `ok: false`, with `failures[]` in an actionable shape and a concrete `next_action`. — `packages/protocol/src/envelope.ts`

**Re-ground on every call.** Every response carries a `context` block: phase, open failures, retries left, next action. Nothing depends on the client remembering anything. — `packages/protocol/src/guidance.ts`

**The client's model plays every role.** Architect, implementer and verifier briefs are delivered as tool-response payloads at the moment they are needed, not as system prompts we would pay to run. Zero inference cost on our side, by construction. — `apps/mcp-server/src/prompts.ts`

**Two databases, a gate in between.** Every project has a *live* branch and a *safe copy*. There is no tool that runs SQL against live — `execute_sql` does not exist, and that is absence, not a restriction. Schema changes are rehearsed on a scratch copy of live (does `up` apply? does `down` reverse it exactly? will it lock a large table?) before they can be promoted, and a change that can lose data needs the project name typed in the browser. — `packages/gates/src/migration.ts`, `apps/mcp-server/src/db.ts`

**You only pay for work that passed.** A build action is reserved before a call and released if the outcome was a refusal or an error. Reads and `export_project` are free, permanently. — `apps/mcp-server/src/metering.ts`, `packages/protocol/src/tools.ts`

**Secrets never touch the conversation.** `request_secret` returns a single-use browser form. The value is injected into the sandbox as an environment variable, scoped to workbench or live, and a scrubber redacts every known value from every tool result — including a `console.log(process.env)` in the user's own tests. — `apps/mcp-server/src/secrets.ts`

**Git is the substrate.** Checkpoints are commits with `Power-*` trailers at gate boundaries. Restore is `reset --hard`. Publish is a tag plus a clean clone. Rollback re-tags the previous release. Export is a `git bundle` with full history, and the template ships `.env.example` and `docker-compose.yml` so the export has somewhere to run. — `apps/mcp-server/src/sandbox.ts`

**Tenant isolation is a database policy, not application discipline.** Every control-plane table has forced row-level security keyed to a session setting. Child tables are scoped by project *ownership*, which the test suite proves by attempting a cross-tenant write. — `apps/mcp-server/src/pgstore.ts`

---

## The tool registry

52 tools. 16 are free and 36 are metered; 11 run as async jobs you poll with `get_job`; 4 can touch the live app.

Defined once in `packages/protocol/src/tools.ts`, which is also what the docs page renders, so the documentation cannot drift from what the server enforces.

| Group | Tools | Cost |
|---|---|---|
| Orientation | `get_context`, `get_next_action`, `get_project`, `list_projects`, `get_guides`, `get_job` | free |
| Reading | `list_files`, `read_file`, `read_files`, `search_code`, `diff`, `get_logs` | free |
| Status | `get_preview_url`, `get_publish_status`, `list_checkpoints` | free |
| Leaving | `export_project` | free, permanently |
| Project | `create_project`, `import_repo`, `update_project_metadata`, `start_run` | metered |
| Gates | `submit_research`, `submit_spec`, `request_spec_approval`, `submit_verification` | metered |
| Editing | `write_file`, `edit_file`, `apply_patch`, `rename_file`, `copy_file`, `delete_file` | metered |
| Dependencies | `add_dependency`, `remove_dependency` | metered, async |
| Checking | `typecheck`, `run_tests`, `run_command` | metered, async |
| Preview | `run_in_browser`, `screenshot_preview`, `navigate_preview` | metered |
| Data | `provision_database`, `query_database`, `pull_schema`, `propose_migration`, `promote_migration` | metered |
| Release | `publish_app`, `rollback`, `unpublish_app`, `create_checkpoint`, `restore_checkpoint` | metered |
| People and assets | `request_secret`, `request_user_upload`, `upload_asset`, `generate_image` | metered |

The four live-capable tools are `promote_migration`, `publish_app`, `rollback` and `unpublish_app`. Each is legal only in a phase that implies the checks have already run, and publishing additionally requires a browser confirmation.

---

## The phase machine

Nine states. `packages/runstate/src/index.ts` is a pure reducer, so the whole machine is testable without a server.

| Phase | What must happen to leave it |
|---|---|
| `intake` | A project exists; go to `research` or straight to `spec` |
| `research` | `submit_research` passes the research gate |
| `research_review` | The findings are accepted |
| `spec` | `submit_spec` passes the spec gate |
| `spec_approval` | **A person approves in the browser** |
| `build` | Typecheck and tests are green |
| `verify` | `submit_verification` passes the verification gate |
| `done` | Terminal. `start_run` opens a new run on the same project |
| `blocked` | Retries exhausted; a person unblocks it |

Retries are counted per feedback edge and capped at two. On the third failure the run moves to `blocked` rather than letting a model loop. Writing a file before `spec_approval` has been granted is refused with `wrong_phase`, and the e2e suite asserts exactly that, twice: once on the first run and once after a second run re-arms the gates.

---

## The gates

Three artifact gates plus the migration gate. Every rule has a stable dotted id, which is what the model sees and what the site quotes.

| Gate | Artifact | Checks, in brief |
|---|---|---|
| Research | `research.json` | Sources are listed and real; no unsourced claims |
| Spec | `SPEC.md` | Required sections present; requirements in EARS form; every task cites a requirement it serves; traceability both ways |
| Verification | `verification.json` | Every P0 requirement exercised, not merely looked at; evidence attached |
| Migration | the SQL itself | `up` applies; `down` reverses it exactly; no unguarded `not null`; no blocking index on a large table; destructive shapes flagged for typed confirmation |

Rule families by count: `verification` (20), `migration` (15), `research` (12), `destructive` (6), `tasks` (5), `sources` (4), `traceability` (3), `ears` (3), plus `frontmatter`, `artifact`, `section`, `json` and `stripe`.

A representative failure, as the model receives it:

```json
{
  "ok": false,
  "reason": "gate_not_satisfied",
  "gate": "spec",
  "message": "The plan has one task that cites no requirement.",
  "billed": false,
  "failures": [{
    "artifact": "SPEC.md",
    "field": "tasks[3]",
    "rule": "tasks.missing_requirement_ref",
    "detail": "Task \"Send the email\" cites no requirement. Name the R# it serves, or delete the task."
  }],
  "context": {
    "project_id": "prj_3f9a",
    "run_id": "run_7c21",
    "phase": "spec",
    "phase_label": "Writing the plan",
    "env": "workbench",
    "open_gate_failures": [],
    "loops_remaining": { "spec": 1 },
    "next_action": "submit_spec"
  }
}
```

`GateError` requires all four of `artifact`, `field`, `rule` and `detail`, and `detail` must say what *would satisfy* the rule rather than only what is wrong. A vague gate error costs a whole fix cycle.

### Why a call gets refused

Seven stable reasons. Renaming one is a breaking change, because models read them and the eval harness asserts on them.

| `reason` | Meaning |
|---|---|
| `gate_not_satisfied` | The artifact was produced but failed its deterministic gate |
| `wrong_phase` | The tool is real, but not legal in the current phase |
| `awaiting_human_approval` | A human decision is outstanding; only a person can clear it |
| `run_blocked` | A bounded retry edge is exhausted; the run stopped on purpose |
| `unsafe_for_live` | The action would touch live data or live users and has not earned it |
| `quota_exhausted` | Quota is spent. Distinct from an error: nothing is broken |
| `needs_user_input` | The call needs something only the user can supply, via the browser |

---

## Data: two branches and a gate between them

Every project gets a **live** branch and a **safe copy**. The model works against the safe copy and never holds a handle to live.

```
your users ──→  live  ←── promote_migration (verify phase, rehearsed, reversible)
                  ▲
           migration gate
                  │
your AI ────→ safe copy  ←── propose_migration, query_database (row-capped)
```

There is no `execute_sql`. `query_database` reads from the workbench only and caps rows. `propose_migration` rehearses the change on a scratch copy of live and refuses anything that will not reverse cleanly. `promote_migration` is legal only in `verify`, after the tests are green, and takes a snapshot first.

---

## Metering and plans

Metered in build actions, never in tokens, because the tokens are not ours to charge for.

| Plan | Per day | Per week | Projects | Price |
|---|---|---|---|---|
| Free | 100 | 400 | 3 | $0 |
| Pro | 1,000 | — | unlimited | $25/mo |
| Power | 5,000 | — | unlimited | $100/mo |

A reservation is taken before the handler runs and released if the outcome was a refusal or an error, so **a gate rejection is never billed**. The envelope reports what remains. Reads and `export_project` are free on every plan, permanently, which is the point: there is no trapdoor where leaving costs money.

Quota lives in memory locally and moves to Redis by setting `REDIS_URL`.

---

## Security and tenant isolation

- **Row-level security is forced** on every control-plane table, keyed to a session setting rather than to application code remembering a `WHERE` clause.
- **Child tables are scoped by project ownership**, so a tenant cannot attach a row to another tenant's project. `infra.test.ts` proves it by trying.
- **Secrets never enter the transcript.** Single-use browser form, env injection scoped to workbench or live, and a scrubber over every outgoing payload that catches even a `console.log(process.env)` inside the user's own tests.
- **Destructive data changes need a typed project name**, and a new proposal invalidates any earlier confirmation.
- **Bearer auth** switches on with `POWER_TOKENS`; without it the server runs in dev auth, which is for local use only.

---

## The product site

`apps/site` is a Next.js 15 / React 19 app, statically exported.

```sh
pnpm dev:site     # http://localhost:4000
pnpm build:site   # → apps/site/out
```

Stack: Tailwind v4 for the token system, Radix primitives behind shadcn-style components the repo owns outright (`src/components/ui`), Motion for the run console and the scroll-filled manifesto, Lenis for momentum scrolling, Lucide for icons. Notices in `apps/site/THIRD_PARTY.md`.

Two things keep it honest. The pricing page and the docs read `PLANS` and `TOOLS` straight from `@power/protocol`, and the proof page is rendered from the committed transcripts in `docs/evals`, so neither can describe behaviour the server does not have.

The page is readable without JavaScript: the served HTML is visible, and only a browser that ran the head script hides a section until it scrolls into view. Reduced motion skips the animation entirely, in CSS.

**Publishing.** Push to `main` and `.github/workflows/deploy-site.yml` deploys to GitHub Pages. Enable Pages once (Settings → Pages → Source: GitHub Actions) and set the repository variable `SITE_URL` to your domain so canonical and OG URLs are right. Or connect the repo to Vercel with root directory `apps/site`; `vercel.json` is there.

> `apps/web` is the previous hand-generated static site. Nothing builds or deploys from it any more. It is kept only for reference and can be deleted.

---

## Verification

| What | Command | Result |
|---|---|---|
| Unit tests | `pnpm check` | 88 tests across 6 files, plus typecheck |
| End to end | `pnpm dev` then `pnpm e2e` | 74 steps through a real MCP client |
| A real model | `scripts/eval-claude.sh` | a live Claude session, transcripts committed |

**Unit** (88): gates, run state, guard, migration gate, jobs, metering, secrets, the DB driver against real Postgres via PGlite, and RLS.

**End to end** (74): every phase gate, both human approvals, the migration gate and its typed confirmation, a leaked secret caught by the scrubber, billing on the envelope, a second run started on the shipped project with the gates re-armed, and a `git log` showing gate trailers at the end. It drives a real MCP client over HTTP, so **the server must already be running** — `pnpm e2e` on its own fails with `ECONNREFUSED` on port 4321. It is repeatable: the metering step measures what that run spent rather than asserting an absolute quota, so consecutive runs against one server all pass.

**A real model.** `scripts/eval-claude.sh` runs a Claude Code session through three phases with human approvals between them and summarises what the model did after each `ok: false`. First run, Sonnet 4.5, 2026-09-21: **12 tool calls, 1 refusal, 0 protocol errors.** The spec gate rejected the first plan for tasks without requirement references; the model fixed exactly that and passed. It never attempted an out-of-phase call, stopped at both human gates, and shipped v1 with 15 passing tests. Report and raw transcripts in `docs/evals/`.

---

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `4321` | HTTP port for the MCP endpoint and the companion |
| `POWER_BASE_URL` | `http://localhost:$PORT` | Origin used to build approval and secret URLs |
| `POWER_LOCAL_ROOT` | a local data directory | Where sandboxes and the control plane live |
| `POWER_TOKENS` | unset | `tok:alice:pro,tok:bob:free` switches on bearer auth |
| `REDIS_URL` | unset | Moves quota accounting from memory to Redis |
| `STRIPE_SECRET_KEY` | unset | Billing integration |
| `SITE_URL` | `https://power.build` | Canonical origin for the built site |

---

## Local today, hosted later

Everything below is behind an interface, so the hosted version is a swap rather than a rewrite.

| Today (local, tested) | Hosted (same interface) |
|---|---|
| `LocalSandbox` — a directory and a git repo per project | Fly Machines: one app per project, `workbench` and `prod` machines, in-VM agent daemon |
| `PgliteDriver` — branches are directory copies | Neon: one project per project, copy-on-write branches |
| `openPgliteControlPlane` | Managed Postgres, same schema and same RLS |
| `MemorySecrets` | Envelope-encrypted store with a per-project egress allowlist |
| `MemoryQuota` / `FileLedger` | Redis (`RedisQuota` already exists) / Postgres ledger |
| `DevAuthenticator` / `TokenAuthenticator` | OAuth 2.1 with dynamic client registration via a vendor IdP |
| `Jobs` (in-process) | A queue and a jobs table |

## Not started

Preview URLs (the local sandbox runs no dev server), click-to-select and annotation, a GitHub mirror, custom domains, and integration playbooks.

The knowledge packs in the original prototype were Python and FastAPI shaped and were deliberately not ported; they would mislead a TypeScript build. The export-runs-anywhere CI job exists in `.github/workflows/ci.yml` but has not yet run on a hosted runner.
