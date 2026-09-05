/**
 * The playable run. A simulation of a Power run, in the page, that the
 * visitor drives: they type what to build, watch the plan get refused and
 * fixed, approve it, watch the build go green, confirm the publish, and get a
 * receipt. Two of the steps require their click, because two of the steps
 * require a person in the real thing.
 *
 * It is labelled a simulation on the page and links to the proof page, which
 * is generated from a real transcript. Nothing here pretends to be a server.
 *
 * Tool names, refusal reasons and rule ids are the real ones from the server's
 * registry, so what a visitor sees here is what their AI will see later.
 */
(() => {
  const form = document.getElementById('run-form');
  const input = document.getElementById('run-input');
  const log = document.getElementById('run-log');
  const skipBtn = document.getElementById('run-skip');
  const againBtn = document.getElementById('run-again');
  if (!form || !input || !log) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- cycling placeholder
  const IDEAS = ['a booking page for my barbershop', 'an invoice tracker for my studio', 'a waitlist with referral codes', 'a menu with online orders for my café', 'a client portal for my accounting practice', 'a habit tracker with weekly emails'];
  let ideaIdx = 0;
  const cycle = setInterval(() => { if (document.activeElement !== input && !input.value) { ideaIdx = (ideaIdx + 1) % IDEAS.length; input.placeholder = IDEAS[ideaIdx]; } }, 2600);

  // ---- what the architect would write, from what the visitor typed
  const PLANS = [
    { m: /book|appoint|schedul|reserv|slot/i, reqs: ['Pick an open time slot', 'Confirm the booking by email', 'Cancel or move a booking'], table: 'bookings' },
    { m: /invoice|bill|payment|quote/i, reqs: ['Create an invoice with line items', 'Mark an invoice paid', 'See what is overdue'], table: 'invoices' },
    { m: /waitlist|signup|sign-up|launch|referr/i, reqs: ['Join the waitlist with an email', 'Get a referral code on joining', 'Move up when a referral joins'], table: 'signups' },
    { m: /menu|order|caf|restaurant|shop|store|cart/i, reqs: ['Browse items by category', 'Place an order for pickup', 'Get a notification when it is ready'], table: 'orders' },
    { m: /portal|client|customer|crm/i, reqs: ['Sign in to a private area', 'See documents shared with me', 'Message the team'], table: 'clients' },
    { m: /habit|track|log|journal/i, reqs: ['Log an entry for today', 'See a weekly streak', 'Receive a weekly summary email'], table: 'entries' },
    { m: /blog|note|post|article/i, reqs: ['Write and publish a post', 'List posts newest first', 'Share a post by link'], table: 'posts' },
  ];
  const planFor = (text) => PLANS.find((p) => p.m.test(text)) ?? { reqs: ['Create and list records', 'Edit and delete a record', 'Sign in to manage them'], table: 'records' };
  const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'my-app';

  // ---- rendering
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const push = (node) => { log.appendChild(node); window.PowerMotion?.enter(node); log.scrollTop = log.scrollHeight; return node; };
  const line = (tool, args, status, kind = '') => push(el(`<div class="ln ${kind}"><span class="g">${kind === 'ok' ? '✓' : kind === 'no' ? '×' : '·'}</span><span><span class="k">${esc(tool)}</span>${args ? ` <span class="a">${esc(args)}</span>` : ''}</span><span class="st">${esc(status)}</span></div>`));
  const say = (text) => push(el(`<div class="ln say">${esc(text)}</div>`));

  let fast = false, cancelled = false, token = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, fast || reduced ? Math.min(ms, 40) : ms));
  const abortable = async (ms) => { await wait(ms); if (cancelled) throw new Error('cancelled'); };

  /**
   * A step only a person can take. In the demo that plays on load it advances
   * by itself after a pause, labelled as such; once the visitor has typed their
   * own idea it waits for their click, even in fast mode.
   */
  let attract = false;
  const human = (title, sub, label) => new Promise((resolve) => {
    const card = push(el(`<div class="human"><span><b>${esc(title)}</b>${esc(sub)}</span><button class="btn primary small" type="button">${esc(label)}</button></div>`));
    const b = card.querySelector('button');
    const done = () => { card.classList.add('done'); resolve(); };
    b.addEventListener('click', done, { once: true });
    if (attract) {
      card.querySelector('span').insertAdjacentHTML('beforeend', '<em class="auto">demo: this is where you’d click</em>');
      setTimeout(() => { if (attract && !card.classList.contains('done')) done(); }, fast ? 300 : 1800);
    } else {
      b.focus({ preventScroll: true });
    }
  });

  const MARK_LIVE = () => document.querySelectorAll('.mark').forEach((m) => { m.classList.add('live'); setTimeout(() => m.classList.remove('live'), 900); });

  async function run(text) {
    const my = ++token;
    cancelled = false; fast = false;
    log.innerHTML = '';
    skipBtn.hidden = false; againBtn.hidden = true;
    const plan = planFor(text);
    const name = slug(text);
    const stamp = () => new Date().toISOString().slice(11, 19);

    try {
      say(`Using Power to build “${text}”.`);
      await abortable(500);
      line('create_project', `{ name: "${text.slice(0, 40)}" }`, 'ok · phase: spec', 'ok');
      await abortable(700);
      say('Writing the plan. Three requirements, each with an acceptance criterion.');
      await abortable(900);
      for (const [i, r] of plan.reqs.entries()) { line(`R${i + 1}`, r, 'WHEN … THE SYSTEM SHALL …'); await abortable(260); }
      await abortable(400);
      line('submit_spec', '{ spec: "SPEC.md" }', 'refused · gate_not_satisfied', 'no');
      push(el(`<div class="fail"><b>tasks.missing_requirement_ref</b> — Task “Send the email” cites no requirement. Every task names the R# it serves.<small>next_action: submit_spec · retries left: 1 · not billed</small></div>`));
      await abortable(1400);
      say('The gate found one task without a requirement reference. Fixing that and resubmitting.');
      await abortable(900);
      line('submit_spec', '{ spec: "SPEC.md" }', 'ok · phase: spec_approval', 'ok');
      await abortable(500);

      await human('The plan is ready for you.', `Three requirements for ${name}. Nothing is built until you approve.`, 'Approve the plan');
      if (cancelled || my !== token) return;
      MARK_LIVE();
      line('get_context', '', 'ok · phase: build', 'ok');
      await abortable(600);
      say('Approved. Building against the plan.');
      const files = push(el(`<div class="files"></div>`));
      for (const f of ['src/app.ts', `src/${plan.table}.ts`, 'src/app.test.ts']) { files.appendChild(el(`<div class="ln ok"><span class="g">✓</span><span><span class="k">write_file</span> <span class="a">${f}</span></span><span class="st">ok</span></div>`)); await abortable(420); }
      await abortable(300);
      line('provision_database', '', 'ok · live + safe copy', 'ok');
      await abortable(500);
      line('propose_migration', `create table ${plan.table} (…)`, 'ok · rehearsed on a copy of live · reversible', 'ok');
      await abortable(700);
      line('run_tests', '', 'running…');
      const tests = push(el(`<div class="tests"></div>`));
      const n = 12;
      for (let i = 0; i < n; i++) { const d = el('<i></i>'); tests.appendChild(d); await abortable(110); d.classList.add('p'); }
      log.lastElementChild.previousElementSibling.replaceWith(el(`<div class="ln ok"><span class="g">✓</span><span><span class="k">run_tests</span></span><span class="st">green · ${n} passed · phase: verify</span></div>`));
      log.appendChild(tests);
      await abortable(800);
      say('Green. Verifying against the plan with fresh eyes — every requirement exercised, not just read.');
      await abortable(1100);
      line('submit_verification', '{ pass: true, visual_score: 4 }', 'ok · ready to ship', 'ok');
      line('promote_migration', '', `ok · ${plan.table} is live · snapshot taken`, 'ok');
      await abortable(500);

      await human('Verified. Publish it?', 'Every P0 passed by interaction and the checks are green. This makes it live.', 'Confirm publish');
      if (cancelled || my !== token) return;
      MARK_LIVE();
      line('publish_app', '', 'ok · v1 live · phase: done', 'ok');
      await abortable(600);

      // The receipt, line by line.
      const items = [
        ['Plan approved', 'you · in browser'],
        [`Spec gate · 3 requirements, each with an acceptance criterion`, 'code'],
        [`Typecheck + ${n} tests green`, 'code'],
        [`Migration rehearsed on a copy of live · reversible`, 'code'],
        ['Verified by interaction · every P0 exercised', 'fresh eyes'],
        ['Publish confirmed', 'you · in browser'],
      ];
      const receipt = push(el(`<div class="receipt" style="margin:.4rem 0 0 1.9rem"><div class="rh"><strong>Verification receipt</strong><span class="tag">v1 · live</span></div><ol></ol><div class="rf"><span>run_${Math.random().toString(16).slice(2, 6)} · 13 build actions · 1 refusal (unbilled)</span><span>git tag v1 · rollback ready</span></div><div class="actions"><button class="btn outline small" type="button">Copy receipt</button><a class="btn outline small" href="proof.html">See a real one</a></div></div>`));
      const ol = receipt.querySelector('ol');
      for (const [what, who] of items) { ol.appendChild(el(`<li><span class="ok">✓</span><span>${esc(what)}</span><span class="who">${esc(who)}</span></li>`)); await abortable(180); }
      receipt.querySelector('button').addEventListener('click', async (e) => {
        const txt = [`Power · verification receipt · ${name} v1 · ${stamp()}`, ...items.map(([w, who]) => `✓ ${w} — ${who}`), 'Simulation. Real runs: see the proof page.'].join('\n');
        try { await navigator.clipboard.writeText(txt); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Select & copy'; }
      });
      window.PowerMotion?.burst(receipt);
      push(el(`<div class="live"><span><b>${esc(name)}.power.app</b> would be live now.</span><span>Next: “add dark mode” starts a new run — same project, fresh checks.</span></div>`));
    } catch (e) {
      if (String(e.message) !== 'cancelled') console.error(e);
    } finally {
      if (my === token) { skipBtn.hidden = true; againBtn.hidden = false; }
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearInterval(cycle);
    attract = false;                          // the visitor is driving now
    const text = input.value.trim() || input.placeholder;
    input.value = text;
    token++; cancelled = true;               // stop any run in progress
    setTimeout(() => run(text), 0);
    document.getElementById('run-console')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
  });
  skipBtn.addEventListener('click', () => { fast = true; skipBtn.hidden = true; });
  againBtn.addEventListener('click', () => { input.focus(); form.requestSubmit(); });

  // The stage is never empty: a demo run starts on load, and the visitor's own
  // prompt takes over the moment they submit one. Not under reduced motion.
  if (!reduced && !new URLSearchParams(location.search).has('static')) {
    setTimeout(() => { if (token === 0) { attract = true; run(input.placeholder); } }, 1400);
  }
})();
