# Power — architecture and roadmap to a published connector

> The approved roadmap. Phases are ordered by dependency, not by interest.

## Context

Power is an MCP server that plans, builds, checks and ships applications. The
user's own AI client drives the loop, so Power pays for no inference; it supplies
the workbench, the infrastructure, and gates enforced by code rather than asked
for in a prompt.

Much of it is genuinely good. 223 tests, a 74-step end-to-end run, OAuth 2.1 with
rotating refresh tokens, a control plane with three mutually exclusive RLS
scopes, AES-256-GCM per-account secrets, rehearsed migrations, a git-backed
history, and an export that is a real repository.

Three parallel audits of the working tree found something that outranks all of
it. **The application Power generates is structurally disconnected from the
platform that generates it.** Nothing sets `DATABASE_URL` for a project. The
workbench database is PGlite on disk, which has no listener and therefore cannot
produce a connection string. `DbDriver` has no method that could return one.
`publish_app` passes no environment to the deployer at all. So a preview serves
its page and every `/api/*` call fails, `provision_database` creates two real
branches the app never reads, and `promote_migration` writes to a database
nothing consumes.

This is one defect with four faces, and until it is closed, "the complete app
working" is not reachable by any amount of other work.

A fourth audit, of `~/Downloads`, found that **the knowledge layer Power needs
already exists and is already running.** `~/Downloads/prompts 2` is the
`prompt-repo` MCP server connected to this very session. It holds 69 builder
prompts organised into families with variant counts (`full_stack_app_builder_cloud_v8`
alone has 40 model variants), 70 integration playbooks of 300–7,000 tokens each,
a 12-category request router pointing at 8 specialist agents, and 19 shared
variables expanded at render time. Its retrieval protocol is three calls:
`find_template` returns ranked metadata and a `why` and *never content*, then
`get_prompt` / `get_playbook` renders one, then `get_variables` inspects the
substitutions. That is principle 5 already built, tested and serving.

Power does not need to write this. Power needs to call it.

Two details make adoption clean. `{{company_name}}` is already a variable, set
to `the platform` — the content is brand-neutral by construction, so shipping it
as Power is a one-variable change and carries no other product's name. And
`list_catalog(kind='orphans')` returns content no index references: a self-audit
Power's own tool registry does not have.

`~/Downloads/emergent-templates` is 36 KB and contributes two patterns rather
than code. Its `server.py` documents the preview contract Power is missing —
*"the preview ingress routes `/api/*` to the backend on port 8001 and everything
else to the frontend on port 3000"* — and `.emergent/emergent.yml` declares the
runtime image a template needs. Power's template declares nothing about how it
should be run.

Research into Floot settled the competitive picture. Their 43 tools over
Streamable HTTP with OAuth and PKCE, with the client's model driving, is parity
rather than differentiation. They are ahead on infrastructure: a long-lived
runtime per project where the agent runs code, drives a browser and reads an hour
of logs. Power is ahead on discipline: they ship `execute_sql` at the live
database with no rehearsal, their Restore covers code and config but not data or
deployments, their export is a browser-built zip the agent cannot reach, and
their own docs say their sign-in does not work self-hosted.

## What done means

1. **A connector published in Claude's directory.**
2. **An MCP usable from the Claude CLI.**
3. **The complete app working.**

(1) and (2) are one piece of work. Connectors added at claude.ai load
automatically in the Claude CLI on the same account, and the CLI works directly
the moment the server is on public HTTPS:

```sh
claude mcp add --transport http power https://mcp.<domain>/mcp
claude mcp list                     # ! Needs authentication
# in a session: /mcp → power → Authenticate
```

(3) is Phase 1 below, and it is the hardest of the three.

---

## Architectural principles

Six decisions everything follows from, written down because every expensive
mistake in this repository has been a violation of one.

**1. Power operates exactly one runtime, and it is preview.** Building needs
somewhere to run; shipping does not. Published apps go to the user's own hosting
account. Bundling is precisely what makes Floot's export lossy.

