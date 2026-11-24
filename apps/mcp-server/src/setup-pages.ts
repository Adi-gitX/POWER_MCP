/**
 * The setup pages: assistant, skill, Vercel, done.
 *
 * Server-rendered inside the same shell as the rest of the app, with one URL
 * per step and plain forms, so a reload, the back button and a browser with
 * no JavaScript all behave. The one page script follows the automated hand-off
 * and polls for progress; without it the page still works by reloading.
 */
import { esc, shell, type PageContext } from './dashboard.js';
import type { SetupState } from './pgstore.js';
import {
  PLATFORMS,
  SETUP_STEPS,
  SKILL_NAME,
  SKILL_PATH,
  SKILL_ZIP_PATH,
  AUTOMATED,
  CONNECTS_ITSELF,
  SETUP_CODE_TTL_MS,
  automatedHandoff,
  handoffMessage,
  inProse,
  launchLink,
  setupCommand,
  setupScriptUrl,
  skillInstallCommand,
  type Platform,
  type SetupStep,
} from './setup.js';

export interface SetupPageOptions {
  csrf: string;
  error?: string;
}

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Downloaded for the assistant currently chosen, not one picked earlier. */
export function skillTaken(setup: SetupState): boolean {
  return Boolean(setup.skill_downloaded_at) && (!setup.skill_platform || setup.skill_platform === setup.platform);
}

function stepDone(step: SetupStep, setup: SetupState): boolean {
  if (step === 'platform') return Boolean(setup.platform);
  if (step === 'skill') return skillTaken(setup);
  return Boolean(setup.vercel_connected_at || setup.vercel_skipped_at);
}

/** The progress rail. Every step stays reachable, so a person can go back and change their mind. */
function rail(current: SetupStep | 'done', setup: SetupState): string {
  const items = SETUP_STEPS.map((step, index) => {
    const done = stepDone(step.key, setup);
    const here = step.key === current;
    const state = here ? 'current' : done ? 'done' : 'todo';
    const reachable = index === 0 || Boolean(setup.platform);
    const mark = done && !here ? '✓' : String(index + 1);
    const inner = `<span class="setup-n" aria-hidden="true">${mark}</span><span>${esc(step.label)}</span>`;
    return `<li data-state="${state}">${
      reachable ? `<a href="${step.path}"${here ? ' aria-current="step"' : ''}>${inner}</a>` : `<span class="setup-off">${inner}</span>`
    }</li>`;
  }).join('');
  return `<nav class="setup-rail" aria-label="Setup progress"><ol>${items}<li data-state="${current === 'done' ? 'current' : 'todo'}"><span class="setup-off"><span class="setup-n" aria-hidden="true">→</span><span>Build</span></span></li></ol></nav>`;
}

function frame(ctx: PageContext, title: string, current: SetupStep | 'done', setup: SetupState, eyebrow: string, heading: string, lede: string, body: string, csrf: string): string {
  return shell(
    ctx,
    title,
    `<header class="hero setup-hero">
  <p class="eyebrow">${esc(eyebrow)}</p>
  <div class="hero-row">
    <div>
      <h1>${esc(heading)}</h1>
      <p class="lede">${lede}</p>
    </div>
    ${
      current !== 'done'
        ? `<form method="post" action="/start/later" class="setup-later">${csrf}<button class="btn btn-sm" type="submit">Finish later</button></form>`
        : ''
    }
  </div>
  ${rail(current, setup)}
</header>
${body}`,
    'setup',
  );
}

// ---------------------------------------------------------------- platform

export function setupPlatformPage(ctx: PageContext, setup: SetupState, options: SetupPageOptions): string {
  const chosen = setup.platform ?? 'claude-code';
  const cards = PLATFORMS.map(
    (p) => `<label class="choice">
  <input type="radio" name="platform" value="${p.id}"${p.id === chosen ? ' checked' : ''} required>
  <span class="choice-mark" aria-hidden="true">${esc(p.mark)}</span>
  <span class="choice-body"><span class="choice-name">${esc(p.name)}</span><span class="choice-blurb">${esc(p.blurb)}</span></span>
  <span class="choice-dot" aria-hidden="true"></span>
</label>`,
  ).join('');

  return frame(
    ctx,
    'Setup',
    'platform',
    setup,
    'Setup · 1 of 3',
    'Which assistant do you build with?',
    'Power works inside the AI you already use. Pick it here and the next step gives you the Power skill and the exact way to connect it.',
    `<form class="setup-card" method="post" action="/start">
  ${options.csrf}
  <fieldset class="choices">
    <legend class="sr-only">Your assistant</legend>
    ${cards}
  </fieldset>
  ${options.error ? `<p class="error" role="alert">${esc(options.error)}</p>` : ''}
  <div class="setup-actions">
    <button class="btn btn-primary" type="submit">Continue</button>
    <span class="note">You can change this at any time.</span>
  </div>
</form>`,
    options.csrf,
  );
}

