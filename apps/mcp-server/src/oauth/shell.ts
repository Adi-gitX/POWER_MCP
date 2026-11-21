/**
 * The chrome shared by every signed-out screen.
 *
 * Sign-in, "check your inbox", an expired link and an OAuth consent all have to
 * feel like the same product as the dashboard behind them, and all of them have
 * to render before any asset has loaded over the network. So the stylesheet is
 * inline, the mark is inline, and the fonts are served by the same server at the
 * same paths the app uses.
 */
import { MARK } from '../brand.js';

export const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function shellPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#f4f1ea">
<meta name="robots" content="noindex">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<title>${esc(title)} · Power</title>
<style>
  @font-face{font-family:'Instrument Serif';font-style:normal;font-weight:400;font-display:swap;src:url('/assets/fonts/instrument-serif.woff2') format('woff2')}
  @font-face{font-family:'Inter';font-style:normal;font-weight:100 700;font-display:swap;src:url('/assets/fonts/inter-latin.woff2') format('woff2')}
  @font-face{font-family:'Fragment Mono';font-style:normal;font-weight:400;font-display:swap;src:url('/assets/fonts/fragment-mono-latin.woff2') format('woff2')}
  :root{color-scheme:light;--paper:#f4f1ea;--ink:#0b0c0e;--ink-2:rgba(11,12,14,.64);--ink-3:rgba(11,12,14,.42);
        --line:rgba(11,12,14,.12);--line-2:rgba(11,12,14,.2);--blue:#2f5bff;
        --sans:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
        --serif:'Instrument Serif','Iowan Old Style','Times New Roman',serif;
        --mono:'Fragment Mono',ui-monospace,SFMono-Regular,Menlo,monospace}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);
       font:400 15px/1.6 var(--sans);letter-spacing:-.011em;padding:40px 22px;position:relative;
       -webkit-font-smoothing:antialiased;overflow-x:hidden}
  body::before{content:"";position:fixed;inset:0;pointer-events:none;
    background:radial-gradient(820px 460px at 50% -10%,rgba(47,91,255,.08),transparent 70%),
               radial-gradient(620px 420px at 88% 98%,rgba(11,12,14,.04),transparent 72%)}
  main{position:relative;z-index:1;width:min(28rem,100%)}
  .brand{display:inline-flex;align-items:center;gap:9px;font-size:15px;font-weight:500;letter-spacing:-.025em;
         margin:0 0 16px 2px;color:var(--ink)}
  .brand svg{width:19px;height:20px;display:block;color:var(--ink)}
  .card{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:24px;
        background:#fffdf9;box-shadow:0 30px 70px -40px rgba(11,12,14,.28);padding:36px 34px 32px}
  .eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;
           color:var(--ink-3);margin:0 0 16px}
  h1{margin:0 0 12px;font-family:var(--serif);font-size:clamp(30px,4.6vw,38px);line-height:1.04;
     letter-spacing:-.02em;font-weight:400}
  p{margin:0 0 14px;color:var(--ink-2);font-size:13.5px;line-height:1.65}
  strong{color:var(--ink);font-weight:500}
  label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
        color:var(--ink-3);margin:24px 0 8px}
  input[type=email],input[type=text],input[type=password]{width:100%;height:44px;padding:0 15px;font:inherit;
    font-size:14px;color:var(--ink);background:#fff;border:1px solid var(--line-2);
    border-radius:12px;outline:none;transition:border-color .2s ease,box-shadow .2s ease}
  input::placeholder{color:rgba(11,12,14,.32)}
  input:focus{border-color:var(--blue);box-shadow:0 0 0 4px rgba(47,91,255,.12)}
  button{font:inherit;font-size:13.5px;height:44px;padding:0 22px;border-radius:999px;cursor:pointer;
         border:1px solid transparent;transition:background .22s ease,border-color .22s ease,transform .22s ease}
  button:active{transform:translateY(1px)}
  .primary{background:var(--blue);color:#fff;width:100%;margin-top:20px;font-weight:500}
  .primary:hover{background:#1b46e0}
  .secondary{background:#fff;color:var(--ink);border-color:var(--line-2);width:100%}
  .secondary:hover{background:#faf7f1;border-color:rgba(11,12,14,.32)}
  .row{display:flex;gap:10px;margin-top:24px}
  .row form{flex:1}
  .row button{width:100%}
  .host{color:var(--ink);font-weight:500}
  ul{margin:8px 0 18px;padding:0;color:var(--ink-2);font-size:13px;list-style:none}
  li{position:relative;margin:7px 0;padding-left:18px;line-height:1.55}
  li::before{content:"";position:absolute;left:2px;top:.56em;width:5px;height:5px;border-radius:50%;
             background:var(--blue)}
  .who{margin:24px 0 0;padding-top:18px;border-top:1px solid var(--line);font-size:11.5px;color:var(--ink-3)}
  a{color:var(--ink-2);text-underline-offset:3px;text-decoration-color:var(--line-2)}
  a:hover{color:var(--ink);text-decoration-color:var(--ink)}
  .warn{background:#fdf6e7;border:1px solid rgba(138,90,18,.28);color:#8a5a12;
        padding:11px 14px;border-radius:12px;font-size:12.5px}
  .fine{font-size:11.5px;color:var(--ink-3);margin:18px 0 0}
  .dev{margin-top:20px;padding:14px 16px;border:1px dashed var(--line-2);border-radius:14px;
       font-size:12px;color:var(--ink-3);line-height:1.6}
  .dev a{display:inline-block;margin-top:7px;color:var(--ink);font-weight:500}
  .again{margin:20px 0 0;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px}
  .legal{margin:20px 0 0;text-align:center;font-family:var(--mono);font-size:10px;letter-spacing:.08em;
         text-transform:uppercase;color:var(--ink-3)}
  @media (max-width:420px){body{padding:26px 16px}.card{padding:28px 22px 26px;border-radius:20px}.row{flex-direction:column}}
</style></head>
<body><main>
  <a class="brand" href="/">${MARK}<span>Power</span></a>
  <div class="card">${body}</div>
  <p class="legal">One connection for your AI's tools, skills and context</p>
</main></body></html>`;
}