**2. The gate is the product.** Deterministic checks, refusals as `ok:false`
inside a successful result, counted and capped retries. No feature may weaken a
gate to look faster.

**3. Three seams stay swappable, each with a local implementation.** `Sandbox`,
`Runtime`, `Deployer`. Chosen explicitly, never by falling back. A silent
fallback is how `publish_app` came to report success while producing a 404.

**4. State lives in Postgres, never in a process.** Learned four times: secrets
in a `Map`, quota in memory, the scheduled-job cap as a `Set`, and the jobs
registry that makes `get_job` fail on a second node.

**5. Knowledge is retrieved, not embedded.** The client's model pays for every
token Power returns, so a bigger system prompt spends the user's money on every
call. Fetch on demand instead.

**6. A capability ships with the procedure that proves it works.** Anything Power
wires in also emits the test for that wiring, so a gate can check it.

---

## Where we actually are

| Area | State |
|---|---|
| Gates, phases, refusals, retries | Done, tested hardest |
| OAuth 2.1, DCR, PKCE, rotation | Code complete; **the full flow has no test and no script** |
| Control plane, three RLS scopes | Done on PGlite; **`openPgControlPlane` has no production call site** |
| Secrets, encrypted, per account | Done, but only ever on PGlite |
| Workbench, git, checkpoints | Done |
| `export_project` | Returns a **server-side path**; no download route, so unusable remotely |
| Template, a real web app | Runs standalone; **cannot reach a database inside Power** |
| Preview runtime | Serves the page; **every API call 500s** |
| `publish_app` | Local → **404**. Vercel → **never executed** |
| Jobs, S3 storage | Written, **orphaned and defective** |
| Legal pages | Written, **unreachable** |
| Knowledge, playbooks, router | **~5 KB and no retrieval** — but a working 70-playbook repository exists to vendor |
| Starting points | **One template**, no router, no lifecycle beyond 0→1 |
| CI | **e2e and export jobs are red** |
| Ops: container, deploy, logs, metrics | **Absent entirely** |

Branch is 14 commits ahead of `origin/main`, unpushed.

---

## Phase 0 — Make the tree honest

No new capability until what exists tells the truth.

**The failing test is a real defect.** `jobs.test.ts` → *enforces the cap on
scheduled jobs*. The cap is a `Set` in process memory (`jobs.ts:248`), so two
`createJobs(db)` calls each get a fresh budget while writing the same table. The
module header names the threat exactly: a scheduled job is the one primitive that
can bill its owner forever. Count in the database instead. Principle 4.

**Three more in the same file.** The unknown-handler path returns a job to
`pending` without moving `run_at` (`jobs.ts:422-434`), so an old instance spins
at full poll rate through a rolling deploy. `SKIP LOCKED` is untested because
PGlite serialises. `tick()` overwrites `this.running`, so `stop()` can await the
wrong pass.

**Wire in the orphans.** `packages/sdk/src/index.ts` re-exports only `auth.js`,
and `defaultStorage` still throws *"S3 storage driver is not included in this
build"* beside a working driver. 55 passing tests cover code nothing can reach.
Keep the S3 driver as written: its signing is pinned to three published AWS
vectors, so a regression cannot pass silently. Close two gaps: no
`x-amz-security-token`, which rules out the role credentials a hosted deployment
uses, and it has never met a real `fetch`.

**Stop the tools overpromising.** Each of these says more than it does:
`get_logs` claims live logs; `diff` claims comparison against live;
`pull_schema` claims to regenerate typed helpers and writes nothing;
`provision_database` claims Power injects `DATABASE_URL`. `get_preview_url` is
declared free and `read_only` while spawning a process that can block 60 seconds.
Either implement or reword, and move `get_preview_url` to metered and async.

**Fix CI, which is red.** The e2e and export jobs broke when the working
environment moved into `package.json` scripts and an untracked `.env`. CI starts
the server with neither `POWER_DEV_AUTH` nor `POWER_DEPLOYER`, so the client gets
a 401 and publish asks for a hosting token. `scripts/eval-claude.sh` is broken the
same way. **There is currently no automated evidence the pipeline works.**