// ------------------------------------------------------------------- skill

function connectBlock(platform: Platform, ctx: PageContext): string {
  const endpoint = `${ctx.baseUrl}/mcp`;
  const how = platform.connect(endpoint);
  const local = LOOPBACK.test(ctx.baseUrl);
  const warning =
    platform.needsPublicEndpoint && local
      ? `<p class="setup-warn" role="note">${esc(inProse(platform).replace(/^the /, 'The '))} connects from its own servers, so it cannot reach <span class="mono">${esc(endpoint)}</span> on this computer. Run Power at a public address (set <span class="mono">POWER_BASE_URL</span>), or use Claude Code for local work.</p>`
      : '';
  const body =
    how.kind === 'command'
      ? `<div class="copyline code-line"><code>${esc(how.command)}</code><button class="btn" type="button" data-copy="${esc(how.command)}">Copy</button></div>`
      : how.kind === 'link'
        ? `<div class="actions"><a class="btn" href="${esc(how.href)}">${esc(how.label)}</a><button class="btn btn-sm" type="button" data-copy="${esc(endpoint)}">Copy the URL</button></div>`
        : `<ol class="setup-list">${how.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
<div class="copyline"><code>${esc(endpoint)}</code><button class="btn" type="button" data-copy="${esc(endpoint)}">Copy</button></div>`;
  return `${body}<p class="note">${esc(how.note)}</p>${warning}`;
}

export interface SkillPageOptions extends SetupPageOptions {
  /** A fresh single-use setup code, for assistants Power can configure itself. */
  code?: string | null;
  /** Open the assistant as soon as the page settles, as picking it implies. */
  autoLaunch?: boolean;
  /** What the installer and the assistant have already reported. */
  live?: { installed: boolean; connected: boolean; client: string | null };
}

