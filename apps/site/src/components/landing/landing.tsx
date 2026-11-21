'use client';

/**
 * The marketing surface. One prompt box, one pipeline, one promise: the agent
 * does the work and the gates decide what ships. Everything here is static
 * except the composer, the mobile menu and the run card that starts logging
 * when it scrolls into view.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  CircleDot,
  Database,
  Globe,
  Menu,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';

const NAV = [
  { href: '#product', label: 'Product' },
  { href: '#pipeline', label: 'Pipeline' },
  { href: '/proof/', label: 'Proof' },
  { href: '/pricing/', label: 'Pricing' },
  { href: '/docs/', label: 'Docs' },
] as const;

const PLACEHOLDERS = [
  'Build a booking app with Stripe checkout and a Postgres database…',
  'Ship an internal dashboard that reads from our warehouse…',
  'Make a waitlist page with auth and a verified deploy…',
  'Turn this Figma into a working storefront…',
];

const STAGES = [
  { n: '01', name: 'Plan', copy: 'The agent writes the spec, the file map and the checks before it touches code.' },
  { n: '02', name: 'Context', copy: 'It loads only the skills, schemas and history the task actually needs.' },
  { n: '03', name: 'Build', copy: 'Real commands run in a sandbox — installs, migrations, tests, not prose.' },
  { n: '04', name: 'Verify', copy: 'Deterministic gates re-run every check and refuse anything that fails.' },
  { n: '05', name: 'Ship', copy: 'A live URL, a database with a safety copy and a receipt for the whole run.' },
];

const LOG = [
  { t: '0.0s', text: 'plan  · 12 files, 4 checks, 2 approvals', tone: 'dim' },
  { t: '0.6s', text: 'context  · skills: postgres, stripe, next', tone: 'dim' },
  { t: '1.4s', text: 'build  · pnpm install  ✓', tone: 'ok' },
  { t: '3.1s', text: 'build  · migrate 0002_orders  ✓', tone: 'ok' },
  { t: '5.7s', text: 'test  · 46 passed, 0 failed', tone: 'ok' },
  { t: '7.2s', text: 'gate  · contract, secrets, bundle', tone: 'dim' },
  { t: '8.9s', text: 'verify  · preview healthy  ✓', tone: 'ok' },
];

const CAPS = [
  {
    icon: ShieldCheck,
    title: 'Project Contract',
    copy: 'The decisions your agent never forgets — stack, schema, tone and the two things it must ask before changing.',
  },
  {
    icon: Sparkles,
    title: 'Executable skills',
    copy: 'Turn expertise into steps the agent runs, not paragraphs it rereads. Versioned, searchable, reusable.',
  },
  {
    icon: Database,
    title: 'Scoped access',
    copy: 'Each run gets only the tools and rows it needs. No shared tenant, no keys in the chat, no surprise bill.',
  },
];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return reduced;
}

export function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [ph, setPh] = useState(0);
  const [live, setLive] = useState(false);
  const reduced = usePrefersReducedMotion();
  const runRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setPh((i) => (i + 1) % PLACEHOLDERS.length), 4200);
    return () => window.clearInterval(id);
  }, [reduced]);

  useEffect(() => {
    document.body.classList.toggle('lp-menu-open', menu);
    return () => document.body.classList.remove('lp-menu-open');
  }, [menu]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const node = runRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLive(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  function start(e: React.FormEvent) {
    e.preventDefault();
    const q = prompt.trim();
    window.location.href = q ? `/app/?idea=${encodeURIComponent(q)}` : '/app/';
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }

  return (
    <div className="lp">
      <link
        rel="preload"
        href="/assets/fonts/instrument-serif-italic.woff2"
        as="font"
        type="font/woff2"
        crossOrigin=""
      />

      <header className={`lp-nav${scrolled ? ' is-scrolled' : ''}${menu ? ' is-open' : ''}`}>
        <div className="lp-nav-inner">
          <a className="lp-brand" href="/" aria-label="Power home">
            <img src="/assets/img/power-mark.svg" alt="" width={26} height={27} />
            <span>Power</span>
          </a>

          <nav className="lp-links" aria-label="Primary">
            {NAV.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="lp-nav-right">
            <a className="lp-signin" href="/login">
              Sign in
            </a>
            <a className="lp-cta" href="/login">
              Start building <ArrowRight size={15} />
            </a>
            <button
              className="lp-burger"
              type="button"
              aria-label={menu ? 'Close menu' : 'Open menu'}
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
            >
              {menu ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        <div className="lp-sheet" aria-hidden={!menu} inert={!menu}>
          {NAV.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setMenu(false)}>
              {item.label}
            </a>
          ))}
          <a href="/login" onClick={() => setMenu(false)}>
            Sign in
          </a>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-art" aria-hidden="true" />
        <div className="lp-hero-grain" aria-hidden="true" />

        <div className="lp-hero-inner">
          <a className="lp-eyebrow" href="#pipeline">
            <span className="lp-pulse" /> MCP-native build agent
            <ChevronRight size={13} />
          </a>

          <h1>
            Describe it.
            <br />
            <em>Power ships it checked.</em>
          </h1>

          <p className="lp-hero-sub">
            One sentence starts an agent run. Power plans the work, builds it in a sandbox, verifies every step
            against real gates and hands back a receipt — not a promise.
          </p>

          <form className="lp-composer" onSubmit={start}>
            <label className="lp-sr" htmlFor="lp-prompt">
              Describe the app you want to build
            </label>
            <textarea
              id="lp-prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={PLACEHOLDERS[ph]}
              onKeyDown={onComposerKeyDown}
            />
            <div className="lp-composer-foot">
              <span className="lp-engine">
                <span className="lp-engine-dot" /> Power Engine · 42 tools
              </span>
              <span className="lp-composer-hint">Enter to start · Shift + Enter for a new line</span>
              <button className="lp-send" type="submit" aria-label="Start a run">
                <ArrowUp size={18} />
              </button>
            </div>
          </form>

          <p className="lp-hero-note">
            Works with <b>Claude</b>, <b>Cursor</b>, <b>Windsurf</b> and any MCP client.
            <a href="/app/">
              Watch a run <ArrowRight size={12} />
            </a>
          </p>
        </div>
      </section>

      <section className="lp-logos" aria-label="Works inside">
        <span className="lp-logos-label">Runs inside</span>
        <div className="lp-logos-row">
          <span>Claude</span>
          <span>Cursor</span>
          <span>Windsurf</span>
          <span>VS Code</span>
          <span>Raycast</span>
        </div>
      </section>

      <section className="lp-pipeline" id="pipeline">
        <div className="lp-shell lp-pipe-grid">
          <div className="lp-pipe-copy">
            <p className="lp-kicker">The pipeline</p>
            <h2>
              A bot that plans,
              <br />
              then does the work.
            </h2>
            <p className="lp-lede">
              Chat is the input, not the product. Every run is a visible chain of decisions, tool calls and
              checks — so you can watch it work and audit what it shipped.
            </p>

            <ol className="lp-stages">
              {STAGES.map((s) => (
                <li key={s.n}>
                  <span className="lp-stage-n">{s.n}</span>
                  <div>
                    <h3>{s.name}</h3>
                    <p>{s.copy}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className={`lp-run${live ? ' is-live' : ''}`} ref={runRef}>
            <div className="lp-run-head">
              <span className="lp-run-title">
                <Terminal size={14} /> run_4812
              </span>
              <span className="lp-run-badge">
                <CircleDot size={12} /> verifying
              </span>
            </div>

            <div className="lp-run-body">
              <p className="lp-run-prompt">“Build a booking app with Stripe checkout and Postgres.”</p>
              <ul className="lp-log">
                {LOG.map((line) => (
                  <li key={line.text} className={line.tone}>
                    <span>{line.t}</span>
                    {line.text}
                  </li>
                ))}
                <li className="lp-cursor">
                  <span>9.1s</span>
                  <i className="lp-blink" />
                </li>
              </ul>
            </div>

            <div className="lp-run-foot">
              <div className="lp-bar">
                <i />
              </div>
              <div className="lp-run-files">
                <span>
                  <Check size={12} /> 12 files
                </span>
                <span>
                  <Check size={12} /> 46 tests
                </span>
                <span>
                  <Check size={12} /> contract
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-product" id="product">
        <div className="lp-shell">
          <p className="lp-kicker">The dashboard</p>
          <h2 className="lp-center">
            Watch the whole pipeline,
            <br />
            not just the chat.
          </h2>
          <p className="lp-center lp-lede">
            Plan, tools, files, gates and cost for every run. Approve the two decisions that matter — schema and
            publish — from the same screen your agent works in.
          </p>
        </div>

        <div className="lp-shot-band">
          <div className="lp-shot" role="img" aria-label="Power pipeline dashboard">
            <div className="lp-shot-top">
              <span className="lp-shot-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="lp-shot-url">
                <Globe size={11} /> app.usepower.dev/atlas
              </span>
              <span className="lp-shot-live">
                <i /> Live
              </span>
            </div>

            <div className="lp-shot-body">
              <aside className="lp-mock-rail">
                <span className="lp-mock-brand">
                  <img src="/assets/img/power-mark.svg" alt="" width={18} height={19} /> Power
                </span>
                <span className="lp-mock-project is-active">Atlas booking</span>
                <span className="lp-mock-project">Ledgerly</span>
                <span className="lp-mock-project">Docs site</span>
                <span className="lp-mock-new">+ New project</span>
              </aside>

              <div className="lp-mock-main">
                <div className="lp-mock-head">
                  <div>
                    <h3>Atlas booking</h3>
                    <p>run_4812 · 9.1s · $0.42</p>
                  </div>
                  <span className="lp-mock-verified">
                    <ShieldCheck size={13} /> Verified
                  </span>
                </div>

                <ol className="lp-mock-timeline">
                  {['Plan', 'Context', 'Build', 'Verify', 'Ship'].map((name, i) => (
                    <li key={name} className={i < 4 ? 'done' : 'next'}>
                      <span className="lp-mock-dot">{i < 4 ? <Check size={11} /> : '5'}</span>
                      <div>
                        <strong>{name}</strong>
                        <em>
                          {i === 0 && '12 files · 4 checks'}
                          {i === 1 && '3 skills loaded'}
                          {i === 2 && 'pnpm install, 2 migrations'}
                          {i === 3 && '46 tests · 3 gates'}
                          {i === 4 && 'awaiting your approval'}
                        </em>
                      </div>
                      <span className="lp-mock-time">{['0.4s', '0.8s', '4.3s', '2.1s', '—'][i]}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <aside className="lp-mock-side">
                <div className="lp-mock-card">
                  <h4>Receipt</h4>
                  <p>Everything the run touched, hash-sealed.</p>
                  <span className="lp-mock-pill">72 checks passed</span>
                </div>
                <div className="lp-mock-card">
                  <h4>Preview</h4>
                  <div className="lp-mock-thumb">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-caps">
        <div className="lp-shell">
          <p className="lp-kicker">What it remembers</p>
          <h2 className="lp-center">
            Context that survives
            <br />
            the conversation.
          </h2>

          <div className="lp-cap-grid">
            <article className="lp-cap-art">
              <img
                src="/assets/img/art/marble-figures.jpg"
                alt=""
                loading="lazy"
                decoding="async"
              />
              <div>
                <h3>One contract, every agent.</h3>
                <p>
                  Stack, conventions and hard limits live in the project — so a new session, model or teammate
                  starts informed instead of guessing.
                </p>
              </div>
            </article>

            {CAPS.map(({ icon: Icon, title, copy }) => (
              <article className="lp-cap" key={title}>
                <span className="lp-cap-icon">
                  <Icon size={18} />
                </span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-metrics">
        <div className="lp-metrics-art" aria-hidden="true" />
        <div className="lp-shell lp-metrics-grid">
          <div>
            <strong>42</strong>
            <span>tools behind one connection</span>
          </div>
          <div>
            <strong>288</strong>
            <span>checks in the gate suite</span>
          </div>
          <div>
            <strong>0</strong>
            <span>unverified publishes</span>
          </div>
        </div>
      </section>

      <section className="lp-close">
        <div className="lp-close-art" aria-hidden="true" />
        <div className="lp-shell lp-close-inner">
          <p className="lp-kicker lp-kicker-light">Start tonight</p>
          <h2>
            Your next app is
            <br />
            <em>one sentence away.</em>
          </h2>
          <div className="lp-close-actions">
            <a className="lp-cta lp-cta-lg" href="/login">
              Start building <ArrowRight size={16} />
            </a>
            <a className="lp-ghost lp-ghost-light" href="/docs/">
              Read the docs
            </a>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-shell lp-foot-top">
          <div className="lp-foot-brand">
            <a className="lp-brand lp-brand-light" href="/">
              <img src="/assets/img/power-mark.svg" alt="" width={26} height={27} />
              <span>Power</span>
            </a>
            <p>Ship it checked.</p>
          </div>

          <div className="lp-foot-cols">
            <div>
              <h4>Product</h4>
              <a href="/#product">Overview</a>
              <a href="/pricing/">Pricing</a>
              <a href="/proof/">Proof</a>
              <a href="/updates/">Changelog</a>
            </div>
            <div>
              <h4>Developers</h4>
              <a href="/docs/">Docs</a>
              <a href="/docs/tools/">Tools</a>
              <a href="/docs/how-it-works/">How it works</a>
              <a href="/blog/">Blog</a>
            </div>
            <div>
              <h4>Company</h4>
              <a href="/privacy/">Privacy</a>
              <a href="/terms/">Terms</a>
              <a href={`mailto:hello@usepower.dev`}>Contact</a>
            </div>
          </div>
        </div>

        <div className="lp-shell lp-foot-bottom">
          <span>© 2026 Power</span>
          <span>Built and verified by Power</span>
        </div>
      </footer>
    </div>
  );
}