**Delete what is dead.** `MemoryStore` (zero references), `Sandbox.publish` /
`rollback` / `unpublish` (superseded by `Deployer`), `PgSecrets.allValuesForUser`,
`newCsrfNonce`, `metadataDigest`, and `apps/web` — a second stale marketing site
still in the workspace, still built by `pnpm build:web`, duplicating the live
site's claims.

**Make the legal pages exist.** Well written and factually grounded, with no
invented entity or jurisdiction, but nothing links to them and `apps/site` is in
neither `tsconfig` references nor the vitest glob. A policy nobody can reach is
not published.

**Then push.** Fourteen commits exist on one laptop.

**Done when** `pnpm check` is green, every passing test is reachable from product
code, CI is green including e2e, and `origin/main` matches.

---

## Phase 1 — Connect the app to the platform

**The phase that makes "the complete app working" true.** Everything in Phase 0
is hygiene; this is the product.

**1. `DbDriver` must be able to hand out a connection string.** Add
`connectionString(projectId, branch)` to the interface. Verified: the only
`connectionString` in the server is `pgstore.ts:439`, the control plane's own.
PGlite cannot satisfy the new method, which is the real finding — the local
driver has to become something that listens, or local development uses the
`docker-compose.yml` Postgres the template already ships. The latter is simpler
and uses what is there.

The mechanism behind the 500s, exactly: `template.ts:132` falls back to
`postgres://power:power@localhost:5432/app`, the compose Postgres that nothing
starts inside Power's workbench. Meanwhile `handlers.ts:726` tells the model
*"Power injects the right one per environment."* That sentence is the single
most load-bearing false statement in the codebase, because the model believes it
and stops looking.

**2. Inject it.** `LocalRuntime.start` already takes an env map and receives only
workbench secrets. It must also receive `DATABASE_URL` for the workbench branch
and `POWER_ENV=workbench`. Without this the preview is a page with a dead API.

**2b. Adopt the ingress contract.** Borrowed from `emergent-templates`: one
origin, `/api/*` to the app's server, everything else to its static or dev
frontend. Power's proxy already serves `/preview/<id>/`, so this is a routing
rule rather than new machinery, and it buys the property that matters — **the
generated app never needs to know its own public URL.** All its calls are
same-origin relative paths, which is why the template's relative paths were the
right instinct, and it means the identical build works in the preview, on
localhost and on the user's own hosting with nothing rewritten. Write the
contract into the template as a comment, the way that starter does, because the
next model to edit the app has to know it.

**3. `publish_app` must pass `env`.** `DeployRequest.env` exists and is never
populated, so a published app has none of its live secrets and no database.

**4. Fix the local publish 404.** `LocalDeployer` writes the release flat while
the template's page lives at `public/index.html`. Serve the release the way the
template is laid out.

**5. Make `export_project` reachable.** It returns a server-side filesystem path
and `git clone <path>`, which is meaningless to a remote user. The anti-lock-in
promise is the single loudest claim Power makes; it needs a download route.

**Done when** someone creates a project, opens the preview, signs up inside the
generated app, adds an item, publishes, and the published app still works.

---

## Phase 2 — Close the correctness and safety defects

Found by audit, marked by nothing, and each one is small.

1. **A late async job result is never scrubbed.** `wrap()` scrubs only when
   `args.project_id` is present; `get_job` takes only `job_id`. A `run_tests`
   that exceeds the 20-second wait returns its full stdout **unredacted**. The
   e2e proves the scrubber works, on the fast path only.
2. **A late async job is never billed.** An unsettled job returns `refused`, so
   the reservation is released, and `get_job` does no metering. Every slow
   metered tool is free and the ledger records it as a refusal.
3. **`Jobs` is global and unscoped.** One instance for all principals, `get(id)`
   with no owner check. A leaked job id returns another tenant's tool result.