export function setupSkillPage(ctx: PageContext, platform: Platform, setup: SetupState, options: SkillPageOptions): string {
  const who = inProse(platform);
  const manual = manualSetup(ctx, platform, setup);
  const automated = options.code && AUTOMATED.has(platform.id);

  if (!automated) {
    return frame(ctx, 'Setup', 'skill', setup, 'Setup · 2 of 3', `Give ${who} the Power skill`,
      `The skill teaches ${esc(who)} how Power works: the plan it writes first, the gates it has to pass, and what waits for you here. Then connect it to this account. <a class="text-link" href="/start">Change assistant</a>`,
      `${manual.body}${manual.handoff}${skillActions()}`, options.csrf);
  }

  const code = options.code!;
  const command = setupCommand(ctx.baseUrl, code);
  const message = automatedHandoff(platform, ctx.baseUrl, code);
  const launch = launchLink(platform, message);
  const live = options.live ?? { installed: false, connected: false, client: null };
  const selfConnects = CONNECTS_ITSELF.has(platform.id);
  const state = (done: boolean, current: boolean) => (done ? 'done' : current ? 'current' : 'todo');

  const openRow = launch
    ? `<li data-check="open" data-state="${state(live.installed, !live.installed)}">
    <span class="check-mark" aria-hidden="true"></span>
    <div><strong>Open ${esc(platform.name)}</strong><span class="check-sub">${
      live.installed ? `${esc(platform.name)} ran the setup.` : 'Your browser asks to open it. Choose Open.'
    }</span></div>
    <a class="btn btn-sm${live.installed ? '' : ' btn-primary'}" href="${esc(launch)}" data-launch-btn>${live.installed ? 'Open again' : `Open ${esc(platform.name)}`}</a>
  </li>`
    : `<li data-check="open" data-state="${state(live.installed, !live.installed)}">
    <span class="check-mark" aria-hidden="true"></span>
    <div><strong>Run one command</strong><span class="check-sub">Paste it into a terminal. It is below.</span></div>
  </li>`;

  const rows = `${openRow}
  <li data-check="installed" data-state="${state(live.installed, false)}">
    <span class="check-mark" aria-hidden="true"></span>
    <div><strong>Install the skill${selfConnects ? ' and connect your account' : ''}</strong><span class="check-sub">${
      live.installed
        ? selfConnects ? `Skill installed, and ${esc(platform.name)} is set up to use ${esc(ctx.email ?? 'this account')}.` : 'Skill installed.'
        : launch ? `Press Enter in ${esc(platform.name)} and allow the command it runs.` : 'Waiting for the command to run.'
    }</span></div>
  </li>
  ${
    selfConnects
      ? `<li data-check="connected" data-state="${state(live.connected, live.installed && !live.connected)}">
    <span class="check-mark" aria-hidden="true"></span>
    <div><strong>${esc(platform.name)} reaches Power</strong><span class="check-sub">${
      live.connected ? `Connected${live.client ? ` from ${esc(live.client)}` : ''}.` : `Restart ${esc(platform.name)} once. Its first call to Power ticks this off.`
    }</span></div>
  </li>`
      : ''
  }`;

  const body = `<section class="setup-card setup-auto" data-setup-live data-launch="${launch ? esc(launch) : ''}" data-auto="${options.autoLaunch && launch && !live.installed ? '1' : ''}" data-self-connects="${selfConnects ? '1' : ''}" data-name="${esc(platform.name)}">
  <div class="setup-step-head"><span class="setup-n" aria-hidden="true">↗</span><div><h2>Power sets up ${esc(who)} for you</h2><p class="note">${
    launch
      ? `${esc(platform.name)} opens with one setup command typed in. It installs the Power skill and connects ${esc(platform.name)} to this account, and this page follows along. Nothing runs until you approve it there.`
      : 'One command installs the Power skill where your client reads it. This page follows along.'
  }</p></div></div>
  <ol class="setup-checks">${rows}</ol>
  <div class="setup-recover">
    <p class="note">${launch ? `${esc(platform.name)} didn’t open, or you’d rather use a terminal? This does exactly the same:` : 'Run this in a terminal:'}</p>
    <div class="copyline code-line"><code>${esc(command)}</code><button class="btn" type="button" data-copy="${esc(command)}">Copy</button></div>
    <div class="actions setup-gap">
      ${launch ? `<button class="btn btn-sm" type="button" data-copy="${esc(message)}">Copy the message</button>` : ''}
      <a class="text-link" href="${esc(setupScriptUrl(ctx.baseUrl, code))}" target="_blank" rel="noopener">Read the script</a>
      ${platform.installUrl ? `<a class="text-link" href="${esc(platform.installUrl)}" target="_blank" rel="noopener">Don’t have ${esc(platform.name)} yet?</a>` : ''}
    </div>
    <p class="note">The command works once and expires in ${Math.round(SETUP_CODE_TTL_MS / 60000)} minutes. It never prints your connection token; revoke it any time under Connect.</p>
  </div>
  <p class="setup-live-note" data-live-note role="status" aria-live="polite"></p>
</section>
<details class="setup-message setup-manual"><summary>Set it up by hand instead</summary>${manual.body}</details>`;

  return frame(ctx, 'Setup', 'skill', setup, 'Setup · 2 of 3', `Connect ${who}`,
    `Power installs its skill for ${esc(who)} and connects it to ${esc(ctx.email ?? 'this account')}. <a class="text-link" href="/start">Change assistant</a>`,
    `${body}${skillActions(live.installed)}${LIVE_SCRIPT}`, options.csrf);
}

function skillActions(ready = false): string {
  return `<div class="setup-actions">
  <a class="btn${ready ? ' btn-primary' : ''}" href="/start/vercel" data-continue>Continue to Vercel</a>
  <a class="btn" href="/start">Back</a>
</div>`;
}

/**
 * Follows the hand-off the way the reference flow does: open the tool a
 * moment after the page settles, treat the browser losing focus as the cue
 * that it opened, offer recovery if it did not, and poll Power for what the
 * installer and the assistant report. Moves on by itself once connected.
 */
