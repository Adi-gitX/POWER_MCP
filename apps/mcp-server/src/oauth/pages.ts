/**
 * The pages a person actually sees, and the mailer behind the login link.
 *
 * Self-contained HTML with an inline stylesheet: these render in whatever
 * browser the person already had open, and a consent screen that depends on a
 * separate asset request is a consent screen that can render blank. The chrome
 * lives in ./shell.ts, so these are only the words and the forms.
 */

import { esc, legalUrl, shellPage as shell } from './shell.js';

export { esc };

export interface Mailer {
  /** Resolves with the provider's message id when it gives one. */
  send(to: string, subject: string, text: string, html?: string): Promise<{ id?: string }>;
}

/** Prints the mail instead of sending it. Development and CI only. */
export class ConsoleMailer implements Mailer {
  async send(to: string, subject: string, text: string): Promise<{ id?: string }> {
    console.log(`[power] mail to ${to}: ${subject}\n${text}`);
    return {};
  }
}

export class MailError extends Error {}

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(to: string, subject: string, text: string, html?: string): Promise<{ id?: string }> {
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: this.from, to, subject, text, ...(html ? { html } : {}) }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      throw new MailError(`could not reach the mail provider: ${(error as Error).name}`);
    }
    const body = (await response.json().catch(() => ({}))) as { id?: string; name?: string };
    if (!response.ok) {
      // The provider's message can echo the address; its error type cannot.
      throw new MailError(`could not send mail: ${response.status}${body.name ? ` ${body.name}` : ''}`);
    }
    return { id: body.id };
  }
}

export function mailerFromEnv(env: NodeJS.ProcessEnv): Mailer {
  // Resend's shared sender works before a domain is verified, for the
  // account's own address and Resend's test inboxes. Production sets its own.
  if (env.RESEND_API_KEY) return new ResendMailer(env.RESEND_API_KEY, env.POWER_MAIL_FROM ?? 'Power <onboarding@resend.dev>');
  return new ConsoleMailer();
}

// ------------------------------------------------------------------ the code

/** The sign-in email: the code first and large, the link as a fallback. */
export function codeEmail(code: string, link: string, minutes: number): { subject: string; text: string; html: string } {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const text = [
    `Your Power sign-in code is ${spaced}`,
    '',
    `Enter it on the sign-in page. It works once and expires in ${minutes} minutes.`,
    '',
    `Or sign in with this link instead: ${link}`,
    '',
    "If you didn't try to sign in, ignore this email. Nobody can sign in without the code.",
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#0b0b0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#fff3f0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#121212;border:1px solid #2a2a2a;border-radius:18px">
<tr><td style="padding:32px 32px 8px;font-size:15px;font-weight:600;letter-spacing:-.02em">Power</td></tr>
<tr><td style="padding:8px 32px 0;font-size:22px;font-weight:600;letter-spacing:-.03em">Your sign-in code</td></tr>
<tr><td style="padding:12px 32px 0;font-size:14px;line-height:1.6;color:#b8aeab">Enter it on the sign-in page. It works once and expires in ${minutes} minutes.</td></tr>
<tr><td style="padding:22px 32px"><div style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:34px;font-weight:600;letter-spacing:.24em;text-align:center;background:#000;border:1px solid #2a2a2a;border-radius:12px;padding:18px 0;color:#fff3f0">${esc(spaced)}</div></td></tr>
<tr><td style="padding:0 32px 8px;font-size:13px;line-height:1.6;color:#8f8683">Or <a href="${esc(link)}" style="color:#fff3f0">sign in with this link</a> instead.</td></tr>
<tr><td style="padding:14px 32px 30px;font-size:12px;line-height:1.6;color:#6f6764;border-top:1px solid #222">If you didn&rsquo;t try to sign in, ignore this email. Nobody can sign in without the code.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: `Your Power sign-in code: ${spaced}`, text, html };
}

const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 5l7 7-7 7"/></svg>';

export function loginPage(next: string, error?: string, email = ''): string {
  return shell(
    'Sign in',
    `<span class="eyebrow">Passwordless</span>
     <h1>Sign in or create an account</h1>
     <p>We email you a 6-digit code. No password, and a new address creates your account and starts your first project.</p>
     ${error ? `<p class="warn" role="alert">${esc(error)}</p>` : ''}
     <form method="post" action="/login">
       <input type="hidden" name="next" value="${esc(next)}">
       <label for="email">Email</label>
       <input id="email" name="email" type="email" required autocomplete="email" autofocus
              placeholder="you@company.com" inputmode="email" value="${esc(email)}">
       <button class="primary" type="submit">Continue with email ${ARROW}</button>
     </form>
     <p class="fine">The code works once and expires in 10 minutes.</p>
     <p class="lg-terms">By continuing you agree to the <a href="${esc(legalUrl('terms'))}">Terms</a> and <a href="${esc(legalUrl('privacy'))}">Privacy Policy</a>.</p>`,
  );
}