4. **`unpublish_app` requires no human confirmation**, and neither does a
   non-destructive `promote_migration`. Verified at `server.ts:206-207`: the
   ternary hands both tools a literal `true` before `guard()` ever sees them, so
   the tool that takes a user's live app offline needs nobody's consent. The
   comment above it says the handler decides — for `unpublish_app` no handler
   does. This contradicts Power's loudest positioning claim, that two decisions
   stay yours.
5. **`rollback` is unreachable and records state wrongly.** It upserts the old
   deployment row, so `get_publish_status` still reports the version you rolled
   away from, and the confirm form only renders in `verify`, which a successful
   publish has already left.
6. **The ledger is a local JSONL file.** A redeploy loses the billing record and
   nothing can query it. Principle 4.

---

## Phase 3 — Make it reachable

Until this lands nobody can add Power to Claude, including its author.

1. **Containerise.** No Dockerfile exists. Multi-stage, non-root,
   `pnpm deploy --filter @power/mcp-server`.
2. **A host that keeps a process alive.** Power spawns preview children; it is
   not a set of functions. The only deploy config in the repo targets the
   marketing site.
3. **Managed Postgres**, and the first ever execution of `openPgControlPlane`.
   `index.ts` opens PGlite unconditionally and never reads `DATABASE_URL`. Run
   the isolation suite against it; those policies are the whole security model
   and have only run on PGlite. This is also where `SKIP LOCKED` gets a real
   test, and where `bytea` round-tripping for sealed secrets is first exercised.
4. **Domain, DNS, TLS**, with `resource` in the metadata equal to the typed URL
   byte for byte.
5. **A real `POWER_SECRET_KEY`**; `POWER_DEV_AUTH` and `POWER_DEV_LOGIN` gone.
6. **Email**, so sign-in links reach people rather than stdout.
7. **First real `VercelDeployer` run.** Nothing proves `/v13/deployments` accepts
   this release shape, that a TS serverless function builds with no build
   command, or that `alias[]` is populated when `waitForReady` returns.
8. **Operational minimum**: structured logging carrying the existing `trace_id`,
   `/health` checking the control plane rather than answering 200 unconditionally,
   graceful shutdown that drains, and error reporting.
9. **Migration safety**: an advisory lock, because two nodes booting concurrently
   race on `drop policy` / `create policy` today.

**Done when** a second person on another machine runs `claude mcp add`,
authenticates in a browser, and calls a tool.

---

## Phase 4 — Earn the listing

1. Legal pages live and linked.
2. A reviewer test account with a finished project in it.
3. **Reviewer notes explaining the phase machine.** A reviewer who calls
   `write_file` before a plan exists gets a refusal, which is the product working
   as designed and reads as a broken tool without explanation.
4. Audit every tool against *"returns a successful response when called with
   valid parameters"* — Phase 0's overpromises are exactly what fails this.
5. **Re-run `scripts/eval-claude.sh`.** The only real-model evidence is dated
   2026-09-21 and predates OAuth, the deployers, the template and the runtime.
   The `/proof` page currently describes a server that no longer exists.
6. Listing copy, icon, categories, permanent slug. Submit.

---

## Phase 5 — The knowledge layer

Power ships about 5 KB of guidance. The gap was never prose volume; it is that
Power has nowhere to *put* knowledge and no way to retrieve it. The fourth audit
changed this phase from "build a knowledge layer" to "wire in the one that is
already running," which moves it from the most speculative phase to one of the
cheapest.

### 5a. Mount the prompt repository

`prompts 2` is a working retrieval server with the right shape: a catalog layer
that returns metadata and never content, a render layer that expands variables,
and 70 playbooks small enough to send one at a time. Power adds three tools that
wrap it — `find_guidance`, `get_playbook`, `get_design_guideline` — and the
gate consults it rather than the model guessing.

Two integration choices, and the second is better. Power could call the server
over MCP, which couples Power's uptime to a separate process. Or Power vendors
the catalog as data into its own repository — the YAML manifests plus the
markdown bodies — and serves it from the control plane. That keeps principle 3's
one-process shape, keeps the content versioned with the code that depends on it,
and keeps the deployment story unchanged. **Vendor it.** Set `company_name` to
Power and the content carries no other product's name.

