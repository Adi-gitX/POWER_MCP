/**
 * The app's stylesheet.
 *
 * Kept beside the page renderers rather than in a build pipeline because the
 * server is the only thing that serves it: there is no bundler on this origin,
 * and a stylesheet that needs one is a stylesheet that can fail separately from
 * the page it dresses.
 *
 * The tokens and type scale are the marketing site's. A person crosses from
 * usepower.dev to the app in one click, so the two surfaces are one product and
 * should not look like two.
 */
export const DASHBOARD_CSS = `
@font-face{font-family:'Inter';font-style:normal;font-weight:100 700;font-display:swap;src:url('/assets/fonts/inter-latin.woff2') format('woff2')}
@font-face{font-family:'Instrument Serif';font-style:normal;font-weight:400;font-display:swap;src:url('/assets/fonts/instrument-serif.woff2') format('woff2')}
@font-face{font-family:'Instrument Serif';font-style:italic;font-weight:400;font-display:swap;src:url('/assets/fonts/instrument-serif-italic.woff2') format('woff2')}
@font-face{font-family:'Fragment Mono';font-style:normal;font-weight:400;font-display:swap;src:url('/assets/fonts/fragment-mono-latin.woff2') format('woff2')}

:root{
  --bg:#f4f1ea;
  --panel:#ffffff;
  --panel-2:#faf7f1;
  --raise:#ffffff;
  --ink:#0b0c0e;
  --ink-2:rgba(11,12,14,.64);
  --ink-3:rgba(11,12,14,.6);
  --line:rgba(11,12,14,.12);
  --line-2:rgba(11,12,14,.2);
  --pass:#2c7a45;
  --warn:#8a5a12;
  --stop:#b42318;
  --blue:#2f5bff;
  --sans:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
  --serif:'Instrument Serif','Iowan Old Style','Times New Roman',serif;
  --mono:'Fragment Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --shell:1160px;
  --r-lg:24px;
  --r:18px;
  --r-sm:12px;
  --ease:cubic-bezier(.16,1,.3,1);
  color-scheme:light;
}

*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;background:#f4f1ea}
body{
  margin:0;min-height:100vh;background:var(--bg);color:var(--ink);
  font:400 15px/1.6 var(--sans);letter-spacing:-.011em;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
}
/* The landing page opens on a starfield; the app carries only its light —
   enough to lift the top of the page off pure black, not enough to compete. */
body::before{
  content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;
  background:
    radial-gradient(900px 460px at 50% -160px,rgba(47,91,255,.07),transparent 70%),
    radial-gradient(720px 520px at 94% 4%,rgba(47,91,255,.04),transparent 72%),
    radial-gradient(640px 420px at 2% 52%,rgba(11,12,14,.03),transparent 70%);
}
body::after{
  content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.028;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
}
a{color:inherit;text-decoration:none}
code,.mono{font-family:var(--mono);font-size:.92em;letter-spacing:-.01em}
.dim{color:var(--ink-3)}
.skip{position:absolute;left:-9999px}
.skip:focus{left:16px;top:12px;z-index:100;background:var(--ink);color:#fff;padding:9px 14px;border-radius:999px;font-size:12.5px;font-weight:500}
:focus-visible{outline:2px solid rgba(47,91,255,.7);outline-offset:3px;border-radius:4px}
::selection{background:rgba(47,91,255,.18);color:#0b0c0e}

/* ---------------------------------------------------------------- header */
.bar{position:sticky;top:0;z-index:40;background:rgba(244,241,234,.88);backdrop-filter:blur(18px) saturate(140%);border-bottom:1px solid var(--line)}
.bar-in{max-width:var(--shell);margin:0 auto;height:68px;padding:0 40px;display:flex;align-items:center;gap:28px}
.brand{display:inline-flex;align-items:center;gap:10px;font-size:15.5px;font-weight:500;letter-spacing:-.025em;flex:none}
.brand svg{width:19px;height:20px;display:block;color:var(--ink)}
.bar nav{display:flex;gap:2px;margin-left:8px}
.bar nav a{padding:7px 14px;border-radius:999px;color:var(--ink-3);font-size:13.5px;transition:color .2s ease,background .2s ease}
.bar nav a:hover{color:var(--ink-2);background:rgba(11,12,14,.045)}
.bar nav a[aria-current=page]{color:var(--ink);background:rgba(11,12,14,.075)}
.who{margin-left:auto;display:flex;align-items:center;gap:14px;color:var(--ink-3);font-size:12px;min-width:0}
.who .plan{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;border:1px solid var(--line-2);border-radius:999px;padding:4px 9px;color:var(--ink-2);white-space:nowrap}
.who .quota{font-size:11.5px;white-space:nowrap}
.who .account{display:inline-flex;align-items:center;gap:8px;color:var(--ink-2);min-width:0;max-width:250px}
.who .avatar{flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(180deg,#eef1ff,#e2e8ff);border:1px solid rgba(47,91,255,.24);font-size:11px;font-weight:500;color:var(--ink);text-transform:uppercase;letter-spacing:0}
.who .account-mail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.who .signout{color:var(--ink-3);white-space:nowrap;transition:color .2s ease}
.who .signout:hover{color:var(--ink)}

/* ------------------------------------------------------------------ main */
main{max-width:var(--shell);margin:0 auto;padding:0 40px 104px}
p,h1,h2,h3,h4,ul,ol,figure,dl,dd{margin:0}
ul,ol{padding:0;list-style:none}
h1{font-family:var(--serif);font-size:clamp(42px,5.2vw,64px);line-height:1;letter-spacing:-.025em;font-weight:400}
h2{font-size:17px;font-weight:500;letter-spacing:-.022em;margin:0 0 16px}
section{margin-top:52px}
section:first-of-type{margin-top:0}
main p{max-width:70ch}
.lede{margin:18px 0 0;max-width:58ch;color:var(--ink-2);font-size:15px;line-height:1.65;letter-spacing:-.015em}
.note{color:var(--ink-3);font-size:12.5px;line-height:1.6;margin:12px 0 0;max-width:64ch}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--ink-3);font-size:12px;margin:14px 0 0}
.meta .mono{color:var(--ink-2)}
.list{margin:0 0 16px;padding-left:18px;color:var(--ink-2);font-size:13px;list-style:disc}
.list li{margin:5px 0}

/* ------------------------------------------------------------------- hero */
.hero{padding:64px 0 34px;border-bottom:1px solid var(--line);margin-bottom:34px}
.eyebrow{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3);margin:0 0 18px}
.hero-row{display:flex;align-items:flex-end;justify-content:space-between;gap:36px;flex-wrap:wrap}
.hero-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:26px}
.meta-pill{display:inline-flex;align-items:center;gap:8px;height:29px;padding:0 13px;border-radius:999px;border:1px solid var(--line);background:rgba(11,12,14,.03);font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;color:var(--ink-3);white-space:nowrap}
.meta-pill b{font-weight:400;color:var(--ink-2)}
.meta-pill .pulse{width:5px;height:5px;border-radius:50%;background:var(--pass);box-shadow:0 0 0 3px rgba(158,213,166,.12)}
.stat{display:flex;align-items:baseline;gap:10px;padding:14px 18px;border:1px solid rgba(233,189,121,.24);border-radius:var(--r);background:rgba(233,189,121,.055);white-space:nowrap}
.stat-n{font-size:26px;letter-spacing:-.035em;color:var(--warn);font-weight:500;line-height:1}
.stat-l{color:rgba(233,189,121,.8);font-size:12px}

/* ---------------------------------------------------------------- buttons */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  height:40px;padding:0 22px;border-radius:999px;
  border:1px solid var(--line-2);background:rgba(11,12,14,.04);color:var(--ink);
  font:inherit;font-size:13.5px;letter-spacing:-.012em;cursor:pointer;white-space:nowrap;
  backdrop-filter:blur(8px);
  transition:background .22s ease,border-color .22s ease,color .22s ease,transform .22s var(--ease);
}
.btn:hover{background:rgba(11,12,14,.09);border-color:rgba(11,12,14,.28);transform:translateY(-1px)}
.btn:active{transform:translateY(0)}
.btn-primary{background:var(--blue);border-color:var(--blue);color:#fff;font-weight:500}
.btn-primary:hover{background:#1b46e0;border-color:#1b46e0;color:#fff}
.btn-sm{height:33px;padding:0 15px;font-size:12.5px}
.btn-danger{color:var(--stop);border-color:rgba(233,160,143,.3);background:rgba(233,160,143,.04)}
.btn-danger:hover{background:rgba(233,160,143,.09);border-color:rgba(233,160,143,.48)}
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}

/* ------------------------------------------------------------------ chips */
.chip{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line-2);border-radius:999px;padding:4px 10px;color:var(--ink-2);white-space:nowrap;line-height:1.5;background:rgba(11,12,14,.02)}
.chip::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.9}
.chip-lg{font-size:10.5px;padding:6px 12px}
.chip[data-tone=live]{color:var(--pass);border-color:rgba(158,213,166,.3);background:rgba(158,213,166,.06)}
.chip[data-tone=you]{color:var(--warn);border-color:rgba(233,189,121,.32);background:rgba(233,189,121,.06)}
.chip[data-tone=stop]{color:var(--stop);border-color:rgba(233,160,143,.3);background:rgba(233,160,143,.05)}
.chip[data-tone=work]{color:var(--ink-2)}

/* ----------------------------------------------------------- project list */
.list-tools{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 0 18px;flex-wrap:wrap}
.search{display:flex;align-items:center;gap:8px;min-width:0}
.search input[type=search]{width:290px;height:36px;background:rgba(11,12,14,.03);border:1px solid var(--line-2);border-radius:999px;color:var(--ink);font:inherit;font-size:13px;padding:0 16px;transition:border-color .2s ease,box-shadow .2s ease}
.search input[type=search]::placeholder{color:rgba(11,12,14,.3)}
.search input[type=search]:focus{border-color:rgba(11,12,14,.4);outline:none;box-shadow:0 0 0 4px rgba(11,12,14,.05)}
.search .clear{color:var(--ink-3);font-size:12px;padding:0 6px;white-space:nowrap}
.search .clear:hover{color:var(--ink)}
.filters{display:flex;gap:3px;flex-wrap:wrap}
.filters a{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;color:var(--ink-3);font-size:12.5px;border:1px solid transparent;white-space:nowrap;transition:.2s ease}
.filters a:hover{color:var(--ink-2)}
.filters a[aria-current=page]{color:var(--ink);border-color:var(--line-2);background:rgba(11,12,14,.055)}
.filters .count{font-family:var(--mono);font-size:10px;color:var(--ink-3)}
.result-note{margin:2px 0 16px;color:var(--ink-3);font-size:11px;font-family:var(--mono);letter-spacing:.03em}

.rows{display:grid;gap:8px;margin-top:2px}
.row{display:grid;grid-template-columns:40px minmax(0,1fr) auto auto;gap:18px;align-items:center;padding:16px 20px;border:1px solid var(--line);border-radius:var(--r);background:#fff;transition:border-color .22s ease,background .22s ease,transform .22s var(--ease)}
.row:hover{border-color:var(--line-2);background:linear-gradient(180deg,rgba(11,12,14,.05),rgba(11,12,14,.015));transform:translateY(-1px)}
.row-mark{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(180deg,#fbf8f1,#fff);border:1px solid var(--line);font-size:14px;color:var(--ink-2);text-transform:uppercase;letter-spacing:0}
.row-main{min-width:0}
.row-name{display:block;font-size:15px;font-weight:500;letter-spacing:-.018em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row-sub{display:block;font-family:var(--mono);font-size:10.5px;color:var(--ink-3);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.01em}
.row-state{justify-self:start}
.row-go{justify-self:end;display:inline-flex;align-items:center;gap:6px;color:var(--ink-3);font-size:12px;white-space:nowrap;transition:color .2s ease,gap .2s ease}
.row:hover .row-go{color:var(--ink);gap:9px}

/* --------------------------------------------------------- empty / start */
.empty{border:1px solid var(--line);border-radius:var(--r-lg);padding:40px;margin-top:8px;background:#fff}
.empty h2{font-family:var(--serif);font-size:clamp(26px,2.4vw,32px);letter-spacing:-.02em;font-weight:400;line-height:1.05;margin:0 0 12px}
.empty p{color:var(--ink-2);max-width:56ch;margin:0 0 22px;font-size:14px}
.empty-search h2{font-size:22px;letter-spacing:-.03em}

.start{position:relative;border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;display:grid;grid-template-columns:minmax(0,1.06fr) minmax(0,.94fr);margin-top:10px;background:#fff}
.start::before{content:"";position:absolute;top:0;left:12%;right:12%;height:1px;background:linear-gradient(90deg,transparent,rgba(11,12,14,.42),transparent)}
.start::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(620px 300px at 18% 0%,rgba(11,12,14,.055),transparent 70%)}
.start-copy{padding:46px 42px;position:relative;z-index:1}
.start-copy h2{font-family:var(--serif);font-size:clamp(29px,2.7vw,38px);letter-spacing:-.02em;font-weight:400;line-height:1.04;margin:0 0 14px}
.start-copy p{color:var(--ink-2);font-size:14px;max-width:44ch;margin:0}
.start-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}
.steps{list-style:none;margin:0;padding:22px 38px;border-left:1px solid var(--line);display:flex;flex-direction:column;justify-content:center;position:relative;z-index:1;background:rgba(11,12,14,.015)}
.steps li{display:flex;gap:16px;align-items:flex-start;padding:19px 0;border-bottom:1px solid var(--line)}
.steps li:last-child{border-bottom:0;padding-bottom:4px}
.steps li:first-child{padding-top:4px}
.step-n{flex:none;width:26px;height:26px;border:1px solid var(--line-2);border-radius:50%;display:grid;place-items:center;font-family:var(--mono);font-size:10px;color:var(--ink-2);margin-top:1px;background:rgba(11,12,14,.04)}
.steps strong{display:block;font-size:13.5px;font-weight:500;letter-spacing:-.015em}
.steps p{margin:4px 0 0;font-size:12.5px;color:var(--ink-3);line-height:1.55;max-width:36ch}
.steps a{color:var(--ink-2);text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--line-2)}
.steps a:hover{color:var(--ink);text-decoration-color:var(--ink)}

/* -------------------------------------------------------------- endpoint */
.endpoint{display:grid;grid-template-columns:minmax(0,1fr) minmax(330px,460px);gap:32px;align-items:center;border:1px solid var(--line);border-radius:var(--r-lg);background:linear-gradient(180deg,rgba(11,12,14,.03),rgba(11,12,14,.008));padding:26px 30px;margin-top:56px}
.endpoint h2{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3);font-weight:400;margin:0 0 8px}
.endpoint p{margin:0;color:var(--ink-3);font-size:12.5px;max-width:48ch}
.copyline{display:flex;align-items:center;gap:10px;border:1px solid var(--line-2);border-radius:999px;background:#fffdf9;padding:5px 5px 5px 18px;min-width:0}
.copyline code{color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;flex:1;min-width:0;letter-spacing:.01em}
.copyline .btn{flex-shrink:0;height:32px;padding:0 15px;font-size:12px}

/* ---------------------------------------------------------------- project */
.crumb{display:flex;gap:9px;align-items:center;color:var(--ink-3);font-size:11.5px;margin-bottom:22px;font-family:var(--mono);letter-spacing:.04em}
.crumb a:hover{color:var(--ink)}
.crumb [aria-current]{color:var(--ink-2)}
.proj-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding-bottom:28px;border-bottom:1px solid var(--line);margin-bottom:0}
.proj-head h1{font-size:clamp(34px,4vw,48px);line-height:1.02;letter-spacing:-.045em}
.proj-head-actions{display:flex;align-items:center;gap:10px;flex-shrink:0;padding-top:6px}
.proj-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:52px;align-items:start}
.proj-main{min-width:0}
.proj-main section:first-of-type{margin-top:38px}
.side{border-left:1px solid var(--line);padding-left:28px;margin-top:38px;display:grid;gap:18px}
.side section{margin-top:0}
.panel{border:1px solid var(--line);border-radius:var(--r);background:#fff;padding:20px}
.panel h2{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);font-weight:400;margin:0 0 15px}
.preview-link{margin-top:22px}

/* --------------------------------------------------------------- decision */
.decision{position:relative;overflow:hidden;border:1px solid var(--line-2);border-radius:var(--r-lg);padding:30px 30px 28px;margin-top:30px;background:#fff}
.decision::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(520px 200px at 0% 0%,rgba(11,12,14,.06),transparent 68%)}
.decision[data-tone=you]{border-color:rgba(233,189,121,.26)}
.decision[data-tone=you]::after{background:radial-gradient(560px 220px at 0% 0%,rgba(233,189,121,.11),transparent 70%)}
.decision[data-tone=live]{border-color:rgba(158,213,166,.24)}
.decision[data-tone=live]::after{background:radial-gradient(560px 220px at 0% 0%,rgba(158,213,166,.09),transparent 70%)}
.decision[data-tone=stop]{border-color:rgba(233,160,143,.26)}
.decision[data-tone=stop]::after{background:radial-gradient(560px 220px at 0% 0%,rgba(233,160,143,.10),transparent 70%)}
.decision > *{position:relative;z-index:1}
.decision h2{font-family:var(--serif);font-size:clamp(23px,2.2vw,28px);font-weight:400;letter-spacing:-.035em;margin:0 0 10px;font-weight:500}
.decision p{color:var(--ink-2);margin:0 0 18px;max-width:66ch;font-size:13.5px;line-height:1.65}
.decision p.note{margin-top:-4px;margin-bottom:16px}
.quiet{border-top:1px solid var(--line);padding-top:24px;margin-top:30px}
.quiet h2{font-size:16px;letter-spacing:-.02em;margin-bottom:7px}
.quiet p{color:var(--ink-2);margin:0;font-size:13.5px}

/* --------------------------------------------------------------- timeline */
.step{display:grid;grid-template-columns:16px 1fr;gap:18px;padding-bottom:26px;position:relative}
.step:last-child{padding-bottom:0}
.step::before{content:"";position:absolute;left:5px;top:17px;bottom:0;width:1px;background:var(--line)}
.step:last-child::before{display:none}
.dot{width:11px;height:11px;border-radius:50%;border:1px solid var(--line-2);background:var(--bg);margin-top:3px;position:relative;z-index:1;display:block}
.step[data-state=done] .dot{background:var(--ink);border-color:var(--ink)}
.step[data-state=now] .dot{background:var(--warn);border-color:var(--warn);box-shadow:0 0 0 4px rgba(233,189,121,.12)}
.step[data-state=now][data-live] .dot{background:var(--pass);border-color:var(--pass);box-shadow:0 0 0 4px rgba(158,213,166,.12)}
.step[data-state=now][data-stop] .dot{background:var(--stop);border-color:var(--stop);box-shadow:0 0 0 4px rgba(233,160,143,.12)}
.step-label{display:block;font-size:13.5px;line-height:1.35;letter-spacing:-.01em}
.step[data-state=todo] .step-label{color:var(--ink-3)}
.step[data-state=now] .step-label{font-weight:500}
.step-when{display:block;font-family:var(--mono);font-size:10.5px;color:var(--ink-3);margin-top:4px;letter-spacing:.03em}
.budget{display:flex;flex-wrap:wrap;gap:12px 40px;margin:26px 0 0;padding-top:20px;border-top:1px solid var(--line)}
.budget div{display:flex;flex-direction:column-reverse;gap:4px}
.budget dt{color:var(--ink-3);font-size:11px}
.budget dd{margin:0;font-family:var(--mono);font-size:13px;letter-spacing:.02em}

/* ----------------------------------------------------------------- tables */
.gates,.hist{width:100%;border-collapse:collapse}
.gates td{padding:17px 0;border-bottom:1px solid var(--line);vertical-align:top}
.gates tr:last-child td{border-bottom:0}
.gate-name{font-size:13.5px;letter-spacing:-.01em}
.gate-desc{color:var(--ink-3);font-size:12px;margin-top:4px;max-width:66ch;line-height:1.55}
.gate-cell{text-align:right;vertical-align:middle;white-space:nowrap;padding-left:16px}
.hist td{padding:12px 0;border-bottom:1px solid var(--line);vertical-align:top;font-size:12.5px}
.hist tr:last-child td{border-bottom:0}
.hist-time{color:var(--ink-3);font-family:var(--mono);font-size:10.5px;white-space:nowrap;width:108px;padding-top:14px!important;letter-spacing:.02em}
.hist-note{color:var(--ink-3);font-size:11.5px;margin-top:3px}
.hist-move{text-align:right;color:var(--ink-3);white-space:nowrap;font-size:11px;padding-left:14px!important}
.hist-move .mono{font-size:10.5px;color:var(--ink-2)}

/* ----------------------------------------------------------------- panels */
.live-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
.live-head .mono{font-size:10.5px;color:var(--ink-3)}
.live-url{font-size:11.5px;margin:0 0 14px;word-break:break-all;line-height:1.6}
.live-url a{border-bottom:1px solid var(--line-2);padding-bottom:1px}
.live-url a:hover{border-color:var(--ink)}
.conditions{margin:10px 0 14px;padding-left:16px;color:var(--ink-2);font-size:12px;list-style:disc}
.conditions li{margin:4px 0}
.deploys{margin-top:16px;border-top:1px solid var(--line);padding-top:13px}
.deploys summary{color:var(--ink-3);font-size:11.5px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px}
.deploys summary::-webkit-details-marker{display:none}
.deploys summary::before{content:"+";font-family:var(--mono);width:8px}
.deploys[open] summary::before{content:"–"}
.deploy-list{margin:10px 0 0;display:grid;gap:8px}
.deploy-list li{display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--ink-2)}
.kv{display:grid;grid-template-columns:1fr auto;gap:10px 14px;font-size:12px}
.kv dt{color:var(--ink-3);white-space:nowrap}
.kv dd{text-align:right;font-family:var(--mono);font-size:11px;color:var(--ink-2);overflow-wrap:anywhere;min-width:0}
.kv dd.truncate{max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.copy-inline{background:none;border:0;padding:0;color:var(--ink-2);font:inherit;font-family:var(--mono);font-size:11px;cursor:pointer;border-bottom:1px dotted var(--line-2)}
.copy-inline:hover{color:var(--ink)}
.secret-list{display:grid;gap:10px}
.secret-list li{display:flex;justify-content:space-between;gap:10px;font-size:11.5px}
.secret-list .dim{font-size:10.5px}

/* ---------------------------------------------------------------- services */
.services{display:grid;gap:14px}
.services li{display:flex;align-items:center;justify-content:space-between;gap:12px}
.service{display:flex;flex-direction:column;min-width:0}
.service-name{font-size:12.5px}
.service-meta{font-family:var(--mono);font-size:10px;color:var(--ink-3);margin-top:3px;letter-spacing:.02em}
.status{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.status::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.9}
.status[data-tone=live]{color:var(--pass)}
.status[data-tone=idle]{color:var(--ink-3)}

/* ---------------------------------------------------------------- settings */
.settings-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:20px;margin-top:34px;align-items:start}
.settings-card h2{font-family:var(--sans);font-size:15px;letter-spacing:-.015em;text-transform:none;color:var(--ink);font-weight:500;margin-bottom:18px}
.settings-form{display:grid}
.settings-row{display:flex;gap:10px;align-items:center}
.settings-row input{max-width:360px}
.settings-row .btn{flex-shrink:0}
.saved{color:var(--pass);font-size:12px;margin:14px 0 0}
.settings-back{margin-top:30px}

/* ------------------------------------------------------------------ forms */
form{margin:0}
label{display:block;color:var(--ink-3);font-size:11.5px;margin-bottom:8px;letter-spacing:.01em}
input[type=text],input[type=password],input[type=email]{display:block;width:100%;height:42px;padding:0 15px;background:rgba(11,12,14,.03);border:1px solid var(--line-2);border-radius:var(--r-sm);color:var(--ink);font:inherit;font-size:13.5px;transition:border-color .2s ease,box-shadow .2s ease}
input::placeholder{color:rgba(11,12,14,.26)}
input:focus{border-color:rgba(11,12,14,.4);outline:none;box-shadow:0 0 0 4px rgba(11,12,14,.05)}
.sendback{margin-top:24px;padding-top:20px;border-top:1px solid var(--line)}
.sendback-row{display:flex;gap:10px;max-width:520px}
.sendback-row .btn{flex-shrink:0}
.confirm{max-width:520px}
.confirm label{margin-top:16px}
.error{color:var(--stop);border:1px solid rgba(233,160,143,.3);border-radius:var(--r-sm);padding:11px 14px;background:rgba(233,160,143,.06);font-size:12.5px}
.why{color:var(--ink-2);border-left:2px solid var(--line-2);padding-left:14px;font-size:13px}

/* ------------------------------------------------------------------- docs */
.doc{border:1px solid var(--line);border-radius:var(--r-lg);background:#fff;margin-top:32px;padding:8px 30px 12px;max-width:840px}
.doc pre{margin:0;padding:22px 0;white-space:pre-wrap;word-break:break-word;font-family:var(--mono);font-size:12px;line-height:1.75;color:var(--ink-2);tab-size:2}

/* ----------------------------------------------------------------- danger */
.danger{margin-top:44px;border-top:1px solid var(--line);padding-top:24px}
.danger summary{color:var(--ink-3);font-size:12px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px}
.danger summary::-webkit-details-marker{display:none}
.danger summary::before{content:"+";font-family:var(--mono);color:var(--ink-3);width:10px}
.danger[open] summary::before{content:"–"}
.danger summary:hover{color:var(--ink-2)}
.danger-body{margin-top:18px;max-width:600px}
.danger-body p{color:var(--ink-3);font-size:12.5px;margin:0 0 16px;max-width:62ch}

/* ---------------------------------------------------------------- connect */
.field{margin-top:0;border:1px solid var(--line);border-radius:var(--r-lg);background:#fff;padding:26px 30px}
.field-label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3);margin-bottom:14px}
.specs{display:flex;flex-wrap:wrap;gap:14px 48px;margin:24px 0 0;padding-top:20px;border-top:1px solid var(--line)}
.specs div{display:flex;flex-direction:column;gap:5px}
.specs dt{color:var(--ink-3);font-size:9.5px;font-family:var(--mono);letter-spacing:.12em;text-transform:uppercase}
.specs dd{margin:0;font-size:12.5px;color:var(--ink-2)}
.code-line{border-radius:var(--r-sm)}
.code-line code{color:var(--ink)}
.tool-list-wrap{margin-top:18px;border-top:1px solid var(--line);padding-top:16px}
.tool-list-wrap summary{cursor:pointer;color:var(--ink-3);font-size:12px;list-style:none}
.tool-list-wrap summary::-webkit-details-marker{display:none}
.tool-list-wrap summary::before{content:"+ ";font-family:var(--mono)}
.tool-list-wrap[open] summary::before{content:"– "}
.tool-list{margin:20px 0 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--r-sm);overflow:hidden}
.tool-list li{display:grid;gap:3px;background:#fff;padding:15px 17px}
.tool-name{font-size:11.5px;color:var(--ink)}
.tool-title{font-size:12px;color:var(--ink-2)}
.tool-meta{font-family:var(--mono);font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3);margin-top:3px}
.tool-desc{font-size:11.5px;color:var(--ink-3);line-height:1.55;margin-top:5px}

/* ----------------------------------------------------------------- footer */
.foot{max-width:var(--shell);margin:0 auto;padding:26px 40px 46px;border-top:1px solid var(--line);display:flex;align-items:center;gap:10px;color:var(--ink-3);font-size:11.5px;font-family:var(--mono);letter-spacing:.01em}
.foot .spacer{flex:1}
.foot .mono{font-size:11px;color:var(--ink-3)}
.foot .foot-brand{display:inline-flex;align-items:center;gap:8px;color:var(--ink-2);font-family:var(--sans);font-size:12.5px;letter-spacing:-.01em}
.foot .foot-brand svg{width:13px;height:14px;color:var(--ink-2)}

/* -------------------------------------------------------------- bare pages */
body.bare{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:40px 22px}
body.bare::before{background:radial-gradient(820px 460px at 50% -10%,rgba(47,91,255,.08),transparent 70%),radial-gradient(600px 400px at 84% 92%,rgba(11,12,14,.04),transparent 72%)}
.bare-main{width:100%;max-width:540px;border:1px solid var(--line);border-radius:var(--r-lg);background:#fff;padding:38px}
.bare-main .brand{margin-bottom:30px}
.bare-main h1{font-family:var(--serif);font-size:clamp(30px,3.4vw,38px);letter-spacing:-.02em;line-height:1.05;margin-bottom:12px}
.bare-main p{color:var(--ink-2);font-size:13.5px;margin:0 0 18px;line-height:1.65}
.secret-form{display:grid;gap:12px;margin:22px 0}
.secret-form .btn{justify-self:start}

/* -------------------------------------------------------------- responsive */
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

@media (max-width:1020px){
  .bar-in{padding:0 28px;gap:20px}
  main{padding:0 28px 88px}
  .foot{padding:24px 28px 40px}
  .proj-grid{grid-template-columns:minmax(0,1fr) 268px;gap:36px}
}

@media (max-width:900px){
  .hero{padding:48px 0 30px}
  .start{grid-template-columns:1fr}
  .steps{border-left:0;border-top:1px solid var(--line);padding:8px 30px 24px}
  .steps li{padding:17px 0}
  .endpoint{grid-template-columns:1fr;gap:18px;padding:24px}
  .proj-grid{grid-template-columns:1fr;gap:0}
  .side{border-left:0;padding-left:0;border-top:1px solid var(--line);padding-top:30px;margin-top:36px;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
  .tool-list{grid-template-columns:1fr}
  .who .quota{display:none}
}

@media (max-width:680px){
  .bar-in{height:60px;padding:0 18px;gap:14px}
  .brand{font-size:14.5px}
  .brand svg{width:17px;height:18px}
  .bar nav{margin-left:0;gap:0}
  .bar nav a{padding:6px 10px;font-size:12.5px}
  .who{gap:10px}
  .who .account-mail{display:none}
  .who .plan{display:none}
  .who .signout{font-size:11.5px}
  main{padding:0 18px 72px}
  h1{font-size:clamp(34px,10vw,46px)}
  .hero{padding:36px 0 26px;margin-bottom:26px}
  .lede{font-size:14px;margin-top:14px}
  .hero-meta{margin-top:20px}
  .start-copy{padding:32px 24px}
  .start-copy h2{font-size:26px}
  .start-actions{flex-direction:column;align-items:stretch}
  .start-actions .btn{width:100%}
  .steps{padding:6px 24px 20px}
  .empty{padding:28px 22px}
  .endpoint{margin-top:40px}
  .copyline{padding-left:14px}
  .row{grid-template-columns:36px minmax(0,1fr) auto;gap:14px;padding:14px 14px}
  .row-mark{width:34px;height:34px;border-radius:10px}
  .row-go{display:none}
  .row-sub{white-space:normal;overflow:visible;text-overflow:clip;line-height:1.55}
  .row-updated{display:none}
  .proj-head{flex-direction:column;gap:16px}
  .proj-head-actions{width:100%;justify-content:space-between;padding-top:0}
  .side{grid-template-columns:1fr}
  .decision{padding:24px 22px}
  .field{padding:22px 20px}
  .doc{padding:4px 18px 8px}
  .list-tools{flex-direction:column;align-items:stretch;gap:14px}
  .search{width:100%}
  .search input[type=search]{flex:1;width:auto;min-width:0}
  .filters{overflow-x:auto;padding-bottom:2px}
  .settings-grid{grid-template-columns:1fr}
  .settings-row{flex-direction:column;align-items:stretch}
  .settings-row input{max-width:none}
  .settings-row .btn{width:100%}
  .foot{padding:22px 18px 40px;flex-direction:column;align-items:flex-start;gap:8px}
  .foot .spacer,.foot > span[aria-hidden]{display:none}
  .meta > span[aria-hidden]{display:none}
  .sendback-row{flex-direction:column;align-items:stretch}
  .sendback-row .btn{width:100%}
  .bare-main{padding:30px 22px}
}
`;
