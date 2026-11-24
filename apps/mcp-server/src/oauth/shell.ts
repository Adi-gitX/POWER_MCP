/**
 * The chrome shared by every signed-out screen.
 *
 * A split layout: the brand panel on the left carries the three steps from
 * account to first app, and the form sits on the right. Sign-in, the code,
 * an expired link and an OAuth consent all use it, with the step that matches
 * where the person is highlighted, so they read as one journey.
 *
 * Everything has to render before any asset has loaded over the network, so
 * the stylesheet and the mark are inline, and the two fonts are served by the
 * same server at the same paths the app uses.
 */
import { MARK } from '../brand.js';

export const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Where "Back to site" goes. Set once by the OAuth app from its sign-out destination. */
let siteUrl = '/';
export function configureShell(options: { siteUrl?: string }): void {
  if (options.siteUrl) siteUrl = options.siteUrl;
}

/** The site's legal pages, next to the landing page. */
export const legalUrl = (page: 'terms' | 'privacy'): string => (siteUrl === '/' ? `/${page}/` : `${siteUrl.replace(/\/+$/, '')}/${page}/`);

const STEPS = [
  { title: 'Create your account', copy: 'One emailed code. No password to remember.' },
  { title: 'Connect your AI', copy: 'Add Power to Claude, Cursor, Codex or any MCP client.' },
  { title: 'Ship your first app', copy: 'Describe it once, approve the plan, then publish.' },
] as const;

export interface ShellOptions {
  /** Which of the three steps the person is on. */
  step?: 0 | 1 | 2;
}