Run `list_catalog(kind='orphans')` before vendoring: it reports content no index
references, so it names exactly what not to carry over.

### 5b. The router

A 12-category taxonomy with keywords and example phrases, routing to 8
specialists — full-stack, Next.js, landing page, mobile, portfolio, replica,
general, design. Power has one template and no router, which is why it answers a
"build me a landing page" and a "clone this site" with the same instructions.
This is pure data: a table, a matcher, and a declared default. Power already has
the hook for it, because `create_project` is where the choice belongs.

**Important discipline:** a router that picks wrong is worse than no router. It
needs a declared default (the taxonomy has one) and the choice must be visible
and overridable in the plan the human approves, not silent.

### 5c. The lifecycle axis Power is missing entirely

The prompt families are organised on an axis Power has no concept of:

| Family prefix | Situation |
|---|---|
| base / `_v0` | building from scratch, 0→1 |
| `fork_*` | continuing on a codebase that already exists |
| `infinite_*` | continuing **after the context ran out**, from a clean slate |
| `post_deployment_agent_*` | the app is live and being changed |
| `resume_*` | picking a run back up |

Power's run state machine covers 0→1 and nothing else. The `infinite_*` case is
the interesting one: it exists because a long build exhausts the context, which
is a problem Power is unusually well placed to solve, because **its run state is
already in Postgres rather than in the conversation.** A `resume_run` tool that
reconstructs what phase a project is in, what the gates said and what remains is
a small amount of code over state that already exists — and it is a capability
Floot's checkpoint panel does not offer.

### 5d. The five prompt-shape changes

Each is payload, so each is free to Power under principle 5.

1. **Verification instructions as data on every capability.** A
   `testing_instructions` field and a `common_failures` sibling. The run records
   which capabilities it used; their instructions concatenate into the verifier's
   payload. Principle 6 made mechanical. The playbook titled *"Managed Google
   Auth Login Playbook **with testing instructions**"* shows the pattern already
   proven on the hardest case, auth.
2. **Capabilities write a procedure file into the workspace** and leave a comment
   for whoever edits that code next — one-shot context becoming a durable
   artifact.
3. **Three fields on `verification.json`**: `retest_needed`,
   `should_main_agent_self_test`, and context for the next verifier. They route
   retries and stop a stateless verifier repeating itself.
4. **Severity-tiered rules in the role briefs** — what breaks everything, what
   causes bugs, what is quality — plus a short self-interrogation list placed
   after the task so it lands last in context.
5. **Slots in the template for state between phases**: a memory directory, a test
   report directory, an in-repo conventions file, and — from
   `emergent-templates` — a manifest in which the template declares the runtime
   it needs. The template runs; it has nowhere to keep anything and says nothing
   about how to run it.

### 5e. Playbook metadata, as the catalog already models it

Carry the shape rather than inventing one: a stable id, a title, a token
estimate, an `integration_type` distinguishing a feature integration from a
non-functional requirement like scalability, and an `indexed` flag so content can
exist before it is routed to. Model allowlists stay in sibling YAML, so the list
of models a playbook works with is refreshed without touching its prose — which
matters, because that list goes stale faster than anything else in the file.

*Provenance: `prompts 2/prompt_mcp` is this repository author's own prior work,
not another company's, judging by its hardcoded paths. It is a prototype to
harvest, and must not be cited as evidence about anyone else's system.*

---

## Phase 6 — Give the agent eyes

`screenshot_preview`, `navigate_preview`, `run_in_browser`. Only possible now a
runtime exists, and only useful once Phase 1 makes the running app functional.
Headless Chrome is already a dependency here. This makes the verification gate
much stronger: a verifier that can look at the page checks claims a verifier
reading source cannot.

## Phase 7 — Pricing and billing

