import { PLANS, TOOLS } from '@power/protocol';
import type { Page } from '../layout.js';

const free = TOOLS.filter((t) => !t.metered).map((t) => `<code>${t.name}</code>`).join(', ');

export const pricing: Page = {
  path: 'pricing',
  title: 'Pricing',
  description: 'Flat monthly plans metered in build actions. Refusals and errors are refunded. Reads and export are always free.',
  body: `
<section class="page-head">
  <div class="wrap">
    <div class="eyebrow">Pricing</div>
    <h1>Pay for work that passed.<br>Nothing else.</h1>
    <p class="lead">A build action is one tool call your AI makes that changes something. It is reserved before the call and refunded if a gate said no or something broke. The thinking runs on the AI subscription you already have.</p>
  </div>
</section>
<section style="padding-top:0">
  <div class="wrap">
    <div class="plans">
      ${(['free', 'pro', 'power'] as const)
        .map((k) => {
          const p = PLANS[k];
          const extras: Record<typeof k, string[]> = {
            free: ['Community support', 'power.app subdomain', 'Database on request'],
            pro: ['Email support', 'Custom domain', 'Per-environment secrets', 'Priority build machines'],
            power: ['Priority support', 'Multiple custom domains', 'Longer job timeouts', 'Early access to new gates'],
          };
          return `<div class="plan${k === 'pro' ? ' featured' : ''}">
          <h3>${k[0]!.toUpperCase() + k.slice(1)}</h3>
          <div class="price">$${p.price_usd_month}<small>/month</small></div>
          <p class="muted" style="margin:.4rem 0 0;font-size:.9rem">${k === 'free' ? 'Try it properly.' : k === 'pro' ? 'For a builder shipping real apps.' : 'For people who build all day.'}</p>
          <ul>
            <li><strong>${p.per_day.toLocaleString()}</strong> build actions per day${p.per_week ? `, ${p.per_week} per rolling week` : ''}</li>
            <li>${p.projects ? `${p.projects} projects` : 'Unlimited projects'}</li>
            <li>Free reads, free export, free refusals</li>
            ${extras[k].map((e) => `<li>${e}</li>`).join('')}
          </ul>
          <a class="btn ${k === 'pro' ? 'primary' : 'outline'}" href="docs/getting-started.html">${k === 'free' ? 'Start free' : `Choose ${k[0]!.toUpperCase() + k.slice(1)}`}</a>
        </div>`;
        })
        .join('')}
    </div>
    <p class="muted" style="margin-top:1.2rem;font-size:.9rem">Yearly billing: two months free. Limits reset at midnight UTC. Hosting for published apps and database storage are included within fair use; heavy traffic is metered separately and capped, never silently billed.</p>
  </div>
</section>

<section>
  <div class="wrap doc-wide">
    <h2>What counts as a build action</h2>
    <div class="grid2" style="margin-top:1.5rem">
      <div class="card"><h3>Counted (when it succeeds)</h3><p>Creating a project, writing or editing a file, adding a dependency, running tests, submitting a plan or verification that <em>passes</em>, proposing a migration that passes its gate, publishing.</p></div>
      <div class="card"><h3>Never counted</h3><p>${free}.</p><p style="margin-top:.6rem">And any call that ends in a refusal or an error — the reservation is released before the response is sent.</p></div>
    </div>
    <h2>Why this is the honest way to meter</h2>
    <p>Credit-per-prompt pricing charges you every time the AI fixes its own mistake, which is most of the time on a real project. Metering tool calls is fairer, and refunding refused calls closes the last gap: a gate that says “no, fix R3 first” costs you nothing, and the corrected call that passes costs you one.</p>
    <p>Your quota and today’s remaining actions are in every response your AI receives, so it can tell you before you run out — not after.</p>
  </div>
</section>

<section>
  <div class="wrap">
    <h2>Questions</h2>
    <details><summary>Do I need a Claude or ChatGPT subscription?</summary><p>Yes — that is the point. Power provides the hands and the infrastructure; your existing AI provides the thinking, on the plan you already pay for. Any MCP-capable client works, including Claude Code and Cursor.</p></details>
    <details><summary>What happens when I hit the daily cap?</summary><p>Writes stop until midnight UTC; reads, exports and rollbacks keep working. Your AI is told plainly so it can tell you, rather than retrying into a wall. Nothing you built is affected.</p></details>
    <details><summary>Is there really no charge for refused calls?</summary><p>None. The refund is implemented in the same code path as the reservation, and the ledger records both. You can see it in the source.</p></details>
    <details><summary>Can I export on the free plan?</summary><p>Yes. Export is free on every plan, forever. It is not a feature we could charge for without breaking the promise it exists to make.</p></details>
    <details><summary>What about hosting costs for a busy app?</summary><p>Published apps run within a fair-use allowance included in each plan. If an app outgrows it, we tell you and offer a metered hosting add-on with a hard cap you set. We do not bill overage silently.</p></details>
  </div>
</section>`,
};