export interface VerifyPageState {
  email: string;
  /** Seconds until another code can be sent; 0 means now. */
  resendIn: number;
  error?: string;
  notice?: string;
  /** No more tries on this code: only a new one helps. */
  locked?: boolean;
  /** Loopback with no mailer: the code is shown here so the flow can be walked without an inbox. */
  devCode?: string;
}

/**
 * Where the code goes. The challenge itself is in an HttpOnly cookie, so the
 * address never travels in a URL and the page cannot be replayed from history.
 */
export function verifyPage(s: VerifyPageState): string {
  const boxes = Array.from({ length: 6 }, (_, i) =>
    `<input type="text" inputmode="numeric" pattern="[0-9]" maxlength="1" aria-label="Digit ${i + 1} of 6"${i === 0 ? ' autocomplete="one-time-code"' : ' autocomplete="off"'}${s.locked ? ' disabled' : ''}>`,
  ).join('');
  return shell(
    'Enter your code',
    `<span class="eyebrow">Check your inbox</span>
     <h1>Enter your code</h1>
     <p>We sent a 6-digit code to <strong>${esc(s.email)}</strong>. It works once and expires in 10 minutes.</p>
     ${s.notice ? `<p class="ok" role="status">${esc(s.notice)}</p>` : ''}
     ${s.error ? `<p class="warn" role="alert"${s.locked ? '' : ' data-code-error'}>${esc(s.error)}</p>` : ''}
     <form method="post" action="/login/verify" id="code-form" novalidate>
       <label for="code">Sign-in code</label>
       <input id="code" name="code" type="text" class="otp-field" required autocomplete="one-time-code" inputmode="numeric"
              pattern="[0-9]{6}" maxlength="6" placeholder="000000" spellcheck="false"${s.locked ? ' disabled' : ' autofocus'}>
       <div class="otp${s.error && !s.locked ? ' is-error' : ''}" data-otp hidden>${boxes}</div>
       <div class="otp-react dark" data-otp-react hidden></div>
       <button class="primary" type="submit"${s.locked ? ' disabled' : ''}>Verify and continue ${ARROW}</button>
     </form>
     ${
       s.devCode
         ? `<div class="dev">Development only — no mailer is configured, so the code is shown here instead of sent: <strong class="mono">${esc(s.devCode)}</strong></div>`
         : ''
     }
     <form method="post" action="/login/resend" class="resend">
       <span class="fine" data-resend-note>${s.resendIn > 0 ? `Didn’t get it? You can send a new code in <span data-resend-in>${s.resendIn}</span>s.` : 'Didn’t get it? Check spam, or send a new code.'}</span>
       <button class="secondary" type="submit" data-resend${s.resendIn > 0 ? ' disabled' : ''}>Send a new code</button>
     </form>
     <p class="again"><a href="/login">Use a different address</a></p>
     <link rel="stylesheet" href="/assets/otp/otp.css">
     <script>
     // The plain boxes are the fallback: they run only if the component
     // bundle cannot load, so the two never fight over the form.
     window.__powerOtpFallback = () => {
       if (window.__powerOtpFallbackRan) return;
       window.__powerOtpFallbackRan = true;
       // Six boxes in front of one real field. The field is what the form
       // submits and what a password manager or the OS fills; the boxes only
       // ever write whole digits into it, so nothing is lost mid-keystroke.
       const field = document.getElementById('code');
       const wrap = document.querySelector('[data-otp]');
       const form = document.getElementById('code-form');
       if (field && wrap && !field.disabled) {
         const boxes = [...wrap.querySelectorAll('input')];
         wrap.hidden = false;
         field.tabIndex = -1;
         field.removeAttribute('autofocus');
         const sync = () => {
           field.value = boxes.map((b) => b.value).join('');
           if (/^\\d{6}$/.test(field.value) && !form.dataset.sent) {
             form.dataset.sent = '1';
             form.requestSubmit ? form.requestSubmit() : form.submit();
           }
         };
         const fill = (start, text) => {
           const digits = text.replace(/\\D/g, '').slice(0, 6 - start).split('');
           digits.forEach((d, i) => { boxes[start + i].value = d; });
           boxes[Math.min(start + digits.length, 5)].focus();
           sync();
         };
         boxes.forEach((box, i) => {
           box.addEventListener('input', () => {
             const v = box.value.replace(/\\D/g, '');
             if (v.length > 1) return fill(i, v);   // autofill or a fast paste lands in one box
             box.value = v;
             if (v && i < 5) boxes[i + 1].focus();
             sync();
           });
           box.addEventListener('keydown', (e) => {
             if (e.key === 'Backspace' && !box.value && i > 0) { boxes[i - 1].value = ''; boxes[i - 1].focus(); sync(); e.preventDefault(); }
             else if (e.key === 'ArrowLeft' && i > 0) { boxes[i - 1].focus(); e.preventDefault(); }
             else if (e.key === 'ArrowRight' && i < 5) { boxes[i + 1].focus(); e.preventDefault(); }
           });
           box.addEventListener('paste', (e) => { e.preventDefault(); fill(i, (e.clipboardData || window.clipboardData).getData('text')); });
           box.addEventListener('focus', () => box.select());
         });
         // The OS can autofill the hidden field directly.
         field.addEventListener('input', () => fill(0, field.value));
         form.addEventListener('submit', (e) => {
           sync();
           if (!/^\\d{6}$/.test(field.value)) { e.preventDefault(); delete form.dataset.sent; wrap.classList.add('is-error'); boxes[field.value.length]?.focus(); }
         });
         boxes[0].focus();
       }
     };
     setTimeout(() => { if (document.getElementById('code-form')?.dataset.otp !== 'react') window.__powerOtpFallback(); }, 2500);
     (() => {
       const left = document.querySelector('[data-resend-in]');
       const button = document.querySelector('[data-resend]');
       if (left && button) {
         let n = Number(left.textContent);
         const timer = setInterval(() => {
           n -= 1;
           if (n > 0) { left.textContent = String(n); return; }
           clearInterval(timer);
           button.disabled = false;
           document.querySelector('[data-resend-note]').textContent = 'Didn’t get it? Check spam, or send a new code.';
         }, 1000);
       }
     })();
     </script>
     <script src="/assets/otp/otp.js" defer onerror="window.__powerOtpFallback()"></script>`,
  );
}