export function shellPage(title: string, body: string, options: ShellOptions = {}): string {
  const step = options.step ?? 0;
  const steps = STEPS.map(
    (s, i) => `<li${i === step ? ' class="is-active" aria-current="step"' : i < step ? ' class="is-done"' : ''}>
        <span class="lg-step-n" aria-hidden="true">${i < step ? '✓' : i + 1}</span>
        <div><strong>${s.title}</strong><em>${s.copy}</em></div>
      </li>`,
  ).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#08080a">
<meta name="robots" content="noindex">
<title>${esc(title)} · Power</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<style>
  @font-face{font-family:'Inter';font-style:normal;font-weight:100 700;font-display:swap;src:url('/assets/fonts/inter-latin.woff2') format('woff2')}
  @font-face{font-family:'Fragment Mono';font-style:normal;font-weight:400;font-display:swap;src:url('/assets/fonts/fragment-mono-latin.woff2') format('woff2')}
  :root{color-scheme:dark;--ink:#f4f2ee;--ink-2:rgba(255,255,255,.62);--ink-3:rgba(255,255,255,.44);
        --line:rgba(255,255,255,.12);--line-2:rgba(255,255,255,.2);--field:#131316;--focus:#c4a8ff;
        --pass:#8fe6a8;--warn:#e9bd79;
        --sans:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        --serif:'Instrument Serif','Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;
        --mono:'Fragment Mono',ui-monospace,SFMono-Regular,Menlo,monospace}
  *,*::before,*::after{box-sizing:border-box}
  [hidden]{display:none!important}
  html,body{height:100%}
  body{margin:0;background:#08080a;color:var(--ink);font:400 14px/1.6 var(--sans);letter-spacing:-.006em;
       -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
  a{color:inherit}
  :focus-visible{outline:2px solid var(--focus);outline-offset:3px;border-radius:6px}
  h1,h2,p{margin:0}
  .lg{min-height:100svh;display:grid;grid-template-columns:1.08fr .92fr}

  /* ---- art panel */
  .lg-art{position:relative;margin:10px;border-radius:24px;overflow:hidden;isolation:isolate;
    background:radial-gradient(90% 70% at 50% 6%,#b48cf5 0%,#7d4fd0 26%,#4a2a86 46%,#241343 68%,#0d0a18 88%),#0b0912}
  .lg-glow{position:absolute;left:50%;top:-18%;width:120%;aspect-ratio:1;transform:translateX(-50%);z-index:-1;filter:blur(10px);
    background:radial-gradient(circle at 50% 40%,rgba(226,206,255,.55),rgba(160,112,240,.22) 38%,transparent 64%)}
  .lg-grain{position:absolute;inset:0;opacity:.32;mix-blend-mode:overlay;pointer-events:none;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.6'/%3E%3C/svg%3E")}
  .lg-art-inner{position:relative;height:100%;display:flex;flex-direction:column;padding:30px 34px 26px}
  .lg-brand{display:inline-flex;align-items:center;gap:9px;font-size:16px;font-weight:500;letter-spacing:-.02em;color:#fff;text-decoration:none;align-self:flex-start}
  .lg-brand svg{width:20px;height:21px;display:block;color:#fff}
  .lg-art-copy{margin:auto 0;padding:48px 0;max-width:420px;align-self:center;text-align:center}
  .lg-art-copy h1{font-family:var(--serif);font-weight:400;font-size:clamp(40px,4vw,56px);line-height:1;letter-spacing:-.02em;color:#fff}
  .lg-art-copy>p{margin-top:16px;font-size:14.5px;line-height:1.6;color:rgba(255,255,255,.74)}
  .lg-steps{margin:34px 0 0;padding:0;list-style:none;display:grid;gap:8px;text-align:left}
  .lg-steps li{display:grid;grid-template-columns:26px 1fr;gap:12px;align-items:center;padding:14px 16px;border-radius:12px;
    background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.06);backdrop-filter:blur(6px);transition:background .3s ease}
  .lg-steps li.is-active{background:#fdfcf9;color:#121216;border-color:transparent;box-shadow:0 12px 30px -12px rgba(0,0,0,.5)}
  .lg-step-n{width:22px;height:22px;display:grid;place-items:center;border-radius:50%;background:rgba(255,255,255,.18);font-size:11px}
  .lg-steps li.is-active .lg-step-n{background:#0f0f13;color:#fff}
  .lg-steps li.is-done .lg-step-n{background:rgba(143,230,168,.22);color:var(--pass)}
  .lg-steps strong{display:block;font-size:13.5px;font-weight:500;color:inherit}
  .lg-steps em{display:block;font-style:normal;font-size:12px;margin-top:2px;color:rgba(255,255,255,.56)}
  .lg-steps li.is-active em{color:#6b6a72}
  .lg-art-foot{display:flex;align-items:center;gap:8px;font-size:11.5px;color:rgba(255,255,255,.62)}
  .lg-dot{width:6px;height:6px;border-radius:50%;background:var(--pass);box-shadow:0 0 0 3px rgba(143,230,168,.18);flex:none}

  /* ---- form panel */
  .lg-main{position:relative;display:flex;align-items:center;justify-content:center;padding:64px 40px}
  .lg-back{position:absolute;top:26px;right:30px;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;
    color:rgba(255,255,255,.5);text-decoration:none;transition:color .2s ease}
  .lg-back:hover{color:#fff}
  .lg-back svg{width:14px;height:14px}
  .lg-form{width:min(388px,100%)}
  .eyebrow{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 11px;border-radius:999px;
    border:1px solid var(--line);background:rgba(255,255,255,.04);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2)}
  .eyebrow::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--focus)}
  .lg-form h1{margin-top:20px;font-size:28px;line-height:1.15;font-weight:500;letter-spacing:-.025em;color:#fff}
  .lg-form h1+p,.lg-form p{margin-top:10px;font-size:13.5px;line-height:1.6;color:var(--ink-2)}
  strong{color:#fff;font-weight:500}
  form{margin:0}
  label{display:block;margin:26px 0 8px;font-size:12px;color:var(--ink-2);letter-spacing:-.005em}
  input[type=email],input[type=text]:not(.otp-react input),input[type=password]{display:block;width:100%;height:46px;padding:0 14px;border-radius:10px;
    border:1px solid var(--line);background:var(--field);color:#fff;font:inherit;font-size:14px;outline:0;
    transition:border-color .2s ease,background .2s ease,box-shadow .2s ease}
  input::placeholder{color:rgba(255,255,255,.4)}
  input:not(.otp-react input):focus{border-color:rgba(255,255,255,.38);background:#17171b}
  .otp-react{margin-top:8px}
  button{font:inherit;font-size:14px;height:46px;padding:0 20px;border-radius:10px;cursor:pointer;border:1px solid transparent;
    display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:background .2s ease,border-color .2s ease,transform .2s ease,opacity .2s ease}
  button svg{width:15px;height:15px}
  .primary{width:100%;margin-top:14px;background:#fdfcf9;color:#0c0c0f;font-weight:500}
  .primary:hover{background:#fff;transform:translateY(-1px)}
  .secondary{width:100%;background:rgba(255,255,255,.04);color:#fff;border-color:var(--line)}
  .secondary:hover{background:rgba(255,255,255,.08);border-color:var(--line-2)}
  button:disabled,input:disabled{opacity:.42;cursor:not-allowed;transform:none}
  .fine{margin-top:12px!important;font-size:11.5px!important;color:var(--ink-3)!important}
  .warn,.ok{margin-top:18px!important;padding:11px 14px;border-radius:10px;font-size:12.5px!important;line-height:1.5}
  .warn{background:rgba(233,189,121,.08);border:1px solid rgba(233,189,121,.28);color:var(--warn)!important}
  .ok{background:rgba(143,230,168,.07);border:1px solid rgba(143,230,168,.26);color:var(--pass)!important}
  .again{margin-top:26px!important;padding-top:20px;border-top:1px solid var(--line);font-size:12.5px!important}
  .again a,.lg-terms a,.who a{color:var(--ink-2);text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--line-2)}
  .again a:hover,.lg-terms a:hover,.who a:hover{color:#fff;text-decoration-color:#fff}
  .lg-terms{margin-top:22px!important;font-size:11px!important;line-height:1.6;color:var(--ink-3)!important;text-align:center}
  .dev{margin-top:18px;padding:12px 14px;border:1px dashed var(--line-2);border-radius:10px;font-size:12px;color:var(--ink-3);line-height:1.6}
  .dev a{display:inline-block;margin-top:6px;color:#fff;font-weight:500}
  .mono{font-family:var(--mono);letter-spacing:.1em}

  /* ---- the six-digit code */
  .otp{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-top:8px}
  .otp input{height:56px;padding:0;text-align:center;font-family:var(--mono);font-size:22px;letter-spacing:0;caret-color:var(--focus)}
  .otp input:nth-child(3){margin-right:10px}
  .otp-field{letter-spacing:.4em;text-align:center;font-family:var(--mono);font-size:20px}
  #code-form{position:relative}
  .js input.otp-field{position:absolute!important;left:0;top:0;width:1px!important;height:1px!important;padding:0!important;border:0!important;opacity:0;pointer-events:none;clip-path:inset(50%)}
  .otp.is-error input{border-color:rgba(233,189,121,.5)}
  .resend{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:22px}
  .resend .fine{margin:0!important;flex:1;min-width:0}
  .resend button{flex:none;width:auto;height:34px;padding:0 14px;font-size:12.5px}

  /* ---- consent */
  .host{color:#fff;font-weight:500}
  ul{margin:14px 0 6px;padding:0;color:var(--ink-2);font-size:13px;list-style:none}
  li{position:relative;margin:8px 0;padding-left:18px;line-height:1.55}
  .lg-form li::before{content:"";position:absolute;left:2px;top:.6em;width:5px;height:5px;border-radius:50%;background:var(--focus)}
  .row{display:flex;gap:10px;margin-top:24px}
  .row form{flex:1}
  .row button{width:100%;margin-top:0}
  .who{margin-top:24px!important;padding-top:18px;border-top:1px solid var(--line);font-size:11.5px!important;color:var(--ink-3)!important}

  @media (prefers-reduced-motion:reduce){*,*::before,*::after{transition-duration:.01ms!important}}
  @media (max-width:900px){
    .lg{grid-template-columns:1fr}
    .lg-art{margin:8px;min-height:0}
    .lg-art-inner{padding:22px 22px 20px}
    .lg-art-copy{margin:0;padding:26px 0 6px;align-self:flex-start;text-align:left}
    .lg-art-copy h1{font-size:34px}
    .lg-art-copy>p{font-size:13px}
    .lg-steps{display:none}
    .lg-art-foot{margin-top:18px}
    .lg-main{padding:36px 22px 56px;align-items:flex-start}
    .lg-back{display:none}
    .lg-form{width:100%;max-width:440px}
  }
  @media (max-width:380px){.otp{gap:6px}.otp input{height:50px;font-size:19px}.otp input:nth-child(3){margin-right:4px}.resend{flex-direction:column;align-items:stretch}.resend button{width:100%}.row{flex-direction:column}}
</style>
<script>document.documentElement.classList.add('js')</script>
</head>
<body>
<div class="lg">
  <aside class="lg-art" aria-label="Getting started with Power">
    <div class="lg-glow" aria-hidden="true"></div>
    <div class="lg-grain" aria-hidden="true"></div>
    <div class="lg-art-inner">
      <a class="lg-brand" href="${esc(siteUrl)}" aria-label="Power home">${MARK}<span>Power</span></a>
      <div class="lg-art-copy">
        <h1>Get started with Power</h1>
        <p>Describe the app. The agent plans it, builds it in the background and verifies every step.</p>
        <ol class="lg-steps">${steps}</ol>
      </div>
      <p class="lg-art-foot"><span class="lg-dot" aria-hidden="true"></span>Signed in with a one-time code. Revoke any session or tool from the app.</p>
    </div>
  </aside>
  <main class="lg-main">
    <a class="lg-back" href="${esc(siteUrl)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Back to site</a>
    <div class="lg-form">${body}</div>
  </main>
</div>
</body></html>`;
}
