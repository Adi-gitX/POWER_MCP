import { PLANS } from '@power/protocol';
import { SITE, type Page } from '../layout.js';
import { loadTranscript } from '../transcript.js';

const { calls, refusals } = loadTranscript();

export const home: Page = {
  path: 'index',
  title: 'Ship it checked',
  description:
    'Power turns Claude, ChatGPT or Cursor into a full-stack app builder whose work is checked by code before you see it. A database the AI can’t touch. Code you can take anywhere. Try a run on the page.',
  body: `
<section class="hero">
  <div class="wrap">
    <div class="eyebrow">An MCP server for building real apps</div>
    <h1>Ship it <em>checked.</em></h1>
    <p class="lead">Build apps in Claude, ChatGPT or Cursor. Power runs them through gates your AI can’t argue with — then hosts them, keeps the data safe, and lets you leave with everything.</p>
    <form class="prompt" id="run-form" autocomplete="off">
      <label class="skip" for="run-input">What do you want to build?</label>
      <input id="run-input" type="text" maxlength="120" placeholder="a booking page for my barbershop" aria-describedby="run-hint">
      <button class="btn dark" type="submit" id="run-go">Run it</button>
    </form>
    <p class="prompt-hint" id="run-hint">Or watch the demo below. You’ll be asked to approve twice — that’s the point.</p>
    <div class="clients"><span>Claude</span><span>ChatGPT</span><span>Cursor</span><span>Claude Code</span><span>Any MCP client</span></div>
  </div>

  <div class="hud">
    <div class="console" id="run-console" aria-live="polite" aria-label="Run console">
      <div class="bar"><span><span class="dots"><i></i><i></i><i></i></span>run console</span><span class="ctl"><button type="button" id="run-skip" hidden>Skip ahead</button><button type="button" id="run-again" hidden>Run again</button></span></div>
      <div class="log" id="run-log"><div class="empty"><b>Nothing running yet.</b>Type what you want to build, or just press Run.</div></div>
    </div>
  </div>
</section>
<div class="hud-wrap"><p class="simnote">A simulation, in your browser. The real thing runs inside your own AI — <a href="proof.html">see a real run, every call unedited</a>.</p></div>
<script src="js/run.js" defer></script>

<section class="manifesto-wrap">
  <div class="wrap">
    <div class="manifesto">
      <div class="eyebrow">Why Power exists</div>
      <p class="manifesto-text" id="manifesto">You already have a brilliant model. What you don’t have is anything checking its work. It writes the plan and grades the plan. It edits your live database because nothing stops it. When it says done, you find out later.</p>
      <p class="manifesto-end">So we built the thing that says no.</p>
    </div>
    <div class="manifesto-space" aria-hidden="true"></div>
  </div>
</section>

<section class="soft">
  <div class="wrap">
    <div class="section-head"><div class="eyebrow">How it works</div><h2>Five steps. Two of them are yours.</h2><p class="lead">Every arrow is a gate the server enforces. Your AI walks the pipeline; code checks each step; you make the two decisions that should be a person’s.</p></div>
    <div class="steps">
      <i class="steps-line" aria-hidden="true"></i>
      <div class="step"><div class="step-top"><span class="sn">01</span></div><h3>Plan</h3><p>Your AI writes a short spec. The gate checks it has requirements, acceptance criteria and tasks that trace to them.</p></div>
      <div class="step yours"><div class="step-top"><span class="sn">02</span><span class="you">you</span></div><h3>Approve</h3><p>You read the plan and approve it in your browser. Nothing is built until you do.</p></div>
      <div class="step"><div class="step-top"><span class="sn">03</span></div><h3>Build</h3><p>Your AI writes code and tests in an isolated workbench. It can’t hand off until typecheck and tests are green.</p></div>
      <div class="step"><div class="step-top"><span class="sn">04</span></div><h3>Verify</h3><p>A fresh-eyes check against the plan. Every P0 must be exercised, not just looked at.</p></div>
      <div class="step yours"><div class="step-top"><span class="sn">05</span><span class="you">you</span></div><h3>Publish</h3><p>You confirm. Power tags a release and puts it live. Rollback is one call.</p></div>
    </div>
    <p class="muted" style="margin:1.6rem 0 0;max-width:60ch">Then: <em>“add dark mode.”</em> A new run starts against the same project — same code, data and secrets, fresh plan, fresh checks.</p>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="section-head center"><div class="eyebrow">What it does</div><h2>Where the model meets a <em style="color:var(--blue)">no</em>.</h2><p class="lead">Three pieces of code that don’t care how confident the model sounds.</p></div>
    <div class="feats">

      <article class="feat">
        <span class="feat-tag">The refusal</span>
        <div class="feat-art gate-art">
          <input class="skip" type="radio" name="gate-demo" id="gate-no" checked>
          <input class="skip" type="radio" name="gate-demo" id="gate-ok">
          <div class="art-pane" data-pane="no">
            <div class="al no"><span class="g">&#215;</span><span class="k">submit_spec</span><span class="st">refused</span></div>
            <div class="al-note no"><b>ears.missing</b><span>R2 has no acceptance criterion.</span></div>
            <div class="al-foot">next_action: submit_spec &#183; retries left: 1 &#183; not billed</div>
          </div>
          <div class="art-pane" data-pane="ok">
            <div class="al ok"><span class="g">&#10003;</span><span class="k">submit_spec</span><span class="st">ok</span></div>
            <div class="al-note ok"><b>R2</b><span>WHEN a slot is taken THE SYSTEM SHALL offer the next free time.</span></div>
            <div class="al-foot">phase: spec_approval &#183; waiting for you</div>
          </div>
          <div class="art-switch" role="group" aria-label="Gate result">
            <label for="gate-no">Refused</label><label for="gate-ok">After the fix</label>
          </div>
        </div>
        <h3>Gates the AI can&#8217;t argue with</h3>
        <p>Every refusal names the rule and the fix, so the retry converges instead of guessing. After two, it stops and asks you.</p>
      </article>

      <article class="feat">
        <span class="feat-tag">The tool list</span>
        <div class="feat-art">
          <div class="art-pane">
            <div class="al ok"><span class="g">&#10003;</span><span class="k">provision_database</span><span class="st">live + safe copy</span></div>
            <div class="al ok"><span class="g">&#10003;</span><span class="k">propose_migration</span><span class="st">rehearsed on a copy</span></div>
            <div class="al ok"><span class="g">&#10003;</span><span class="k">promote_migration</span><span class="st">after the tests pass</span></div>
            <div class="al gone"><span class="g">&#8213;</span><span class="k">execute_sql</span><span class="st">no such tool</span></div>
          </div>
          <div class="art-foot">Not restricted. Absent.</div>
        </div>
        <h3>A database the AI can&#8217;t break</h3>
        <p>Every change is rehearsed on a copy of live and has to be reversible before it is promoted.</p>
      </article>

      <article class="feat">
        <span class="feat-tag">The two stops</span>
        <div class="feat-art">
          <div class="art-pane">
            <div class="ask"><span><b>Approve the plan</b>spec_approval</span><span class="ask-by">you</span></div>
            <div class="ask"><span><b>Confirm publish</b>verify_approval</span><span class="ask-by">you</span></div>
          </div>
          <div class="art-foot">Both clicks happen in your browser.</div>
        </div>
        <h3>Two decisions stay yours</h3>
        <p>Nothing is built before the first and nothing goes live before the second. The chat can ask; it cannot answer.</p>
      </article>

    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="section-head"><div class="eyebrow">The difference</div><h2>Most AI builders sell the first hour. Power is built for the second.</h2></div>
    <div class="tablewrap">
    <table class="compare">
      <thead><tr><th></th><th>The usual way</th><th>With ${SITE.name}</th></tr></thead>
      <tbody>
        <tr><td>Who does the thinking</td><td class="old">A model you rent by the credit</td><td class="new">The AI you already pay for, over MCP</td></tr>
        <tr><td>Who checks the work</td><td class="old">You do, by looking</td><td class="new">Deterministic gates, before you see it</td></tr>
        <tr><td>Fixing the AI’s mistakes</td><td class="old">Costs credits every time</td><td class="new">Refused calls are never billed</td></tr>
        <tr><td>Your live database</td><td class="old">The assistant can run SQL against it</td><td class="new">Untouchable; changes rehearsed and gated</td></tr>
        <tr><td>Version control</td><td class="old">Proprietary checkpoints</td><td class="new">Real git; every checkpoint a commit</td></tr>
        <tr><td>Leaving</td><td class="old">A zip, if you pay; then a rewrite</td><td class="new">Free export with history that runs unchanged</td></tr>
        <tr><td>Secrets</td><td class="old">Pasted into a chat</td><td class="new">Browser form; the model learns only the name</td></tr>
        <tr><td>Who else can see your data</td><td class="old">Undisclosed</td><td class="new">Row-level security, forced and tested</td></tr>
      </tbody>
    </table>
    </div>
  </div>
</section>

<section class="soft">
  <div class="wrap">
    <div class="section-head"><div class="eyebrow">Proof</div><h2>A real run. Every call, unedited.</h2><p class="lead">A real Claude session, a human approving between phases, a transcript committed to the repository.</p></div>
    <div class="stats">
      <div><div class="stat">${calls.length}</div><p>tool calls to plan, build, verify and ship a tested module</p></div>
      <div><div class="stat">${refusals.length}</div><p>refusal${refusals.length === 1 ? '' : 's'} by a gate — fixed on the next call, unbilled</p></div>
      <div><div class="stat">0</div><p>protocol errors; no refusal mistaken for a broken tool</p></div>
    </div>
    <div class="actions" style="margin-top:1.8rem"><a class="btn outline" href="proof.html">Read the run →</a></div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="section-head center"><div class="eyebrow">Pricing</div><h2>Flat plans. No surprise bills.</h2><p class="lead">Metered in build actions, refunded when a gate says no. Reads and export are always free.</p></div>
    <div class="plans">
      ${(['free', 'pro', 'power'] as const)
        .map(
          (k) => `<div class="plan${k === 'pro' ? ' featured' : ''}">
        <h3>${k[0]!.toUpperCase() + k.slice(1)}</h3>
        <div class="price">$${PLANS[k].price_usd_month}<small>/month</small></div>
        <ul>
          <li>${PLANS[k].per_day.toLocaleString()} build actions a day${PLANS[k].per_week ? ` (${PLANS[k].per_week} a week)` : ''}</li>
          <li>${PLANS[k].projects ? `${PLANS[k].projects} projects` : 'Unlimited projects'}</li>
          <li>Free reads, free export, free refusals</li>
        </ul>
        <a class="btn ${k === 'pro' ? 'primary' : 'outline'}" href="pricing.html">${k === 'free' ? 'Start free' : 'See details'}</a>
      </div>`,
        )
        .join('')}
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="cta-band">
      <div><h2 style="margin:0;font-size:clamp(1.8rem,3.2vw,2.6rem)">Connect Power to the AI you already pay for.</h2><p class="muted" style="margin:.5rem 0 0">Two minutes. Nothing new to subscribe to for the thinking. The first project is free.</p></div>
      <div class="actions"><a class="btn primary" href="docs/getting-started.html">Get started</a><a class="btn outline" href="${SITE.github}">Read the source</a></div>
    </div>
  </div>
</section>`,
};