export function codeEndedPage(reason: 'expired' | 'used' | 'missing'): string {
  return shell(
    'Start again',
    `<span class="eyebrow">Sign-in code</span>
     <h1>${reason === 'expired' ? 'That code has expired' : reason === 'used' ? 'That code was already used' : 'Your sign-in has timed out'}</h1>
     <p>${reason === 'expired' ? 'Codes last 10 minutes.' : 'Codes work once.'} Enter your address again and we’ll send a new one.</p>
     <form method="get" action="/login"><button class="primary" type="submit">Get a new code</button></form>`,
  );
}

export function linkExpiredPage(reason: 'expired' | 'invalid'): string {
  return shell(
    'Link not valid',
    `<span class="eyebrow">Sign-in link</span>
     <h1>${reason === 'expired' ? 'That link has expired' : 'That link is not valid'}</h1>
     <p>${
       reason === 'expired'
         ? 'Sign-in links last 15 minutes and work once.'
         : 'It may have been copied incompletely, or already used.'
     }</p>
     <form method="get" action="/login"><button class="primary" type="submit">Get a new code</button></form>`,
  );
}

export function consentPage(args: {
  clientName: string;
  redirectHost: string;
  email: string;
  requestId: string;
  csrf: string;
}): string {
  return shell(
    'Authorise',
    `<span class="eyebrow">Connection request</span>
     <h1>${esc(args.clientName)} wants access to your Power account</h1>
     <p>It is asking to connect as <span class="host">${esc(args.redirectHost)}</span>.</p>
     <p>If you allow this, it will be able to:</p>
     <ul>
       <li>create projects, write code and run their tests</li>
       <li>propose database changes for you to approve</li>
       <li>publish to the hosting account you connect</li>
     </ul>
     <p>Approving a plan and confirming a publish still happen here, in your browser. It cannot do either for you.</p>
     <div class="row">
       <form method="post" action="/oauth/consent">
         <input type="hidden" name="req" value="${esc(args.requestId)}">
         <input type="hidden" name="csrf" value="${esc(args.csrf)}">
         <input type="hidden" name="decision" value="deny">
         <button class="secondary" type="submit">Cancel</button>
       </form>
       <form method="post" action="/oauth/consent">
         <input type="hidden" name="req" value="${esc(args.requestId)}">
         <input type="hidden" name="csrf" value="${esc(args.csrf)}">
         <input type="hidden" name="decision" value="allow">
         <button class="primary" type="submit" style="margin-top:0">Allow</button>
       </form>
     </div>
     <p class="who">Signed in as ${esc(args.email)} · <a href="/logout">not you?</a></p>`,
    { step: 1 },
  );
}

export function requestExpiredPage(): string {
  return shell(
    'Request expired',
    `<span class="eyebrow">Connection request</span>
     <h1>That request has expired</h1>
     <p>Start the connection again from the app you were connecting.</p>`,
  );
}