const LIVE_SCRIPT = `<script>
(() => {
  const root = document.querySelector('[data-setup-live]');
  if (!root) return;
  const name = root.dataset.name;
  const launch = root.dataset.launch;
  const selfConnects = root.dataset.selfConnects === '1';
  const note = root.querySelector('[data-live-note]');
  const row = (key) => root.querySelector('[data-check="' + key + '"]');
  const set = (key, state, sub) => {
    const li = row(key);
    if (!li) return;
    li.dataset.state = state;
    if (sub) li.querySelector('.check-sub').textContent = sub;
  };
  let attempted = false, hadFocus = document.hasFocus(), handedOff = false, finished = false;
  const handOff = () => {
    if (handedOff || row('open')?.dataset.state === 'done') return;
    handedOff = true;
    set('open', 'done', name + ' is open. Press Enter there to send the message.');
    set('installed', 'current');
  };
  const open = () => {
    if (!launch) return;
    attempted = true;
    hadFocus = document.hasFocus();
    handedOff = false;
    try { window.location.href = launch; } catch (e) {}
    setTimeout(() => { if (!handedOff && note) note.textContent = name + ' did not open? Try again, or run the command below in a terminal.'; }, 2500);
  };
  root.querySelector('[data-launch-btn]')?.addEventListener('click', (event) => { event.preventDefault(); open(); });
  setInterval(() => {
    const focused = document.hasFocus();
    if (attempted && hadFocus && !focused) handOff();
    hadFocus = focused;
  }, 200);
  document.addEventListener('visibilitychange', () => { if (attempted && document.hidden) handOff(); });
  if (root.dataset.auto === '1') setTimeout(open, 1000);

  const advance = (vercel) => {
    if (finished) return;
    finished = true;
    if (note) note.textContent = 'All set. Moving on…';
    document.querySelector('[data-continue]')?.classList.add('btn-primary');
    setTimeout(() => { window.location.href = vercel ? '/start/done' : '/start/vercel'; }, 1400);
  };
  const tick = async () => {
    try {
      const response = await fetch('/start/status', { headers: { accept: 'application/json' }, credentials: 'same-origin' });
      if (!response.ok) return;
      const s = await response.json();
      if (s.installed) {
        set('open', 'done', name ? name + ' ran the setup.' : 'The command ran.');
        set('installed', 'done', selfConnects ? 'Skill installed, and ' + name + ' is set up to use this account.' : 'Skill installed.');
        document.querySelector('[data-continue]')?.classList.add('btn-primary');
        if (selfConnects && !s.connected) set('connected', 'current');
      }
      if (s.connected) set('connected', 'done', 'Connected' + (s.client ? ' from ' + s.client : '') + '.');
      if (s.installed && (s.connected || !selfConnects)) return advance(s.vercel);
    } catch (e) {}
    setTimeout(tick, 2000);
  };
  setTimeout(tick, 1200);
})();
</script>`;

function manualSetup(ctx: PageContext, platform: Platform, setup: SetupState): { body: string; handoff: string } {
  const install = skillInstallCommand(platform, ctx.baseUrl);
  const downloaded = skillTaken(setup);
  const who = inProse(platform);
  const mdHref = `${SKILL_PATH}?for=${platform.id}&download=1`;
  const zipHref = `${SKILL_ZIP_PATH}?for=${platform.id}`;
  const message = handoffMessage(platform, ctx.baseUrl);
  const launch = launchLink(platform, message);

  const getSkill = platform.skillsDir
    ? `<p>Save it as <span class="mono">${esc(`${platform.skillsDir}/${SKILL_NAME}/SKILL.md`)}</span>. One command does it:</p>
<div class="copyline code-line"><code>${esc(install!)}</code><button class="btn" type="button" data-copy="${esc(install!)}">Copy</button></div>
<div class="actions setup-gap"><a class="btn" href="${esc(mdHref)}" download>Download SKILL.md</a><a class="text-link" href="${esc(`${SKILL_PATH}?for=${platform.id}`)}" target="_blank" rel="noopener">Read it first</a></div>`
    : `<ol class="setup-list">
  <li>Download the skill below.</li>
  <li>In Claude, open Settings → Capabilities, turn on code execution if it is off, and choose Upload skill under Skills.</li>
  <li>Pick <span class="mono">${SKILL_NAME}.zip</span>. Claude uses it whenever you ask it to build with Power.</li>
</ol>
<div class="actions setup-gap"><a class="btn" href="${esc(zipHref)}" download>Download ${SKILL_NAME}.zip</a><a class="text-link" href="${esc(`${SKILL_PATH}?for=${platform.id}`)}" target="_blank" rel="noopener">Read the skill</a></div>`;

  const handoff = platform.launch
    ? `<section class="setup-card setup-handoff">
  <div class="setup-step-head"><span class="setup-n" aria-hidden="true">↗</span><div><h2>Or let ${esc(platform.name)} do both</h2><p class="note">Opens ${esc(platform.name)} with a setup message typed in. Nothing is sent until you press Enter there.</p></div></div>
  <div class="actions">
    ${launch ? `<a class="btn btn-primary" href="${esc(launch)}">Open ${esc(platform.name)}</a>` : ''}
    <button class="btn" type="button" data-copy="${esc(message)}">Copy the message</button>
    ${platform.installUrl ? `<a class="text-link" href="${esc(platform.installUrl)}" target="_blank" rel="noopener">Don’t have ${esc(platform.name)} yet?</a>` : ''}
  </div>
  <details class="setup-message"><summary>See the message</summary><pre>${esc(message)}</pre></details>
</section>`
    : '';

  const body = `<div class="setup-grid">
<section class="setup-card">
  <div class="setup-step-head"><span class="setup-n" aria-hidden="true">${downloaded ? '✓' : 'A'}</span><div><h2>Install the skill</h2>${
    downloaded ? '<p class="saved">Downloaded. Install it as shown, or download it again any time.</p>' : ''
  }</div></div>
  ${getSkill}
</section>
<section class="setup-card">
  <div class="setup-step-head"><span class="setup-n" aria-hidden="true">B</span><div><h2>Connect ${esc(who)} to Power</h2></div></div>
  ${connectBlock(platform, ctx)}
</section>
</div>`;
  return { body, handoff };
}

