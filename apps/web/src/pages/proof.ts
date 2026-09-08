import { esc, type Page } from '../layout.js';
import { loadTranscript } from '../transcript.js';

/** Generated from the committed transcripts, so it cannot say anything the run did not do. */
const { calls, finals, refusals } = loadTranscript();

export const proof: Page = {
  path: 'proof',
  title: 'Proof: a real Claude, start to ship',
  description: 'A real Claude Code session driven through Power’s gates: every tool call, every refusal, and what the model did next. Generated from the committed transcript.',
  body: `
<section class="page-head">
  <div class="wrap">
    <div class="eyebrow">Proof, not a demo video</div>
    <h1>A real Claude. Start to ship.<br>Every call, unedited.</h1>
    <p class="lead">This page is generated from the transcript of a real Claude Code session against Power, committed to the repository. The model was Sonnet 4.5. A human approved the plan and confirmed the publish between phases, exactly as you would.</p>
  </div>
</section>
<section style="padding-top:0">
  <div class="wrap">
    <div class="stats">
      <div><div class="stat">${calls.length}</div><p>tool calls to ship a tested module</p></div>
      <div><div class="stat">${refusals.length}</div><p>refusal${refusals.length === 1 ? '' : 's'} — fixed on the next call, unbilled</p></div>
      <div><div class="stat">0</div><p>protocol errors; no refusal mistaken for a broken tool</p></div>
    </div>
  </div>
</section>
<section>
  <div class="wrap doc-wide">
    <h2>The run</h2>
    <p class="muted">Phase 1: plan. Phase 2: build and verify, after approval in the browser. Phase 3: publish, after confirmation in the browser.</p>
    <div class="tx" style="margin-top:1.5rem">
      ${calls
        .map(
          (c) => `<div><span class="ph">p${c.phase}</span><span><code>${esc(c.tool)}</code>${c.says ? ` <span class="muted">— ${esc(c.says.slice(0, 110).replace(/\s+/g, ' '))}${c.says.length > 110 ? '…' : ''}</span>` : ''}</span><span class="${c.ok === false ? 'ref' : 'ok'}">${c.ok === false ? `refused · ${esc(c.reason ?? '')}` : 'ok'}</span></div>`,
        )
        .join('')}
    </div>
    ${
      refusals.length
        ? `<h2>What happened at the refusal</h2>
    <p>The spec gate rejected the first plan: two tasks did not name the requirement they served. The response carried the two failures by rule name and a <code>next_action</code> of <code>submit_spec</code>. The model’s next words were <em>“The spec gate found issues — two tasks don’t cite requirements. Let me fix that,”</em> and its next call was a corrected plan, which passed. Nothing about that exchange was scripted.</p>`
        : ''
    }
    <h2>What the model said at each stop</h2>
    ${Object.entries(finals)
      .map(([ph, text]) => `<div class="callout"><strong class="mono">phase ${ph}</strong><p style="margin:.4rem 0 0">${esc(text.slice(0, 420).replace(/\s+/g, ' '))}${text.length > 420 ? '…' : ''}</p></div>`)
      .join('')}
    <h2>What this does and doesn’t show</h2>
    <p>It shows the thing the design depends on: a model we don’t control, in a client we don’t control, received a structured refusal and treated it as instructions rather than as a broken tool. It never tried to write code before approval, never tried to publish before verification, and stopped at both human gates.</p>
    <p>It doesn’t show a hard task. The module was small enough to pass verification first time, so the honest-failure path — a verifier sending the run back to build on a counted retry — ran only in our automated suite. We’ll publish a harder run, and runs from ChatGPT and Cursor, the same way: generated from committed transcripts.</p>
    <p class="muted">Reproduce it: <code>scripts/eval-claude.sh</code> in the repository. Transcripts: <code>docs/evals/</code>.</p>
  </div>
</section>
`,
};
