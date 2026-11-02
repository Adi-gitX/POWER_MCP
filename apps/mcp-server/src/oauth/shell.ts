/**
 * The chrome shared by every signed-out screen.
 *
 * Sign-in, "check your inbox", an expired link and an OAuth consent all have to
 * feel like the same product as the dashboard behind them, and all of them have
 * to render before any asset has loaded over the network. So the stylesheet is
 * inline, the mark is inline, and the two fonts are served by the same server
 * at the same paths the app uses.
 */
import { MARK } from '../brand.js';

export const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function shellPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#000000">
<meta name="robots" content="noindex">
<title>${esc(title)} · Power</title>
<style>
  @font-face{font-family:'Inter';font-style:normal;font-weight:100 700;font-display:swap;src:url('/assets/fonts/inter-latin.woff2') format('woff2')}
  @font-face{font-family:'Fragment Mono';font-style:normal;font-weight:400;font-display:swap;src:url('/assets/fonts/fragment-mono-latin.woff2') format('woff2')}
  :root{color-scheme:dark;--ink:#fff3f0;--ink-2:rgba(255,243,240,.66);--ink-3:rgba(255,243,240,.42);
        --line:rgba(255,243,240,.09);--line-2:rgba(255,243,240,.17);
        --sans:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
        --mono:'Fragment Mono',ui-monospace,SFMono-Regular,Menlo,monospace}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:var(--ink);
       font:400 14.5px/1.6 var(--sans);letter-spacing:-.01em;padding:40px 22px;position:relative;
       -webkit-font-smoothing:antialiased;overflow-x:hidden}
  body::before{content:"";position:fixed;inset:0;pointer-events:none;
    background:radial-gradient(820px 460px at 50% -10%,rgba(255,243,240,.12),transparent 70%),
               radial-gradient(620px 420px at 88% 98%,rgba(158,213,166,.05),transparent 72%)}
  body::after{content:"";position:fixed;inset:0;pointer-events:none;opacity:.028;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")}
  main{position:relative;z-index:1;width:min(28rem,100%)}
  .brand{display:inline-flex;align-items:center;gap:9px;font-size:15px;font-weight:500;letter-spacing:-.025em;
         margin:0 0 16px 2px;color:var(--ink)}
  .brand svg{width:19px;height:20px;display:block;color:var(--ink)}
  .card{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:24px;
        background:linear-gradient(180deg,#111,#080808);padding:36px 34px 32px}
  .card::before{content:"";position:absolute;top:0;left:14%;right:14%;height:1px;
                background:linear-gradient(90deg,transparent,rgba(255,243,240,.4),transparent)}
  .eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;
           color:var(--ink-3);margin:0 0 16px}
  h1{margin:0 0 12px;font-size:clamp(26px,4.4vw,32px);line-height:1.06;letter-spacing:-.045em;font-weight:500}
  p{margin:0 0 14px;color:var(--ink-2);font-size:13.5px;line-height:1.65}
  strong{color:var(--ink);font-weight:500}
  label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
        color:var(--ink-3);margin:24px 0 8px}
  input[type=email],input[type=text],input[type=password]{width:100%;height:44px;padding:0 15px;font:inherit;
    font-size:14px;color:var(--ink);background:rgba(255,243,240,.03);border:1px solid var(--line-2);
    border-radius:12px;outline:none;transition:border-color .2s ease,box-shadow .2s ease}
  input::placeholder{color:rgba(255,243,240,.27)}
  input:focus{border-color:rgba(255,243,240,.4);box-shadow:0 0 0 4px rgba(255,243,240,.05)}
  button{font:inherit;font-size:13.5px;height:44px;padding:0 22px;border-radius:999px;cursor:pointer;
         border:1px solid transparent;transition:background .22s ease,border-color .22s ease,transform .22s ease}
  button:active{transform:translateY(1px)}
  .primary{background:var(--ink);color:#0b0b0b;width:100%;margin-top:20px;font-weight:500}
  .primary:hover{background:#fff}
  .secondary{background:rgba(255,243,240,.04);color:var(--ink);border-color:var(--line-2);width:100%}
  .secondary:hover{background:rgba(255,243,240,.09);border-color:rgba(255,243,240,.28)}
  .row{display:flex;gap:10px;margin-top:24px}
  .row form{flex:1}
  .row button{width:100%}
  .host{color:var(--ink);font-weight:500}
  ul{margin:8px 0 18px;padding:0;color:var(--ink-2);font-size:13px;list-style:none}
  li{position:relative;margin:7px 0;padding-left:18px;line-height:1.55}
  li::before{content:"";position:absolute;left:2px;top:.56em;width:5px;height:5px;border-radius:50%;
             background:var(--ink-3)}
  .who{margin:24px 0 0;padding-top:18px;border-top:1px solid var(--line);font-size:11.5px;color:var(--ink-3)}
  a{color:var(--ink-2);text-underline-offset:3px;text-decoration-color:var(--line-2)}
  a:hover{color:var(--ink);text-decoration-color:var(--ink)}
  .warn{background:rgba(233,189,121,.07);border:1px solid rgba(233,189,121,.26);color:#e9bd79;
        padding:11px 14px;border-radius:12px;font-size:12.5px}
  .fine{font-size:11.5px;color:var(--ink-3);margin:18px 0 0}
  .dev{margin-top:20px;padding:14px 16px;border:1px dashed var(--line-2);border-radius:14px;
       font-size:12px;color:var(--ink-3);line-height:1.6}
  .dev a{display:inline-block;margin-top:7px;color:var(--ink);font-weight:500}
  .again{margin:20px 0 0;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px}
  .legal{margin:20px 0 0;text-align:center;font-family:var(--mono);font-size:10px;letter-spacing:.08em;
         text-transform:uppercase;color:rgba(255,243,240,.3)}
  @media (max-width:420px){body{padding:26px 16px}.card{padding:28px 22px 26px;border-radius:20px}.row{flex-direction:column}}
</style></head>
<body><main>
  <a class="brand" href="/">${MARK}<span>Power</span></a>
  <div class="card">${body}</div>
  <p class="legal">One connection for your AI's tools, skills and context</p>
</main></body></html>`;
}