// ------------------------------------------------------------------ vercel

export interface VercelPageOptions extends SetupPageOptions {
  /** Publishing goes to local previews on this server, whatever is connected. */
  localDeployer: boolean;
  token?: { fingerprint: string } | null;
  /** What was typed into the team field, kept when the form comes back with an error. */
  team?: string;
  /** A Vercel integration is configured, so connecting is an approval, not a paste. */
  oauth?: boolean;
  /** Arrived straight after connecting. */
  justConnected?: boolean;
}

export function setupVercelPage(ctx: PageContext, setup: SetupState, options: VercelPageOptions): string {
  const connected = Boolean(setup.vercel_connected_at);
  const local = options.localDeployer
    ? `<p class="setup-warn" role="note">This server publishes to local previews (<span class="mono">POWER_DEPLOYER=local</span>), so nothing goes to Vercel while you work here. The account you connect is used as soon as Vercel publishing is on.</p>`
    : '';

  const status = connected
    ? `<div class="setup-connected">
  <span class="chip" data-tone="live">Connected</span>
  <div><strong>${esc(setup.vercel_account ?? 'Vercel account')}</strong>${
    setup.vercel_team ? `<span class="dim"> · team ${esc(setup.vercel_team)}</span>` : '<span class="dim"> · personal account</span>'
  }${options.token ? `<span class="dim mono"> · token ${esc(options.token.fingerprint)}</span>` : ''}</div>
</div>`
    : '';

  const form = `<form class="setup-form" method="post" action="/start/vercel" autocomplete="off">
  ${options.csrf}
  <ol class="setup-list">
    <li>Create a token at <a class="text-link" href="https://vercel.com/account/settings/tokens" target="_blank" rel="noopener">vercel.com/account/settings/tokens</a>. Scope it to the team your apps should live in.</li>
    <li>Paste it here. Power checks it with Vercel before saving anything.</li>
  </ol>
  <label for="vercel-token">Vercel access token</label>
  <input id="vercel-token" name="token" type="password" required spellcheck="false" autocomplete="off" placeholder="Paste the token">
  <label for="vercel-team" class="setup-gap">Team ID or slug <span class="dim">(optional; leave empty for your personal account)</span></label>
  <input id="vercel-team" name="team" type="text" spellcheck="false" autocomplete="off" placeholder="team_… or my-team" value="${esc(options.team ?? setup.vercel_team ?? '')}">
  ${options.error && !options.oauth ? `<p class="error setup-gap" role="alert">${esc(options.error)}</p>` : ''}
  <div class="setup-actions">
    <button class="btn btn-primary" type="submit">${connected ? 'Replace token' : 'Connect Vercel'}</button>
  </div>
</form>`;

  const oauthBlock = `<p>Vercel asks you to approve Power for your personal account or a team, then sends you straight back here. Nothing to copy.</p>
  <div class="actions"><a class="btn btn-primary" href="/start/vercel/authorize">${connected ? 'Reconnect with Vercel' : 'Connect with Vercel'}</a></div>`;
  const operatorHint =
    !options.oauth && LOOPBACK.test(ctx.baseUrl)
      ? `<p class="note">One-click connection needs a Vercel integration for this server: set <span class="mono">POWER_VERCEL_CLIENT_ID</span>, <span class="mono">POWER_VERCEL_CLIENT_SECRET</span> and <span class="mono">POWER_VERCEL_INTEGRATION_SLUG</span>.</p>`
      : '';
  const connectUi = options.oauth
    ? `${connected ? '' : oauthBlock}<details class="setup-message"><summary>${connected ? 'Connect a different account' : 'Use an access token instead'}</summary>${connected ? oauthBlock : ''}${form}</details>`
    : connected
      ? `<details class="setup-message"><summary>Use a different token</summary>${form}</details>`
      : `${form}${operatorHint}`;
  const body = `<div class="setup-grid">
<section class="setup-card">
  <div class="setup-step-head"><span class="setup-n" aria-hidden="true">${connected ? '✓' : 'V'}</span><div><h2>${connected ? 'Vercel is connected' : 'Connect your Vercel account'}</h2></div></div>
  ${status}
  ${options.error && options.oauth ? `<p class="error" role="alert">${esc(options.error)}</p>` : ''}${connectUi}
  ${local}
</section>
<aside class="setup-card setup-aside">
  <h2>Why your own account</h2>
  <p class="note">Apps publish to your Vercel account, so you own the project, the domain and the bill. Power never hosts them for you.</p>
  <h2 class="setup-gap">Where the token goes</h2>
  <p class="note">It is checked with Vercel, encrypted and stored against this account only. Your assistant never sees it, not even in a tool response; it only learns that hosting is connected.</p>
</aside>
</div>
<div class="setup-actions">
  ${
    connected
      ? '<a class="btn btn-primary" href="/">Back to Projects</a>'
      : '<a class="btn" href="/">Not now</a>'
  }
  ${connected ? '' : '<span class="note">Previews work without it; Power asks again the first time you publish.</span>'}
</div>`;

  // Its own page now, not a wizard step: it is reached from setup's Vercel
  // step (in a new tab), from a publish that needs it, and from Connect.
  const done = options.justConnected
    ? `<section class="setup-card setup-success" role="status"><h2>Vercel is connected</h2><p class="note">If you came here from “New app”, go back to that tab: setup carries on by itself. Every project now publishes to ${esc(setup.vercel_account ?? 'this account')}.</p><div class="actions setup-gap"><a class="btn btn-primary" href="/">Back to Projects</a></div></section>`
    : '';
  return shell(
    ctx,
    'Connect Vercel',
    `<header class="hero">
  <p class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span>Hosting</p>
  <h1>Connect Vercel</h1>
  <p class="lede">Where your apps go live. Connect once and every project publishes to your own account.</p>
</header>
${done}${body}`,
    'connect',
  );
}

