/**
 * The app's stylesheet.
 *
 * Kept beside the page renderers rather than in a build pipeline because the
 * server is the only thing that serves it: there is no bundler on this origin,
 * and a stylesheet that needs one is a stylesheet that can fail separately from
 * the page it dresses.
 *
 * The tokens, type and shapes are the landing page's. A person crosses from
 * the landing to the app in one click, so the two should read as one product.
 */
export const DASHBOARD_CSS = `
@font-face{font-family:'Inter';font-style:normal;font-weight:100 700;font-display:swap;src:url('/assets/fonts/inter-latin.woff2') format('woff2')}
@font-face{font-family:'Fragment Mono';font-style:normal;font-weight:400;font-display:swap;src:url('/assets/fonts/fragment-mono-latin.woff2') format('woff2')}

/* ------------------------------------------------------------------ tokens
   The landing page's palette and shapes: black, warm white ink, frosted
   cards, pill buttons. One accent per meaning: amber needs you, green is
   live, coral stopped. */
:root{
  --bg:#000;
  --card:rgba(18,18,18,.86);
  --card-2:rgba(255,255,255,.03);
  --raise:rgba(255,255,255,.06);
  --ink:#fff3f0;
  --ink-2:rgba(255,243,240,.72);
  --ink-3:rgba(255,243,240,.48);
  --ink-4:rgba(255,243,240,.3);
  --line:rgba(255,255,255,.08);
  --line-2:rgba(255,255,255,.14);
  --pass:#8be6a8;
  --warn:#f0c27b;
  --stop:#f19b8a;
  --accent:#fff3f0;
  --accent-soft:rgba(255,243,240,.08);
  --sans:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
  --mono:'Fragment Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --shell:1200px;
  --gutter:32px;
  --r-lg:22px;
  --r:16px;
  --r-sm:12px;
  --shadow:inset 0 1px 0 rgba(255,255,255,.05),0 24px 60px -24px rgba(0,0,0,.6);
  --ease:cubic-bezier(.16,1,.3,1);
  color-scheme:dark;
}

*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;background:var(--bg)}
body{
  margin:0;min-height:100vh;display:flex;flex-direction:column;background:transparent;color:var(--ink);
  font:400 14px/1.6 var(--sans);letter-spacing:-.015em;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
}
/* The landing's starfield, faded into black behind the top of every page. */
body::before{
  content:"";position:absolute;left:0;right:0;top:0;height:520px;z-index:-1;pointer-events:none;
  background:url('/assets/img/hero-bg.jpg') center 22%/cover no-repeat;opacity:.34;
  -webkit-mask-image:linear-gradient(180deg,#000,rgba(0,0,0,.4) 55%,transparent);
  mask-image:linear-gradient(180deg,#000,rgba(0,0,0,.4) 55%,transparent);
}
a{color:inherit;text-decoration:none}
p,h1,h2,h3,h4,ul,ol,figure,dl,dd{margin:0}
ul,ol{padding:0;list-style:none}
button{font:inherit;color:inherit}
code,.mono{font-family:var(--mono);font-size:.9em;letter-spacing:0}
.dim{color:var(--ink-3)}
.i{width:16px;height:16px;flex:none;display:inline-block;vertical-align:-3px}
.skip{position:absolute;left:-9999px}
.skip:focus{left:16px;top:12px;z-index:100;background:var(--ink);color:#000;padding:9px 14px;border-radius:999px;font-size:12.5px;font-weight:500}
:focus-visible{outline:2px solid rgba(255,243,240,.7);outline-offset:3px;border-radius:8px}
::selection{background:rgba(255,243,240,.22);color:#fff}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
[hidden]{display:none!important}

/* ---------------------------------------------------------------- header */
.bar{position:sticky;top:0;z-index:50;background:rgba(3,3,3,.6);backdrop-filter:blur(22px) saturate(140%);-webkit-backdrop-filter:blur(22px) saturate(140%);border-bottom:1px solid rgba(255,255,255,.06)}
.bar-in{position:relative;max-width:var(--shell);margin:0 auto;height:64px;padding:0 var(--gutter);display:flex;align-items:center;gap:24px}
.brand{display:inline-flex;align-items:center;gap:10px;font-size:16px;font-weight:500;letter-spacing:-.025em;flex:none}
.brand svg{width:22px;height:23px;display:block;color:var(--ink)}
.bar-in > nav{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;gap:6px;padding:4px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}
.bar-in > nav a{height:32px;display:inline-flex;align-items:center;padding:0 16px;border-radius:999px;font-size:13.5px;color:var(--ink-3);transition:color .2s ease,background .2s ease}
.bar-in > nav a:hover{color:var(--ink)}
.bar-in > nav a[aria-current=page]{color:var(--ink);background:rgba(255,255,255,.09)}
.who{margin-left:auto;display:flex;align-items:center;gap:10px}
.quota{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--line);color:var(--ink-2);font-size:12.5px}
.quota .i{width:13px;height:13px;color:var(--warn)}
.avatar{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(160deg,#3a3431,#171515);border:1px solid var(--line-2);font-size:12px;font-weight:500;color:var(--ink);text-transform:uppercase;letter-spacing:0}
.avatar-lg{width:38px;height:38px;font-size:14px}

/* account menu */
.menu{position:relative}
.menu-trigger{list-style:none;display:flex;align-items:center;gap:6px;height:36px;padding:0 8px 0 4px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.04);cursor:pointer;transition:border-color .2s ease,background .2s ease}
.menu-trigger::-webkit-details-marker{display:none}
.menu-trigger:hover,.menu[open] .menu-trigger{border-color:var(--line-2);background:rgba(255,255,255,.07)}
.menu-chev{color:var(--ink-3);display:flex}
.menu-chev .i{width:13px;height:13px;transition:transform .2s var(--ease)}
.menu[open] .menu-chev .i{transform:rotate(180deg)}
.menu-panel{position:absolute;right:0;top:calc(100% + 10px);width:300px;padding:8px;border-radius:18px;background:#121212;border:1px solid var(--line-2);box-shadow:0 30px 70px -10px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.05);animation:menu-in .18s var(--ease)}
@keyframes menu-in{from{opacity:0;transform:translateY(-4px)}}
.menu-who{display:flex;align-items:center;gap:12px;padding:10px 10px 14px}
.menu-id{display:flex;flex-direction:column;min-width:0}
.menu-mail{font-size:13.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.menu-plan{font-size:12px;color:var(--ink-3);text-transform:capitalize}
.menu-usage{margin:0 2px 6px;padding:12px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid var(--line)}
.menu-usage-row{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--ink-2)}
.menu-usage-row .mono{color:var(--ink)}
.meter{display:block;height:4px;border-radius:99px;background:rgba(255,255,255,.08);margin:10px 0 8px;overflow:hidden}
.meter span{display:block;height:100%;border-radius:inherit;background:var(--ink)}
.menu-hint{display:block;font-size:11.5px;color:var(--ink-4);line-height:1.5}
.menu-links{display:grid;padding-top:6px;border-top:1px solid var(--line);margin-top:6px}
.menu-links a{display:flex;align-items:center;gap:10px;height:38px;padding:0 10px;border-radius:10px;font-size:13px;color:var(--ink-2);transition:background .15s ease,color .15s ease}
.menu-links a:hover{background:rgba(255,255,255,.06);color:var(--ink)}
.menu-links .i{color:var(--ink-3)}

/* ------------------------------------------------------------------ main */
main{flex:1;width:100%;max-width:var(--shell);margin:0 auto;padding:0 var(--gutter) 96px}
h1{font-size:clamp(30px,3.2vw,40px);line-height:1.12;letter-spacing:-.04em;font-weight:400}
h2{font-size:14px;font-weight:500;letter-spacing:-.015em}
.lede{margin-top:10px;max-width:62ch;color:var(--ink-2);font-size:14.5px;line-height:1.6}
.note{color:var(--ink-3);font-size:12.5px;line-height:1.6;max-width:66ch}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--ink-3);font-size:12.5px;margin-top:8px}
.meta .mono{color:var(--ink-2)}
.list{margin:8px 0 12px;padding-left:18px;color:var(--ink-2);font-size:13px;list-style:disc}
.list li{margin:4px 0}
.text-link{background:none;border:0;padding:0;cursor:pointer;color:var(--ink);text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--line-2);transition:text-decoration-color .2s ease}
.text-link:hover{text-decoration-color:var(--ink)}

.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;padding:52px 0 28px}
.page-actions{display:flex;gap:10px;flex-wrap:wrap}
.eyebrow{display:inline-flex;align-items:center;gap:10px;height:31px;padding:0 14px;margin:0 0 20px;border-radius:999px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06);color:rgba(255,243,240,.8);font-size:13px;letter-spacing:-.01em;backdrop-filter:blur(8px)}
.eyebrow::before{content:"";width:5px;height:5px;border-radius:50%;background:#e8e2de}
.eyebrow .eyebrow-dot{display:none}
.crumb{display:flex;gap:8px;align-items:center;color:var(--ink-3);font-size:12.5px;padding-top:32px}
.crumb a:hover{color:var(--ink)}
.crumb [aria-current]{color:var(--ink-2)}

/* ---------------------------------------------------------------- buttons */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  height:38px;padding:0 18px;border-radius:999px;
  border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.07);color:var(--ink);
  font-size:13.5px;font-weight:450;letter-spacing:-.015em;cursor:pointer;white-space:nowrap;
  transition:background .2s ease,border-color .2s ease,transform .2s var(--ease);
}
.btn:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.14)}
.btn:active{transform:scale(.98)}
.btn .i{width:15px;height:15px}
.btn-primary{background:rgba(255,243,240,.92);border-color:transparent;color:#0b0b0b;font-weight:500}
.btn-primary:hover{background:#fff;border-color:transparent}
.btn-sm{height:32px;padding:0 13px;font-size:12.5px}
.btn-sm .i{width:13px;height:13px}
.btn-lg{height:46px;padding:0 28px;font-size:15px}
.btn-icon{width:38px;padding:0}
.btn-danger{color:var(--stop);border-color:rgba(241,155,138,.25);background:rgba(241,155,138,.06)}
.btn-danger:hover{background:rgba(241,155,138,.12);border-color:rgba(241,155,138,.4)}
.actions,.card-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.card-actions{margin-top:16px}

/* ------------------------------------------------------------------ chips */
.chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 9px;border-radius:999px;font-size:12px;font-weight:500;letter-spacing:-.005em;white-space:nowrap;color:var(--ink-2);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.07)}
.chip::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.chip[data-tone=live]{color:var(--pass);background:rgba(139,230,168,.08);border-color:rgba(139,230,168,.2)}
.chip[data-tone=you]{color:var(--warn);background:rgba(240,194,123,.08);border-color:rgba(240,194,123,.22)}
.chip[data-tone=stop]{color:var(--stop);background:rgba(241,155,138,.08);border-color:rgba(241,155,138,.22)}
.chip[data-tone=work]::before{animation:pulse 2s ease-in-out infinite}
@keyframes pulse{50%{opacity:.35}}
.mode-badge{display:inline-flex;align-items:center;gap:5px;color:var(--ink-3)}
.mode-badge .i{width:12px;height:12px}
.mode-badge[data-on=true]{color:var(--warn)}

/* ------------------------------------------------------------------ cards */
.card,.panel,.field,.setup-card,.settings-card,.doc,.empty{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);box-shadow:var(--shadow)}
.card{padding:20px 22px 22px}
.card + .card{margin-top:16px}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;min-height:24px}
.card-head h2{font-size:14px}
.card-sub{font-size:12px;color:var(--ink-3)}
.card-text{color:var(--ink-2);font-size:13px;line-height:1.6;margin-bottom:14px}
.card-text:last-child{margin-bottom:0}

/* ------------------------------------------------------------------ stats */
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:28px}
.stat{display:flex;flex-direction:column;padding:16px 18px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow)}
.stat-l{font-size:12.5px;color:var(--ink-3)}
.stat-n{font-size:30px;line-height:1.15;letter-spacing:-.035em;margin-top:6px;font-variant-numeric:tabular-nums}
.stat-sub{font-size:12px;color:var(--ink-4);margin-top:2px}
.stat[data-tone=you] .stat-n{color:var(--warn)}
.stat[data-tone=you]{border-color:rgba(240,194,123,.22)}
.stat[data-tone=live] .stat-n{color:var(--pass)}

/* ---------------------------------------------------------------- toolbar */
.toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.search{position:relative;display:flex;align-items:center;gap:8px;min-width:0}
.search > .i{position:absolute;left:14px;color:var(--ink-3);pointer-events:none}
.search input[type=search]{width:300px;height:38px;padding:0 16px 0 40px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--ink);font:inherit;font-size:13.5px;transition:border-color .2s ease,background .2s ease}
.search input[type=search]::placeholder{color:var(--ink-4)}
.search input[type=search]:focus{outline:none;border-color:rgba(255,243,240,.35);background:rgba(255,255,255,.06)}
.search .clear{font-size:12.5px;color:var(--ink-3)}
.search .clear:hover{color:var(--ink)}
.segmented{display:flex;gap:2px;padding:3px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid var(--line)}
.segmented a{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 13px;border-radius:999px;font-size:13px;color:var(--ink-3);transition:color .2s ease,background .2s ease}
.segmented a:hover{color:var(--ink)}
.segmented a[aria-current=page]{color:var(--ink);background:rgba(255,255,255,.1)}
.segmented .count{font-size:11.5px;color:var(--ink-4);font-variant-numeric:tabular-nums}
.segmented a[aria-current=page] .count{color:var(--ink-3)}
.result-note{margin:-4px 0 14px;color:var(--ink-3);font-size:12.5px}

/* ---------------------------------------------------------- project cards */
.pgrid-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.pcard{display:flex;flex-direction:column;gap:18px;padding:20px;border-radius:var(--r-lg);background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);transition:border-color .2s ease,transform .25s var(--ease),background .2s ease;text-align:left;min-height:168px}
.pcard:hover{border-color:rgba(255,255,255,.18);transform:translateY(-2px);background:rgba(24,24,24,.9)}
.pcard-top{display:flex;align-items:flex-start;gap:12px}
.pmark{flex:none;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:15px;font-weight:500;text-transform:uppercase;color:var(--ink);background:linear-gradient(160deg,rgba(255,243,240,.16),rgba(255,243,240,.04));border:1px solid rgba(255,255,255,.1)}
.pmark-lg{width:52px;height:52px;border-radius:16px;font-size:20px}
.pcard-id{flex:1;min-width:0;display:flex;flex-direction:column}
.pcard-name{font-size:15.5px;font-weight:500;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pcard-sub{display:flex;align-items:center;gap:6px;margin-top:2px;font-size:12.5px;color:var(--ink-3);min-width:0}
.pcard-sub span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pcard-sub .i{width:13px;height:13px}
.pcard-url{color:var(--pass)}
.pmeter{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-top:auto}
.pmeter span{height:4px;border-radius:99px;background:rgba(255,255,255,.08)}
.pmeter span[data-state=done]{background:rgba(255,243,240,.78)}
.pmeter span[data-state=now]{background:var(--warn)}
.pmeter span[data-state=now][data-live]{background:var(--pass)}
.pmeter span[data-state=skip]{background:repeating-linear-gradient(90deg,rgba(255,255,255,.14) 0 4px,transparent 4px 7px)}
.pcard-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--ink-3)}
.pcard-mode{display:inline-flex;align-items:center;gap:5px}
.pcard-mode .i{width:12px;height:12px;color:var(--warn)}
.pcard-new{align-items:center;justify-content:center;gap:6px;cursor:pointer;background:transparent;box-shadow:none;border:1px dashed rgba(255,255,255,.14);color:var(--ink-2);font-size:14px;font-weight:500}
.pcard-new:hover{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.28)}
.pcard-new-icon{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.06);margin-bottom:6px}
.pcard-new-sub{font-size:12.5px;font-weight:400;color:var(--ink-3)}

/* ------------------------------------------------------------------ empty */
.empty{padding:48px 32px;text-align:center;display:flex;flex-direction:column;align-items:center}
.empty-icon{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.06);margin-bottom:14px;color:var(--ink-2)}
.empty h2{font-size:18px;font-weight:500;letter-spacing:-.025em}
.empty p{color:var(--ink-3);font-size:13.5px;margin:6px 0 18px;max-width:46ch}
.empty-inline{padding:20px;text-align:left;align-items:flex-start;box-shadow:none;background:rgba(255,255,255,.02)}
.empty-inline p{margin:0;color:var(--ink-2)}

/* the welcome for a new account: the landing's hero, in the app */
.welcome{text-align:center;padding:96px 0 40px}
.welcome h1{font-size:clamp(38px,4.6vw,56px);line-height:1.16;max-width:760px;margin:0 auto}
.welcome .lede{margin:18px auto 0;max-width:520px}
.welcome-actions{display:flex;justify-content:center;gap:10px;margin-top:36px;flex-wrap:wrap}
.welcome-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:24px}
.welcome-steps li{padding:22px;border-radius:var(--r-lg);background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow)}
.welcome-steps strong{display:block;font-size:15px;font-weight:500;letter-spacing:-.02em;margin-top:14px}
.welcome-steps p{margin-top:6px;font-size:13px;color:var(--ink-3);line-height:1.55}
.step-n{flex:none;width:26px;height:26px;border:1px solid var(--line-2);border-radius:50%;display:grid;place-items:center;font-family:var(--mono);font-size:10.5px;color:var(--ink-2)}
.welcome-dunes{display:block;height:220px;margin-top:48px;border-radius:var(--r-lg);background:url('/assets/img/dunes.webp') center 70%/cover no-repeat;opacity:.8;-webkit-mask-image:linear-gradient(180deg,transparent,#000 45%);mask-image:linear-gradient(180deg,transparent,#000 45%)}

/* ---------------------------------------------------------------- project */
.proj-head{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;padding:18px 0 26px}
.proj-id{display:flex;align-items:center;gap:16px;min-width:0}
.proj-title{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.proj-title h1{font-size:clamp(28px,3vw,36px)}
.proj-head-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.proj-grid,.connect-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start;margin-top:16px}
.proj-main{min-width:0}
.side{display:grid;gap:16px}
.side .card + .card{margin-top:0}

/* stepper: the run's milestones, across */
.card-steps{padding:22px 24px}
.stepper{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:0}
.step{position:relative;display:flex;flex-direction:column;gap:12px;padding-right:12px}
.step::after{content:"";position:absolute;top:14px;left:36px;right:8px;height:1px;background:var(--line-2)}
.step:last-child::after{display:none}
.step[data-state=done]::after{background:rgba(255,243,240,.4)}
.dot{position:relative;z-index:1;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;border:1px solid var(--line-2);background:#0e0e0e;color:var(--ink-3)}
.dot .i{width:13px;height:13px}
.step-num{font-family:var(--mono);font-size:10.5px}
.step[data-state=done] .dot{background:var(--ink);border-color:var(--ink);color:#0b0b0b}
.step[data-state=now] .dot{border-color:var(--warn);color:var(--warn);box-shadow:0 0 0 4px rgba(240,194,123,.12)}
.step[data-state=now][data-live] .dot{border-color:var(--pass);color:var(--pass);background:rgba(139,230,168,.1);box-shadow:0 0 0 4px rgba(139,230,168,.12)}
.step[data-state=now][data-stop] .dot{border-color:var(--stop);color:var(--stop);box-shadow:0 0 0 4px rgba(241,155,138,.12)}
.step[data-state=skip] .dot{border-style:dashed;background:transparent}
.step-body{display:flex;flex-direction:column;min-width:0}
.step-label{font-size:13.5px;font-weight:500;letter-spacing:-.015em}
.step[data-state=todo] .step-label,.step[data-state=skip] .step-label{color:var(--ink-3);font-weight:400}
.step-when{font-size:12px;color:var(--ink-3);margin-top:2px}
.step[data-state=skip] .step-when{color:var(--ink-4)}

/* decision: the one thing that needs the person */
.decision{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:16px;align-items:start;margin-top:16px;padding:20px 22px;border-radius:var(--r-lg);background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow)}
.decision-icon{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.06);color:var(--ink-2)}
.decision-body h2{font-size:17px;font-weight:500;letter-spacing:-.025em;margin:6px 0 4px}
.decision-body p{color:var(--ink-2);font-size:13.5px;line-height:1.6;max-width:70ch}
.decision-body p + p{margin-top:6px}
.decision-action{display:flex;gap:8px;align-items:center;align-self:center;flex-wrap:wrap}
.decision[data-tone=you]{border-color:rgba(240,194,123,.28);background:linear-gradient(90deg,rgba(240,194,123,.07),rgba(18,18,18,.86) 45%)}
.decision[data-tone=you] .decision-icon{background:rgba(240,194,123,.12);color:var(--warn)}
.decision[data-tone=live]{border-color:rgba(139,230,168,.24);background:linear-gradient(90deg,rgba(139,230,168,.06),rgba(18,18,18,.86) 45%)}
.decision[data-tone=live] .decision-icon{background:rgba(139,230,168,.12);color:var(--pass)}
.decision[data-tone=stop]{border-color:rgba(241,155,138,.28);background:linear-gradient(90deg,rgba(241,155,138,.07),rgba(18,18,18,.86) 45%)}
.decision[data-tone=stop] .decision-icon{background:rgba(241,155,138,.12);color:var(--stop)}
.decision[data-tone=quiet]{background:rgba(255,255,255,.02);box-shadow:none}
.decision[data-tone=quiet] h2{font-size:15px}
.sendback{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
.inline-form{display:flex;gap:8px;max-width:520px}
.inline-form input{flex:1;min-width:0}
.inline-form .btn{flex:none;height:42px}
.confirm{max-width:520px;margin-top:12px}

/* checks */
.gates{display:grid}
.gate{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-top:1px solid var(--line)}
.gate:first-child{border-top:0;padding-top:2px}
.gate:last-child{padding-bottom:0}
.gate-name{font-size:13.5px;font-weight:500}
.gate-desc{color:var(--ink-3);font-size:12.5px;margin-top:2px;line-height:1.55;max-width:62ch}

/* activity */
.activity{display:grid}
.act{position:relative;display:grid;grid-template-columns:14px minmax(0,1fr) auto;gap:14px;padding:10px 0}
.act::before{content:"";position:absolute;left:6.5px;top:24px;bottom:-10px;width:1px;background:var(--line)}
.act:last-child::before{display:none}
.act-dot{width:9px;height:9px;border-radius:50%;margin:6px 0 0 2px;background:var(--ink-4);border:2px solid #121212;box-shadow:0 0 0 1px var(--line-2)}
.act:first-child .act-dot{background:var(--ink)}
.act-body{display:flex;flex-direction:column;min-width:0}
.act-title{font-size:13.5px}
.act-note{font-size:12.5px;color:var(--ink-3);margin-top:2px}
.act-side{display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-size:12px;color:var(--ink-3);white-space:nowrap}
.act-move{font-size:11px;color:var(--ink-4)}

/* side cards */
.live-url{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid var(--line);font-size:13px;color:var(--ink);min-width:0;transition:border-color .2s ease}
.live-url span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.live-url .i{color:var(--ink-3);width:14px;height:14px}
.live-url:hover{border-color:var(--line-2)}
.conditions{margin:8px 0 0;padding-left:16px;color:var(--ink-2);font-size:12.5px;list-style:disc}
.conditions li{margin:3px 0}
.deploys{margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
.deploys summary{cursor:pointer;color:var(--ink-3);font-size:12.5px;list-style:none}
.deploys summary::-webkit-details-marker{display:none}
.deploys summary:hover{color:var(--ink)}
.deploy-list{margin-top:10px;display:grid;gap:8px}
.deploy-list li{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--ink-2)}
.services{display:grid;gap:4px}
.services li{display:flex;align-items:center;gap:12px;padding:8px 0}
.svc-icon{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:rgba(255,255,255,.05);color:var(--ink-2);flex:none}
.service{flex:1;display:flex;flex-direction:column;min-width:0}
.service-name{font-size:13px}
.service-meta{font-size:12px;color:var(--ink-3)}
.status{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-3);white-space:nowrap}
.status::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.status[data-tone=live]{color:var(--pass)}
.kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px 16px;font-size:12.5px}
.kv dt{color:var(--ink-3)}
.kv dd{text-align:right;color:var(--ink-2);min-width:0;overflow-wrap:anywhere}
.kv dd.truncate{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.copy-inline{background:none;border:0;padding:0;cursor:pointer;color:var(--ink-2);font-family:var(--mono);font-size:11.5px;border-bottom:1px dotted var(--line-2)}
.copy-inline:hover{color:var(--ink)}
.budget{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
.budget div{display:flex;flex-direction:column;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.035)}
.budget dd{font-size:18px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.budget dt{font-size:11px;color:var(--ink-3);line-height:1.35}
.secret-list{display:grid;gap:8px}
.secret-list li{display:flex;justify-content:space-between;gap:10px;font-size:12.5px}
.secret-list + .note{margin-top:12px}

/* danger zone */
.card-danger{border-color:rgba(241,155,138,.16)}
.danger summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:16px}
.danger summary::-webkit-details-marker{display:none}
.danger summary > span:first-child{display:flex;flex-direction:column;gap:2px}
.danger summary strong{font-size:13.5px;font-weight:500}
.danger[open] summary .btn{display:none}
.danger-body{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
.danger-body p{color:var(--ink-3);font-size:12.5px;max-width:62ch}

/* ------------------------------------------------------------------ forms */
form{margin:0}
label{display:block;color:var(--ink-3);font-size:12.5px;margin-bottom:8px}
input[type=text],input[type=password],input[type=email],textarea{display:block;width:100%;height:42px;padding:0 15px;background:rgba(255,255,255,.04);border:1px solid var(--line-2);border-radius:var(--r-sm);color:var(--ink);font:inherit;font-size:13.5px;transition:border-color .2s ease,background .2s ease}
input::placeholder,textarea::placeholder{color:var(--ink-4)}
input:focus,textarea:focus{outline:none;border-color:rgba(255,243,240,.4);background:rgba(255,255,255,.06)}
.saved{display:inline-flex;align-items:center;gap:6px;color:var(--pass);font-size:12.5px;margin-top:12px}
.error{color:var(--stop);border:1px solid rgba(241,155,138,.28);border-radius:var(--r-sm);padding:10px 14px;background:rgba(241,155,138,.06);font-size:12.5px;margin-top:12px}
.why{color:var(--ink-2);border-left:2px solid var(--line-2);padding-left:14px;font-size:13px}
.settings-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px;align-items:start}
.settings-grid .card + .card{margin-top:0}
.settings-form .note{margin-top:14px}

/* ------------------------------------------------------------------- docs */
.doc{padding:8px 30px;max-width:860px}
.doc pre{margin:0;padding:22px 0;white-space:pre-wrap;word-break:break-word;font-family:var(--mono);font-size:12.5px;line-height:1.75;color:var(--ink-2)}

/* ---------------------------------------------------------------- connect */
.copyline{display:flex;align-items:center;gap:10px;padding:5px 5px 5px 16px;border-radius:999px;border:1px solid var(--line-2);background:rgba(0,0,0,.45);min-width:0}
.copyline code{flex:1;min-width:0;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px}
.copyline .btn{flex:none}
.specs{display:flex;flex-wrap:wrap;gap:14px 40px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}
.specs div{display:flex;flex-direction:column;gap:3px}
.specs dt{color:var(--ink-3);font-size:12px}
.specs dd{font-size:13px;color:var(--ink-2)}
.tokens{display:grid;border:1px solid var(--line);border-radius:var(--r)}
.tokens li{display:flex;align-items:center;gap:12px;padding:12px 14px}
.tokens li + li{border-top:1px solid var(--line)}
.token-mark{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:rgba(255,255,255,.05);color:var(--ink-2);flex:none}
.token-body{flex:1;min-width:0;display:flex;flex-direction:column}
.token-body strong{font-size:13.5px;font-weight:500}
.token-body .dim{font-size:12px}
.tokens + .note{margin-top:12px}
.tool-list-wrap summary{cursor:pointer;color:var(--ink-2);font-size:12.5px;list-style:none}
.tool-list-wrap summary::-webkit-details-marker{display:none}
.tool-list-wrap summary:hover{color:var(--ink)}
.tool-list{margin-top:14px;display:grid;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--r-sm);overflow:hidden;max-height:420px;overflow-y:auto}
.tool-list li{display:grid;gap:2px;background:#0d0d0d;padding:12px 14px}
.tool-name{font-size:11.5px;color:var(--ink)}
.tool-title{font-size:12px;color:var(--ink-2)}
.tool-meta{font-size:11px;color:var(--ink-3)}
.tool-desc{font-size:11.5px;color:var(--ink-3);line-height:1.5;margin-top:3px}

/* ----------------------------------------------------------------- footer */
.foot{width:100%;max-width:var(--shell);margin:0 auto;padding:22px var(--gutter) 36px;border-top:1px solid var(--line);display:flex;align-items:center;gap:12px;color:var(--ink-3);font-size:12.5px}
.foot .spacer{flex:1}
.foot-brand{display:inline-flex;align-items:center;gap:8px;color:var(--ink-2)}
.foot-brand svg{width:14px;height:15px}
.foot-endpoint{display:inline-flex;align-items:center;gap:8px;background:none;border:0;padding:6px 0;cursor:pointer;color:var(--ink-3);font-size:12px}
.foot-endpoint:hover{color:var(--ink)}
.foot-endpoint .i{width:13px;height:13px}
.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:80;height:38px;padding:0 18px;display:flex;align-items:center;border-radius:999px;background:var(--ink);color:#0b0b0b;font-size:13px;font-weight:500;box-shadow:0 16px 40px rgba(0,0,0,.5);animation:menu-in .2s var(--ease)}

/* -------------------------------------------------------------- bare pages */
body.bare{align-items:center;justify-content:center;padding:40px 20px}
.bare-main{flex:none;width:100%;max-width:520px;margin:0;padding:36px;border-radius:var(--r-lg);background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow)}
.bare-main .brand{margin-bottom:28px}
.bare-main h1{font-size:30px;margin-bottom:10px}
.bare-main p{color:var(--ink-2);font-size:13.5px;margin:0 0 16px;line-height:1.65}
.secret-form{display:grid;gap:12px;margin:20px 0}
.secret-form .btn{justify-self:start}

/* ------------------------------------------------- setup pages (hero etc.) */
.hero{padding:52px 0 28px}
.hero-row{display:flex;align-items:flex-end;justify-content:space-between;gap:32px;flex-wrap:wrap}
.hero-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;margin-top:16px}
.meta-pill{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink-3)}
.meta-pill b{font-weight:500;color:var(--ink-2)}
.start{display:grid;grid-template-columns:1fr 1fr;border-radius:var(--r-lg);background:var(--card);border:1px solid var(--line);overflow:hidden}
.start-copy{padding:40px}
.start-copy h2{font-size:28px;font-weight:400;letter-spacing:-.04em;margin-bottom:12px}
.start-copy p{color:var(--ink-2)}
.start-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}
.steps{padding:22px 34px;border-left:1px solid var(--line)}
.steps li{display:flex;gap:14px;padding:16px 0;border-bottom:1px solid var(--line)}
.steps li:last-child{border-bottom:0}
.steps strong{display:block;font-size:13.5px;font-weight:500}
.steps p{margin-top:3px;font-size:12.5px;color:var(--ink-3)}
.setup-success{margin-bottom:16px;border-color:rgba(139,230,168,.28)}
.setup-success h2{color:var(--pass);margin-bottom:6px}

/* ------------------------------------------- setup flow (kept, retokened) */
/* -------------------------------------------------------------- composer */
section.composer{margin:0 0 28px}
.composer form{border:1px solid var(--line-2);border-radius:var(--r-lg);background:linear-gradient(180deg,rgba(255,243,240,.05),rgba(255,243,240,.012));padding:20px 22px}
.composer h2{font-size:15px;margin:0 0 12px}
.composer textarea{display:block;width:100%;min-height:84px;resize:vertical;padding:12px 14px;border-radius:12px;border:1px solid var(--line-2);background:#060606;color:var(--ink);font:inherit;font-size:14px;line-height:1.55;transition:border-color .2s ease,box-shadow .2s ease}
.composer textarea::placeholder{color:rgba(255,243,240,.3)}
.composer textarea:focus{outline:none;border-color:rgba(255,243,240,.55);box-shadow:0 0 0 4px rgba(255,243,240,.1)}
.composer-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:14px;flex-wrap:wrap}
.composer-check{display:inline-flex;align-items:center;gap:10px;margin:0;font-size:12.5px;color:var(--ink-3);cursor:pointer}
.composer-check input{width:16px;height:16px;accent-color:var(--accent)}
.composer-check strong{color:var(--ink-2);font-weight:500;margin-right:4px}
.composer-empty{border:1px dashed var(--line-2);border-radius:var(--r-lg);padding:20px 22px}

/* --------------------------------------------------------------- power up */
.powerup{display:flex;align-items:center;gap:16px;max-width:430px;padding:14px 16px 14px 18px;border:1px solid var(--line);border-radius:14px;background:rgba(255,243,240,.018);transition:border-color .2s ease,background .2s ease}
.powerup[data-on=true]{border-color:rgba(255,243,240,.32);background:linear-gradient(180deg,rgba(255,243,240,.09),rgba(255,243,240,.03))}
.powerup-copy{display:flex;flex-direction:column;min-width:0}
.powerup-title{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:500;color:var(--ink)}
.powerup-state{font-size:11px;font-weight:500;color:var(--ink-3);border:1px solid var(--line-2);border-radius:999px;padding:1px 8px}
.powerup[data-on=true] .powerup-state{color:var(--accent);border-color:rgba(255,243,240,.4)}
.powerup-desc{font-size:12px;line-height:1.5;color:var(--ink-3);margin-top:3px}
.switch{flex:none;position:relative;width:40px;height:24px;border-radius:999px;border:1px solid var(--line-2);background:rgba(255,243,240,.08);cursor:pointer;padding:0;transition:background .2s ease,border-color .2s ease}
.switch span{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--ink-2);transition:transform .22s var(--ease),background .2s ease}
.powerup[data-on=true] .switch{background:var(--accent);border-color:var(--accent)}
.powerup[data-on=true] .switch span{transform:translateX(16px);background:#0b0b0b}
.step[data-state=skip] .step-label{color:var(--ink-3)}
.step[data-state=skip] .step-when{font-style:normal}

/* ------------------------------------------------------------------ setup */
.setup-hero{padding-bottom:26px}
.setup-later{flex:none;align-self:flex-start;padding-top:6px}
.setup-rail{margin-top:30px}
.setup-rail ol{list-style:none;margin:0;padding:0;display:flex;gap:8px;flex-wrap:wrap}
.setup-rail li a,.setup-rail .setup-off{display:inline-flex;align-items:center;gap:9px;height:36px;padding:0 14px 0 6px;border:1px solid var(--line);border-radius:999px;font-size:12.5px;color:var(--ink-3);transition:color .2s ease,border-color .2s ease,background .2s ease}
.setup-rail li a:hover{color:var(--ink-2);border-color:var(--line-2)}
.setup-rail li[data-state=done] a{color:var(--ink-2)}
.setup-rail li[data-state=done] .setup-n{color:var(--pass);border-color:rgba(158,213,166,.35);background:rgba(158,213,166,.06)}
.setup-rail li[data-state=current] a,.setup-rail li[data-state=current] .setup-off{color:var(--ink);border-color:var(--line-2);background:rgba(255,243,240,.06)}
.setup-rail li[data-state=current] .setup-n{background:var(--ink);color:#0b0b0b;border-color:var(--ink)}
.setup-n{flex:none;width:24px;height:24px;border:1px solid var(--line-2);border-radius:50%;display:inline-grid;place-items:center;font-family:var(--mono);font-size:10px;color:var(--ink-2);background:rgba(0,0,0,.3)}
.setup-card h2{font-size:16px;letter-spacing:-.02em;font-weight:500;margin:0}
.setup-card p{color:var(--ink-2);font-size:13.5px;margin:0 0 12px}
.setup-card .note{margin-top:12px}
.setup-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start}
.setup-step-head{display:flex;gap:14px;align-items:flex-start;margin-bottom:18px}
.setup-step-head .setup-n{margin-top:-2px}
.setup-step-head .saved{margin:6px 0 0}
.setup-gap{margin-top:14px}
.setup-list{margin:0 0 16px;padding-left:20px;color:var(--ink-2);font-size:13.5px;line-height:1.65}
.setup-list li{margin:0 0 6px}
.setup-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:24px}
.setup-actions .note{margin:0}
.setup-warn{color:var(--warn)!important;border:1px solid rgba(233,189,121,.28);background:rgba(233,189,121,.05);border-radius:var(--r-sm);padding:11px 14px;font-size:12.5px!important;margin-top:16px!important}
section.setup-handoff{margin-top:20px}
.setup-message{margin-top:16px}
.setup-message summary{cursor:pointer;color:var(--ink-3);font-size:12.5px}
.setup-message summary:hover{color:var(--ink-2)}
.setup-message pre{margin:12px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--mono);font-size:11.5px;line-height:1.6;color:var(--ink-2);background:#050505;border:1px solid var(--line);border-radius:var(--r-sm);padding:14px 16px;max-height:280px;overflow:auto}
.setup-form{margin-top:4px}
.setup-connected{display:flex;gap:14px;align-items:center;margin-bottom:16px;font-size:13.5px}
.setup-aside h2{font-size:13px;font-weight:500;letter-spacing:-.01em;color:var(--ink);margin:0 0 6px}
.setup-aside h2.setup-gap{margin-top:22px}
.setup-auto{margin-top:0}
.setup-checks{list-style:none;margin:0 0 22px;padding:2px;border:1px solid var(--line);border-radius:var(--r);background:rgba(0,0,0,.25)}
.setup-checks li{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:14px;transition:background .3s var(--ease)}
.setup-checks li + li{border-top:1px solid var(--line)}
.setup-checks li > div{flex:1;min-width:0;display:flex;flex-direction:column}
.setup-checks strong{font-size:14px;font-weight:500;letter-spacing:-.015em;color:var(--ink-3);transition:color .3s ease}
.check-sub{font-size:12.5px;color:var(--ink-3);line-height:1.5;margin-top:2px}
.check-mark{flex:none;width:22px;height:22px;border-radius:50%;border:1px solid var(--line-2);display:grid;place-items:center;position:relative}
.setup-checks li[data-state=current]{background:rgba(255,243,240,.04)}
.setup-checks li[data-state=current] strong{color:var(--ink)}
.setup-checks li[data-state=current] .check-mark{border-color:transparent;border-top-color:var(--ink);border-right-color:rgba(255,243,240,.35);animation:spin .9s linear infinite}
.setup-checks li[data-state=done] strong{color:var(--ink-2)}
.setup-checks li[data-state=done] .check-mark{background:rgba(158,213,166,.12);border-color:rgba(158,213,166,.45)}
.setup-checks li[data-state=done] .check-mark::after{content:"";width:9px;height:5px;border-left:1.6px solid var(--pass);border-bottom:1.6px solid var(--pass);transform:translateY(-1px) rotate(-45deg)}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.setup-checks li[data-state=current] .check-mark{animation:none;border-color:var(--ink)}}
.setup-recover{border-top:1px solid var(--line);padding-top:16px}
.setup-recover > .note:first-child{margin-top:0;margin-bottom:10px}
.setup-live-note{margin:14px 0 0!important;font-size:12.5px!important;color:var(--warn)!important;min-height:1px}
.setup-live-note:empty{display:none}
.setup-manual{margin-top:22px}
.setup-manual .setup-grid{margin-top:16px}
.choices{border:0;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.choice{position:relative;display:flex;align-items:center;gap:14px;padding:16px 18px;border:1px solid var(--line);border-radius:var(--r);background:rgba(255,243,240,.015);cursor:pointer;margin:0;transition:border-color .2s ease,background .2s ease}
.choice:hover{border-color:var(--line-2);background:rgba(255,243,240,.035)}
.choice input{position:absolute;opacity:0;pointer-events:none}
.choice:has(input:checked){border-color:rgba(255,243,240,.4);background:rgba(255,243,240,.06)}
.choice:has(input:focus-visible){outline:2px solid rgba(255,243,240,.75);outline-offset:3px}
.choice-mark{flex:none;width:38px;height:38px;border-radius:11px;border:1px solid var(--line-2);display:grid;place-items:center;font-family:var(--mono);font-size:13px;background:rgba(0,0,0,.35);color:var(--ink)}
.choice-body{display:flex;flex-direction:column;min-width:0}
.choice-name{color:var(--ink);font-size:14px;font-weight:500;letter-spacing:-.015em}
.choice-blurb{color:var(--ink-3);font-size:12.5px;line-height:1.5;margin-top:2px}
.choice-dot{margin-left:auto;flex:none;width:16px;height:16px;border-radius:50%;border:1px solid var(--line-2)}
.choice:has(input:checked) .choice-dot{border:5px solid var(--ink)}

.setup-card{padding:24px 26px;position:relative}

/* -------------------------------------------------------------- responsive */
@media (max-width:1040px){
  :root{--gutter:24px}
  .proj-grid,.connect-grid{grid-template-columns:minmax(0,1fr) 300px}
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:860px){
  .proj-grid,.connect-grid,.settings-grid,.setup-grid{grid-template-columns:1fr}
  .stepper{grid-auto-flow:row;grid-auto-columns:auto;gap:14px}
  .step{flex-direction:row;align-items:center;padding:0}
  .step::after{top:32px;left:13.5px;right:auto;width:1px;height:14px}
  .decision{grid-template-columns:auto minmax(0,1fr)}
  .decision-action{grid-column:2}
  .start{grid-template-columns:1fr}
  .steps{border-left:0;border-top:1px solid var(--line)}
  .welcome-steps{grid-template-columns:1fr}
  .quota{display:none}
}
@media (max-width:640px){
  :root{--gutter:16px}
  .bar-in{height:58px;gap:12px}
  .brand span{display:none}
  .bar-in > nav{position:static;transform:none;margin-right:auto}
  .bar-in > nav a{padding:0 12px;font-size:13px}
  h1{font-size:30px}
  .page-head{padding:32px 0 22px;align-items:flex-start}
  .page-actions{width:100%}
  .page-actions .btn{flex:1}
  .stats{gap:10px}
  .stat{padding:14px}
  .stat-n{font-size:24px}
  .toolbar{flex-direction:column;align-items:stretch}
  .search input[type=search]{width:100%}
  .search{width:100%}
  .segmented{align-self:flex-start}
  .pgrid-cards{grid-template-columns:1fr}
  .proj-head{align-items:flex-start}
  .proj-head-actions{width:100%}
  .proj-head-actions .btn-primary{flex:1}
  .pmark-lg{width:44px;height:44px;font-size:17px}
  .card{padding:18px}
  .decision{padding:18px}
  .decision-action{grid-column:1 / -1}
  .decision-action .btn,.decision-action form{flex:1}
  .decision-action form .btn{width:100%}
  .inline-form{flex-direction:column}
  .inline-form .btn{width:100%}
  .act{grid-template-columns:14px minmax(0,1fr)}
  .act-side{grid-column:2;align-items:flex-start;flex-direction:row;gap:8px}
  .danger summary{flex-direction:column;align-items:flex-start}
  .welcome{padding:56px 0 24px}
  .welcome-actions .btn{width:100%}
  .foot{flex-direction:column;align-items:flex-start;gap:6px}
  .foot .spacer{display:none}
  .menu-panel{width:min(300px,calc(100vw - 32px))}
  .start-copy{padding:28px 22px}
  .bare-main{padding:28px 22px}
}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;
