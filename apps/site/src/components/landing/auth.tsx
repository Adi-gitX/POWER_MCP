'use client';

/**
 * The account screen. A one-tap email link is the only credential Power has,
 * so the form posts to the server's real /login route instead of pretending
 * to have a password. `next` lands the person on their dashboard.
 */

import { ArrowLeft, ArrowRight, Mail } from 'lucide-react';
import { SITE } from '@/lib/site';

const STEPS = [
  { n: '1', title: 'Create your account', copy: 'One email, one tap. No password to remember.' },
  { n: '2', title: 'Connect your AI', copy: 'Add Power to Claude, Cursor or any MCP client.' },
  { n: '3', title: 'Ship your first app', copy: 'Describe it once — approve schema and publish.' },
];

export function AuthScreen() {
  return (
    <div className="lg">
      <aside className="lg-art">
        <div className="lg-glow" aria-hidden="true" />
        <div className="lg-grain" aria-hidden="true" />

        <div className="lg-art-inner">
          <a className="lg-brand" href="/" aria-label="Power home">
            <img src="/assets/img/power-mark.svg" alt="" width={24} height={25} />
            <span>Power</span>
          </a>

          <div className="lg-art-copy">
            <h1>Get started with Power</h1>
            <p>Describe the app. The agent plans it, builds it in the background and verifies every step.</p>

            <ol className="lg-steps">
              {STEPS.map((step, i) => (
                <li key={step.n} className={i === 0 ? 'is-active' : ''}>
                  <span className="lg-step-n">{step.n}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <em>{step.copy}</em>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <p className="lg-art-foot">
            <span className="lg-dot" /> Signed in with a single link. Revoke any session from the dashboard.
          </p>
        </div>
      </aside>

      <main className="lg-main">
        <a className="lg-back" href="/">
          <ArrowLeft size={14} /> Back to site
        </a>

        <div className="lg-form">
          <span className="lg-pill">
            <Mail size={12} /> Passwordless
          </span>

          <h2>Sign in or create an account</h2>
          <p className="lg-sub">
            One link, no password. New here? The same link creates your account and starts your first
            project.
          </p>

          <form className="lg-fields" method="post" action={`${SITE.app}/login`}>
            <input type="hidden" name="next" value="/" />
            <label htmlFor="lg-email">Email</label>
            <input
              id="lg-email"
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              inputMode="email"
              placeholder="you@company.com"
            />
            <button className="lg-submit" type="submit">
              Continue with email <ArrowRight size={15} />
            </button>
          </form>

          <p className="lg-fine">One link by email. It works once and expires in 15 minutes.</p>


          <p className="lg-terms">
            By continuing you agree to the <a href="/terms/">Terms</a> and <a href="/privacy/">Privacy Policy</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