// -------------------------------------------------------------------- done

export function setupDonePage(ctx: PageContext, platform: Platform | undefined, setup: SetupState, csrf: string, start = ''): string {
  const message = platform ? handoffMessage(platform, ctx.baseUrl) : '';
  const launch = platform ? launchLink(platform, message) : null;
  const row = (done: boolean, title: string, detail: string, href: string) =>
    `<li><span class="step-n">${done ? '✓' : '·'}</span><div><strong>${esc(title)}</strong><p>${detail} <a href="${href}">Change</a></p></div></li>`;

  return frame(
    ctx,
    'Ready',
    'done',
    setup,
    'Setup complete',
    'You’re ready to build',
    `Open ${esc(platform ? inProse(platform) : 'your assistant')} and describe the app you want. Power writes a plan first and brings it back here for you to approve.`,
    `${start}<div class="start">
  <div class="start-copy">
    <p class="eyebrow">Or</p>
    <h2>Start from your assistant</h2>
    <p>Open ${esc(platform?.name ?? 'your assistant')} and describe the app there. The project appears in Projects as soon as it exists.</p>
    <div class="start-actions">
      ${launch ? `<a class="btn" href="${esc(launch)}">Open ${esc(platform!.name)}</a>` : ''}
      <a class="btn" href="/">Go to Projects</a>
    </div>
  </div>
  <ol class="steps">
    ${row(Boolean(platform), platform?.name ?? 'No assistant picked', 'Your assistant.', '/start')}
    ${row(skillTaken(setup), 'Power skill', skillTaken(setup) ? 'Downloaded.' : 'Not downloaded yet.', '/start/skill')}
    ${row(
      Boolean(setup.vercel_connected_at),
      'Vercel',
      setup.vercel_connected_at
        ? `Connected as ${esc(setup.vercel_account ?? 'your account')}.`
        : 'Skipped. Power asks again the first time you publish.',
      '/start/vercel',
    )}
  </ol>
</div>`,
    csrf,
  );
}

