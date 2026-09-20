import { PLANS, TOOLS } from '@power/protocol';
import { SITE } from './site';

export interface Doc {
  slug: string;
  title: string;
  description: string;
  section: string;
  html: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const phases = (t: (typeof TOOLS)[number]) => (t.phases === '*' ? 'any' : t.phases.join(', '));

const toolTable = `<table>
<thead><tr><th>Tool</th><th>Cost</th><th>Legal in</th><th>What it does</th></tr></thead>
<tbody>${TOOLS.map(
  (t) =>
    `<tr><td><code>${t.name}</code>${t.live_capable ? ' <em>live</em>' : ''}${t.async ? ' <em>async</em>' : ''}</td><td>${t.metered ? '1 action' : 'free'}</td><td><code>${phases(t)}</code></td><td>${esc(t.summary)}</td></tr>`,
).join('')}</tbody></table>`;

export const DOCS: Doc[] = [
  {
    slug: 'index',
    section: 'Start here',
    title: 'Overview',
    description: 'What Power is, what it is not, and where to go next.',
    html: `
<p class="lead">Power is a remote MCP server. You connect it to the AI you already use — Claude, ChatGPT, Cursor, Claude Code, anything that speaks MCP — and that AI gains ${TOOLS.length} tools for building, checking and shipping a full-stack app. Power runs the workbench, the database, the secrets and the hosting. Your AI does the thinking.</p>
<p>What makes it different is that the pipeline is <strong>enforced by the server</strong>. Your AI cannot write code before you have approved a plan, cannot hand off a build that does not pass its own tests, cannot publish before verification, and cannot touch your live database at all. When it tries, it is told — in the tool result — what to do instead.</p>
<div class="grid2" style="margin:1.5rem 0">
  <a class="card" href="/docs/getting-started/"><h3>Getting started →</h3><p>Connect in two minutes and build your first project.</p></a>
  <a class="card" href="/docs/how-it-works/"><h3>How it works →</h3><p>The phases, the gates, the two human decisions.</p></a>
  <a class="card" href="/docs/tools/"><h3>Tool reference →</h3><p>Every tool, what it costs, when it is legal. Generated from the server.</p></a>
  <a class="card" href="/docs/export/"><h3>Export &amp; self-hosting →</h3><p>Take everything with you. It runs unchanged.</p></a>
</div>
<h2>What Power is not</h2>
<ul>
<li><strong>Not a chat app.</strong> There is no Power chat box. You talk to your own AI; Power is the hands.</li>
<li><strong>Not an IDE.</strong> The web companion exists for four decisions only a person may make, and a read-only view of everything else.</li>
<li><strong>Not a walled garden.</strong> Real git underneath; free export with history; an SDK with a self-host adapter for every managed service.</li>
</ul>`,
  },
  {
    slug: 'getting-started',
    section: 'Start here',
    title: 'Getting started',
    description: 'Connect Power to Claude, ChatGPT, Cursor or Claude Code and build a first project.',
    html: `
<h2>1. Connect</h2>
<p>Power is a Streamable HTTP MCP server at <code>${SITE.mcp}</code>. Sign in with OAuth when your client asks; credentials stay with Power and never reach the AI.</p>
<h3>Claude (web or desktop)</h3><p>Settings → Connectors → Add custom connector → paste the URL above → Connect. Then mention Power in any chat.</p>
<h3>Claude Code</h3>
<pre><code>claude mcp add --transport http power ${SITE.mcp}</code></pre>
<h3>ChatGPT</h3><p>Settings → Connectors → Create → paste the URL. Enable it from the <kbd>+</kbd> menu in a conversation.</p>
<h3>Cursor, VS Code, Zed, Codex CLI</h3><p>Add a remote MCP server of type <code>http</code> with the URL above and complete the sign-in.</p>
<h2>2. Build something</h2>
<p>Say what you want, in your own words:</p>
<div class="callout"><em>“With Power, build me a tip splitter: enter the bill, the tip percentage and the number of people, get what each person owes.”</em></div>
<p>Your AI will create a project, write a plan, and submit it. Power checks the plan and — if it passes — gives your AI a link for you. <strong>Open it and approve the plan.</strong> Nothing gets built until you do.</p>
<p>Your AI then builds and tests until green, verifies against the plan, and asks you to confirm the publish. <strong>Open the link and confirm.</strong> Your app is live at <code>name.power.app</code>.</p>
<h2>3. Keep going</h2>
<p>Ask for the next thing. <em>“Add a way to split unevenly.”</em> A new run starts against the same project — same code, data and secrets — and goes through the same plan → approve → build → verify → publish, with a fresh retry budget.</p>
<h2>Tips that make it go smoothly</h2>
<ul>
<li><strong>One change per run.</strong> The plan stays short and the verification stays sharp.</li>
<li><strong>Read the plan before approving.</strong> Approval is your decision about <em>what</em>; the structure has already been checked by code.</li>
<li><strong>If your AI seems lost</strong>, tell it to call <code>get_next_action</code>. It is free and always right.</li>
<li><strong>Never paste a secret in chat.</strong> Your AI knows to ask for a browser link instead; if it forgets, tell it to use <code>request_secret</code>.</li>
</ul>
<h2>Run it yourself</h2>
<p>Power is source-available. <code>pnpm install && pnpm dev</code> starts a full local instance — gates, database branching, metering, the lot — with no cloud accounts. See the <a href="${SITE.github}">repository</a>.</p>`,
  },
  {
    slug: 'how-it-works',
    section: 'Concepts',
    title: 'How it works',
    description: 'Phases, gates, bounded retries, and why refusals are not errors.',
    html: `
<p class="lead">Every project runs through a short pipeline. The phases are a state machine on the server, reloaded from storage on every call. Each arrow is a gate: deterministic code that either passes the work or names exactly what is wrong.</p>
<pre><code>plan ──spec gate──▸ approve (you) ──▸ build ──tests green──▸ verify ──verification gate──▸ publish (you)
                                        └── propose_migration ──migration gate──▸ promote_migration ──┘</code></pre>
<h2>Gates</h2>
<p>A gate is a pure function over an artifact. The <strong>spec gate</strong> checks a plan has requirements, one acceptance criterion per requirement in the form <em>WHEN … THE SYSTEM SHALL …</em>, and tasks that trace to them. The <strong>build gate</strong> is the project’s own typecheck and tests, run by Power. The <strong>verification gate</strong> checks a fresh-eyes report: a pass is only accepted when every P0 requirement was exercised — not screenshotted — and the visual bar is met. The <strong>migration gate</strong> rehearses a schema change on a copy of your live data before it can be promoted.</p>
<p>Every failure names the artifact, the field, a stable rule id and what would satisfy it. That is the difference between a retry that converges and one that guesses again.</p>
<h2>Refusals are not errors</h2>
<p>When your AI calls a tool it should not — writing before approval, publishing before verification — Power does not return an error. It returns a <em>successful</em> response whose payload says <code>ok: false</code>, with the failures and a concrete <code>next_action</code>. Models treat errors as “the tool is broken” and stop; they treat this as feedback and comply. Refusals are never billed.</p>
<h2>Every response re-grounds the model</h2>
<p>Each tool result carries a small <code>context</code> block: the phase, any open gate failures, retries left, and the next action. Nothing depends on your AI remembering anything. That is why you can start in Claude, continue in Cursor, and come back a week later.</p>
<h2>Bounded retries</h2>
<p>Each feedback edge — plan revision, fixes after verification — is counted and capped at two. A run that keeps failing stops and asks you, rather than burning your quota while looking busy. A blocked run can still be read, exported, rolled back, or restarted.</p>
<h2>The two human decisions</h2>
<p>Approving the plan and confirming the publish happen in your browser and nowhere else. Your AI can ask; it cannot answer. A third, rarer one: a data change that can lose data needs the project name typed, not a button pressed.</p>
<h2>Roles, played by your AI</h2>
<p>At each phase Power hands your AI a short brief — architect, implementer, verifier — as part of the tool result, at the moment it is needed. There is no hidden Power model doing the work, which is why the thinking costs nothing extra.</p>`,
  },
  {
    slug: 'tools',
    section: 'Reference',
    title: 'Tool reference',
    description: 'Every Power MCP tool: cost, legal phases, live capability. Generated from the server’s registry.',
    html: `
<p class="lead">${TOOLS.length} tools. This table is generated from the same registry the server enforces, so it cannot drift from reality. <span class="pill free">free</span> tools are never metered. <span class="pill live">live</span> tools are the only ones that can affect your live app, and each needs a human confirmation. <span class="pill">async</span> tools may return a job id to poll with <code>get_job</code>.</p>
${toolTable}
<h2>Notably absent</h2>
<p>There is no <code>execute_sql</code>. Arbitrary SQL against the database serving your users is the most complained-about behaviour in this category, so the capability does not exist. Schema changes go through <code>propose_migration</code> and the migration gate; reads go through <code>query_database</code>, which is read-only, row-capped, and points at the safe copy.</p>`,
  },
  {
    slug: 'data',
    section: 'Concepts',
    title: 'Data & migrations',
    description: 'Two database branches, the migration gate, and typed confirmation for destructive changes.',
    html: `
<p class="lead">Every project database has two branches you can see. Your AI works against one; only a gate can touch the other.</p>
<div class="tablewrap"><table><thead><tr><th>Branch</th><th>You see it as</th><th>Who writes to it</th></tr></thead>
<tbody><tr><td><code>live</code></td><td><strong>Your live app</strong></td><td>Only <code>promote_migration</code>, after the gate</td></tr>
<tr><td><code>workbench</code></td><td><strong>Safe copy</strong></td><td>Your AI, freely</td></tr></tbody></table></div>
<h2>How a schema change reaches live</h2>
<ol>
<li>Your AI calls <code>propose_migration</code> with <code>up_sql</code>, <code>down_sql</code> and a one-sentence <code>intent</code> you will read.</li>
<li>Static checks first: no down migration, a <code>NOT NULL</code> column without a default, destructive statements. These are refused or flagged before any database is touched.</li>
<li>Power makes a scratch copy of <em>live</em> and rehearses: does <code>up</code> apply? does <code>down</code> reverse it exactly? did anything actually change? would a plain index build lock a large table?</li>
<li>If it passes, the change is applied to the safe copy so your AI can build against it.</li>
<li>During verification, <code>promote_migration</code> snapshots live and applies the change in a transaction. The snapshot is your rollback.</li>
</ol>
<div class="callout warn"><strong>Destructive changes need you to type the project name.</strong> Dropping a table or column, truncating, narrowing a type: the gate flags these, the browser explains them in plain English, and nothing your AI says in chat can clear the flag.</div>
<h2>Reading data</h2>
<p><code>query_database</code> runs read-only against the safe copy and returns at most 100 rows. Your app itself reads and writes its database normally through <code>DATABASE_URL</code>, which Power injects per environment.</p>
<h2>Restoring data with code</h2>
<p>Checkpoints record which database snapshot they correspond to, so restoring a checkpoint can restore the code alone, or the code <em>and the data as it was</em>. A single live database cannot offer that.</p>`,
  },
  {
    slug: 'secrets',
    section: 'Concepts',
    title: 'Secrets',
    description: 'How API keys reach your app without ever entering the conversation.',
    html: `
<p class="lead">Your AI never sees a secret. It sees a name.</p>
<ol>
<li>Your AI calls <code>request_secret</code> with a variable name (say <code>STRIPE_SECRET_KEY</code>), which environment it is for, and why.</li>
<li>Power returns a single-use browser link. Your AI gives it to you.</li>
<li>You paste the value into a form served by Power. The link stops working.</li>
<li>The value is injected into your app’s process as an environment variable, scoped to <em>workbench</em>, <em>live</em>, or both. Test keys in the workbench, live keys in production.</li>
</ol>
<h2>The scrubber</h2>
<p>Every tool result and every log line passes through a scrubber that replaces every known secret value with a fingerprint before it leaves the server. If your app’s tests <code>console.log(process.env)</code>, your AI sees <code>[redacted:9f8e7d6c]</code>.</p>
<h2>Never in git</h2>
<p>Secrets are never written to the repository. The exported project ships a <code>.env.example</code> with the names and comments on where to get each value.</p>`,
  },
  {
    slug: 'export',
    section: 'Reference',
    title: 'Export & self-hosting',
    description: 'Free export with full git history, and an SDK that runs the same code inside and outside Power.',
    html: `
<p class="lead">Export is free on every plan, forever. What you get is a git repository with full history, and it runs unchanged.</p>
<h2>What <code>export_project</code> gives you</h2>
<ul>
<li>A <code>git bundle</code> of the whole repository: every checkpoint, with trailers recording which gate it passed.</li>
<li><code>docker-compose.yml</code> for Postgres and a mail catcher, and a <code>.env.example</code> with working local values.</li>
<li>Your app already written against <code>@power/sdk</code>, which picks its self-host adapter automatically outside Power.</li>
</ul>
<pre><code>git clone your-project.bundle my-app && cd my-app
cp .env.example .env
docker compose up -d
pnpm install && pnpm test</code></pre>
<h2>The SDK contract</h2>
<p>Every managed capability — database, storage, email — goes through an interface with two implementations: <code>PowerAdapter</code> inside Power and <code>SelfHostAdapter</code> everywhere else. Which one runs is decided by the environment, never by your code. Our CI exports a project on every release and runs its tests with nothing from Power on the path; if that fails, we do not ship.</p>
<h2>What you will need to replace</h2>
<p>Hosting (any Node host), a Postgres, and — if you used them — an object store and an email provider. The SDK’s self-host adapter reads ordinary variables for each; the <code>.env.example</code> names them.</p>
<h2>Bringing a project in</h2>
<p>Repositories that match the template shape (TypeScript, Node, Postgres) can be imported. Others can be opened read-only so your AI can study them and propose a plan; we do not promise to run arbitrary stacks.</p>`,
  },
  {
    slug: 'security',
    section: 'Reference',
    title: 'Security & data',
    description: 'Isolation, row-level security, secrets handling, and what we do and do not yet claim.',
    html: `
<h2>Isolation</h2>
<p>Each project’s workbench and live app run in their own virtual machine, with default-deny outbound network access opened only to the package registry and the providers whose secrets you have registered. Projects never share a container.</p>
<h2>Tenant data</h2>
<p>Power’s own control plane uses Postgres with row-level security <em>enabled and forced</em> on every tenant table. Child records are scoped by project ownership, not merely by user id — a policy our test suite checks by attempting a cross-tenant write. Your app’s data lives in its own database, physically separate from every other project’s.</p>
<h2>Secrets</h2>
<p>Collected in the browser, stored encrypted, injected as environment variables at process start, never written to disk or git, and scrubbed from every response. See <a href="/docs/secrets/">Secrets</a>.</p>
<h2>The AI’s reach</h2>
<p>Of ${TOOLS.length} tools, ${TOOLS.filter((t) => t.live_capable).length} can affect your live app, and each requires a human confirmation in the browser. None can run arbitrary SQL against live. This is a property of the tool registry, not a guideline.</p>
<h2>Audit</h2>
<p>Every state change, approval and secret access is written to an append-only log with the run id, so what happened to a project is always reconstructible.</p>
<h2>What we do not yet claim</h2>
<p>Power is not yet SOC 2 audited and does not yet offer regional data residency. The engineering that makes both achievable — audit logging, infrastructure as code, least-privilege service accounts, region as a project property — is in place; the audit is not. We would rather tell you that than imply otherwise.</p>
<p>Questions: <a href="mailto:${SITE.email}">${SITE.email}</a>.</p>`,
  },
  {
    slug: 'faq',
    section: 'Reference',
    title: 'FAQ',
    description: 'Common questions about Power.',
    html: `
<details open><summary>Which AI should I use?</summary><p>Whichever you already pay for. Power has been run end-to-end with Claude Code; any MCP-capable client works. Stronger models write better plans and fewer retries, but the gates hold regardless.</p></details>
<details><summary>Does the AI ever touch my live app or data?</summary><p>Only through <code>publish_app</code>, <code>promote_migration</code>, <code>rollback</code> and <code>unpublish_app</code>, and each needs your confirmation in the browser. There is no tool that runs SQL against live.</p></details>
<details><summary>What if the AI gets stuck?</summary><p>Each retry loop is capped at two. After that the run stops and the browser shows you why. You can restore a checkpoint, start a new run with a clearer goal, or export and leave — all free.</p></details>
<details><summary>Can I see the code?</summary><p>Always: your AI can read any file for free, and you can export the whole repository with history at any time.</p></details>
<details><summary>How is this different from other AI app builders?</summary><p>Two ways. First, the thinking runs on the AI you already pay for, over MCP, so there is no credit meter on the model itself. Second — and this is the real difference — the work is checked by deterministic gates before you see it, the AI cannot touch your live database, and you can export a real git repository that runs unchanged, free, at any time.</p></details>
<details><summary>What are the plan limits?</summary><p>${(['free', 'pro', 'power'] as const).map((k) => `${k[0]!.toUpperCase() + k.slice(1)}: ${PLANS[k].per_day.toLocaleString()} build actions a day${PLANS[k].per_week ? ` (${PLANS[k].per_week} a week)` : ''} for $${PLANS[k].price_usd_month}/month`).join('; ')}. Reads, exports and refusals never count.</p></details>
<details><summary>Is Power open source?</summary><p>Source-available. You can run the whole thing locally with no cloud accounts. See the <a href="${SITE.github}">repository</a>.</p></details>`,
  },
];

export const DOC_SECTIONS = [...new Set(DOCS.map((d) => d.section))];
export const getDoc = (slug: string) => DOCS.find((d) => d.slug === slug);