Floot's plans are Free 100/day, Pro $25 for 1,000, Power $100 for 5,000.
`plans.ts` is byte-identical, tier names included, and their top tier is called
Power. **Decided: keep the product name, change the numbers and the tier labels.**
`plans.ts` is the single source, so the change is cheap; the one awkward part is
that `power` is both a label and a member of the `Plan` type. Then billing, since
the meter counts into a void.

## Phase 8 — Long tail

Mobile via a managed build service rather than anything self-hosted — the
catalog's Expo families and its mobile auth and push playbooks mean the guidance
arrives with the router in 5b, so what remains is genuinely the build
infrastructure and not the knowledge. A hosted
sandbox replacing `LocalRuntime` behind the same interface when load justifies
it. Custom domains. Teams.

---

## What makes this better than Floot

| | Floot | Power |
|---|---|---|
| Database writes | `execute_sql` at live, no rehearsal | Rehearsed on a copy, must reverse, gated |
| History | Checkpoint panel, no git surface | Git: restore, diff, tags |
| Restore covers | Code and config only | Code, config, snapshot before promotion |
| Export | Browser zip, agent cannot reach it | A git bundle, as a tool *(after Phase 1)* |
| Self-host | Their docs say sign-in does not work | Runs anywhere Postgres does |
| Hosting | Theirs; leaving costs you the app | The user's own account |
| Framework | Proprietary, AI-constrained | Plain web app, no framework |
| Refusals | Undocumented | Rule id, remedy, next action, never billed |
| Resuming after context runs out | Not addressed | `resume_run` over state already in Postgres *(5c)* |
| Integration guidance | In the model's weights | 70 retrievable playbooks, each with its own tests *(5a)* |

Worth copying, and narrow: verb-level tool granularity, free housekeeping calls,
retrieval-gated knowledge, hard caps on scheduled work.

---

## Verification

One test decides each phase.

| Phase | The test |
|---|---|
| 0 | `pnpm check` and CI green, every passing test reachable from product code |
| 1 | Create a project, open the preview, sign up **inside the generated app**, add an item, publish, and it still works |
| 2 | A slow `run_tests` carrying a secret returns it redacted, and is billed |
| 3 | A second person, another machine, `claude mcp add`, authenticates, calls a tool |
| 4 | The listing is live and a stranger installs it |
| 5 | Build an app needing Stripe: the playbook is retrieved, its tests are run, and `resume_run` survives a killed client mid-build |
| 6 | The verifier catches a visual defect reading source would miss |
| 7 | A real payment settles and the meter agrees |

Standing checks that must not regress: 223 unit tests, 74 e2e steps, the OAuth
flow end to end including refresh reuse killing the family, and a tenant
transaction reading zero OAuth and zero secret rows.

---

## Risks

- **There is currently no automated evidence the pipeline works**, because CI's
  e2e job is red and the only model eval is two weeks and fourteen commits stale.
  Phase 0 restores the evidence; until then every claim here is provisional.
- The interesting work is Phases 5 and 6. The valuable work is Phases 1 and 3.
  The main risk to this plan is doing them in the wrong order.
- Dead code with passing tests makes `pnpm check` report more health than exists.
- The listing slug is permanent once published.

## Open decisions

1. **Governing law**, which the terms omit while capping liability.
2. **Which host**, which determines the container work in Phase 3.
3. **New pricing numbers and tier labels.**
4. **Local database strategy for Phase 1**: make the local driver listen, or use
   the Postgres the template's `docker-compose.yml` already starts. The second is
   less work and less novel machinery.
5. **How much of the playbook catalog to carry on the first pass.** All 70 is
   tempting and probably wrong; the honest first cut is the ones Power can
   actually provision against — auth, Stripe, Resend, object storage, an LLM
   chat — because a playbook for a service Power cannot reach is another
   overpromise of the kind Phase 0 exists to remove.

Decided during planning, recorded so it is not reopened: **vendor the catalog
as data rather than calling the prompt-repo server over MCP** (5a), and keep the
`prompt-repo` running locally as the authoring and audit tool.