// ------------------------------------------------------------ project hand-off

export interface ComposerOptions {
  csrf: string;
  platform?: Platform;
  /** The account's Power Up setting, as the composer's starting value. */
  powerUp: boolean;
}

/**
 * "What do you want to build?" Power creates the project here, then opens the
 * assistant with it, so the first message the assistant sees already names
 * the project and the request.
 */
export function composer(options: ComposerOptions): string {
  const { platform } = options;
  if (!platform) {
    return `<section class="composer composer-empty"><h2>Start something new</h2><p class="note">Pick your assistant first, and Power will open it with your project ready. <a class="text-link" href="/start">Set up your assistant</a></p></section>`;
  }
  return `<section class="composer" aria-labelledby="composer-title">
  <form method="post" action="/projects/new">
    ${options.csrf}
    <h2 id="composer-title">Start something new</h2>
    <label class="sr-only" for="idea">What do you want to build?</label>
    <textarea id="idea" name="idea" rows="3" required minlength="4" maxlength="1500" placeholder="A booking page for my studio, with Stripe checkout and a Postgres database"></textarea>
    <div class="composer-row">
      <label class="composer-check"><input type="checkbox" name="power_up" value="on"${options.powerUp ? ' checked' : ''}><span><strong>Power Up</strong> research, a plan you approve, and verification</span></label>
      <button class="btn btn-primary" type="submit">Start in ${esc(platform.name)}</button>
    </div>
  </form>
</section>`;
}

export interface HandoffPageOptions {
  csrf: string;
  project: { id: string; name: string };
  platform: Platform;
  message: string;
  launch: string | null;
  terminal: string | null;
  /** The message also connects the assistant, because it is not connected yet. */
  installs: boolean;
  autoLaunch: boolean;
  pickedUp: boolean;
  mode: 'standard' | 'power_up';
}

export function handoffPage(ctx: PageContext, o: HandoffPageOptions): string {
  const who = inProse(o.platform);
  const state = (done: boolean, current: boolean) => (done ? 'done' : current ? 'current' : 'todo');
  const body = `<section class="setup-card setup-auto" data-handoff data-project="${esc(o.project.id)}" data-launch="${o.launch ? esc(o.launch) : ''}" data-auto="${o.autoLaunch && o.launch && !o.pickedUp ? '1' : ''}" data-name="${esc(o.platform.name)}">
  <div class="setup-step-head"><span class="setup-n" aria-hidden="true">↗</span><div><h2>${o.launch ? `Power opens ${esc(who)} with your project` : `Hand your project to ${esc(who)}`}</h2><p class="note">${
    o.launch
      ? `The message is typed in for you, with the project, your request and the mode. ${esc(o.platform.name)} sends nothing until you press Enter.`
      : 'Paste the message into your assistant to start.'
  }${o.installs ? ` It also connects ${esc(o.platform.name)} to this account first, since it is not connected yet.` : ''}</p></div></div>
  <ol class="setup-checks">
    <li data-check="open" data-state="${state(o.pickedUp, !o.pickedUp)}">
      <span class="check-mark" aria-hidden="true"></span>
      <div><strong>${o.launch ? `Open ${esc(o.platform.name)}` : 'Send the message'}</strong><span class="check-sub">${o.launch ? 'Your browser asks to open it. Choose Open.' : 'Copy it below.'}</span></div>
      ${o.launch ? `<a class="btn btn-sm${o.pickedUp ? '' : ' btn-primary'}" href="${esc(o.launch)}" data-launch-btn>${o.pickedUp ? 'Open again' : `Open ${esc(o.platform.name)}`}</a>` : `<button class="btn btn-sm btn-primary" type="button" data-copy="${esc(o.message)}">Copy the message</button>`}
    </li>
    <li data-check="picked" data-state="${state(o.pickedUp, false)}">
      <span class="check-mark" aria-hidden="true"></span>
      <div><strong>${esc(o.platform.name)} picks up the project</strong><span class="check-sub">${o.pickedUp ? 'It is working on it.' : `Press Enter in ${esc(o.platform.name)}. Its first call on this project ticks this off.`}</span></div>
    </li>
  </ol>
  <div class="setup-recover">
    ${
      o.terminal
        ? `<p class="note">Prefer a terminal? This starts ${esc(o.platform.name)} with the message already sent:</p>
    <div class="copyline code-line"><code>${esc(o.terminal.length > 120 ? `${o.terminal.slice(0, 117)}…'` : o.terminal)}</code><button class="btn" type="button" data-copy="${esc(o.terminal)}">Copy</button></div>`
        : ''
    }
    <div class="actions setup-gap">
      ${o.launch ? `<button class="btn btn-sm" type="button" data-copy="${esc(o.message)}">Copy the message</button>` : ''}
      <a class="text-link" href="/projects/${esc(o.project.id)}">Go to the project</a>
      ${o.platform.installUrl ? `<a class="text-link" href="${esc(o.platform.installUrl)}" target="_blank" rel="noopener">Don’t have ${esc(o.platform.name)} yet?</a>` : ''}
    </div>
  </div>
  <details class="setup-message"><summary>See the message</summary><pre>${esc(o.message)}</pre></details>
  <p class="setup-live-note" data-live-note role="status" aria-live="polite"></p>
</section>`;

  return shell(
    ctx,
    o.project.name,
    `<header class="hero setup-hero">
  <p class="eyebrow"><a href="/">Projects</a> · ${esc(o.project.name)}</p>
  <div class="hero-row"><div>
    <h1>Over to ${esc(who)}</h1>
    <p class="lede">${esc(o.project.name)} is ready in Power${o.mode === 'power_up' ? ', with Power Up on' : ''}. Power hands it to ${esc(who)} with everything it needs to start.</p>
  </div>
  <span class="mode-badge" data-on="${o.mode === 'power_up'}">${o.mode === 'power_up' ? 'Power Up' : 'Standard'}</span></div>
</header>
${body}
${HANDOFF_SCRIPT}`,
    'projects',
  );
}

