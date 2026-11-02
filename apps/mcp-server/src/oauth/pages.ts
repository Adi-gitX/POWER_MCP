/**
 * The pages a person actually sees, and the mailer behind the login link.
 *
 * Self-contained HTML with an inline stylesheet: these render in whatever
 * browser the person already had open, and a consent screen that depends on a
 * separate asset request is a consent screen that can render blank. The chrome
 * lives in ./shell.ts, so these are only the words and the forms.
 */

import { esc, shellPage as shell } from './shell.js';

export { esc };

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Prints the link instead of sending it. Development and CI only. */
export class ConsoleMailer implements Mailer {
  async send(to: string, subject: string, text: string): Promise<void> {
    console.log(`[power] mail to ${to}: ${subject}\n${text}`);
  }
}

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(to: string, subject: string, text: string): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to, subject, text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      // The body can echo the address; the status is enough to act on.
      throw new Error(`could not send mail: ${response.status}`);
    }
  }
}

export function mailerFromEnv(env: NodeJS.ProcessEnv): Mailer {
  if (env.RESEND_API_KEY) return new ResendMailer(env.RESEND_API_KEY, env.POWER_MAIL_FROM ?? 'Power <login@power.build>');
  return new ConsoleMailer();
}

export function loginPage(next: string, error?: string): string {
  return shell(
    'Sign in',
    `<p class="eyebrow">Account</p>
     <h1>Sign in or create an account</h1>
     <p>One link by email. No password to remember, and a new address starts an account.</p>
     ${error ? `<p class="warn">${esc(error)}</p>` : ''}
     <form method="post" action="/login">
       <input type="hidden" name="next" value="${esc(next)}">
       <label for="email">Email address</label>
       <input id="email" name="email" type="email" required autocomplete="email" autofocus
              placeholder="you@example.com" inputmode="email">
       <button class="primary" type="submit">Continue with email</button>
     </form>
     <p class="fine">The link works once and expires in 15 minutes.</p>`,
  );
}

/**
 * Shown whether or not the address is known. Saying "no such account" here
 * turns the form into a way to test whether someone has one.
 *
 * `devLink` is only ever supplied by a loopback server whose mail goes to the
 * console; it is how the flow can be walked end to end without a mailbox.
 */
export function loginSentPage(email: string, devLink?: string): string {
  return shell(
    'Check your email',
    `<p class="eyebrow">Check your inbox</p>
     <h1>One tap to sign in</h1>
     <p>If <strong>${esc(email)}</strong> can sign in, a link is on its way. It works once and expires in 15 minutes.</p>
     <p class="fine">New address? Opening the link creates the account.</p>
     ${
       devLink
         ? `<div class="dev">Development only — no mailer is configured, so the link is printed here instead of sent.<a href="${esc(devLink)}">Open the sign-in link</a></div>`
         : ''
     }
     <p class="again"><a href="/login">Use a different address</a></p>`,
  );
}

export function linkExpiredPage(reason: 'expired' | 'invalid'): string {
  return shell(
    'Link not valid',
    `<p class="eyebrow">Sign-in link</p>
     <h1>${reason === 'expired' ? 'That link has expired' : 'That link is not valid'}</h1>
     <p>${
       reason === 'expired'
         ? 'Sign-in links last 15 minutes and work once.'
         : 'It may have been copied incompletely, or already used.'
     }</p>
     <form method="get" action="/login"><button class="primary" type="submit">Get a new link</button></form>`,
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
    `<p class="eyebrow">Connection request</p>
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
  );
}

export function requestExpiredPage(): string {
  return shell(
    'Request expired',
    `<p class="eyebrow">Connection request</p>
     <h1>That request has expired</h1>
     <p>Start the connection again from the app you were connecting.</p>`,
  );
}