/**
 * The project hand-off, the same way setup does it: open the tool a moment
 * after the page settles, read the browser losing focus as the cue it opened,
 * offer recovery if not, and poll for the tool's first call on this project.
 */
const HANDOFF_SCRIPT = `<script>
(() => {
  const root = document.querySelector('[data-handoff]');
  if (!root) return;
  const name = root.dataset.name, launch = root.dataset.launch, id = root.dataset.project;
  const note = root.querySelector('[data-live-note]');
  const set = (key, state, sub) => {
    const li = root.querySelector('[data-check="' + key + '"]');
    if (!li) return;
    li.dataset.state = state;
    if (sub) li.querySelector('.check-sub').textContent = sub;
  };
  let attempted = false, hadFocus = document.hasFocus(), handed = false, finished = false;
  const handOff = () => {
    if (handed) return;
    handed = true;
    set('open', 'done', name + ' is open with the message typed in.');
    set('picked', 'current', 'Press Enter in ' + name + '. Its first call on this project ticks this off.');
  };
  const open = () => {
    if (!launch) return;
    attempted = true; hadFocus = document.hasFocus(); handed = false;
    try { window.location.href = launch; } catch (e) {}
    setTimeout(() => { if (!handed && note) note.textContent = name + ' did not open? Try again, copy the message, or use the terminal command.'; }, 2500);
  };
  root.querySelector('[data-launch-btn]')?.addEventListener('click', (e) => { e.preventDefault(); open(); });
  setInterval(() => { const f = document.hasFocus(); if (attempted && hadFocus && !f) handOff(); hadFocus = f; }, 200);
  document.addEventListener('visibilitychange', () => { if (attempted && document.hidden) handOff(); });
  if (root.dataset.auto === '1') setTimeout(open, 1000);
  const tick = async () => {
    try {
      const r = await fetch('/projects/' + id + '/open/status', { headers: { accept: 'application/json' }, credentials: 'same-origin' });
      if (r.ok) {
        const s = await r.json();
        if (s.picked_up && !finished) {
          finished = true;
          set('open', 'done', name + ' has the project.');
          set('picked', 'done', 'Picked up. Now at: ' + s.phase + '.');
          if (note) note.textContent = 'Taking you to the project…';
          setTimeout(() => { window.location.href = '/projects/' + id; }, 1400);
          return;
        }
      }
    } catch (e) {}
    setTimeout(tick, 2000);
  };
  setTimeout(tick, 1200);
})();
</script>`;
