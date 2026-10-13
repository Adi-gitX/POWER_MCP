/**
 * The two pages a person actually sees, and the mailer behind the login link.
 *
 * Deliberately plain HTML with inline styles: these render in whatever browser
 * the person already had open, they must work before any asset loads, and a
 * consent screen that depends on a stylesheet is a consent screen that can
 * render blank.
 */

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

export const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const shell = (title: string, body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Power</title>
<style>
  :root { color-scheme: light }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#f6f8fc;
         font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif; color:#191a1d }
  main { width:min(30rem,100% - 3rem); background:#fff; border:1px solid #e4e8f1; border-radius:14px; padding:2rem }
  h1 { margin:0 0 .5rem; font-size:1.3rem; letter-spacing:-.01em }
  p { margin:.5rem 0; color:#5b6270 }
  label { display:block; font-size:.85rem; font-weight:600; margin:1.2rem 0 .35rem }
  input[type=email] { width:100%; box-sizing:border-box; padding:.7rem .8rem; font:inherit;
                      border:1px solid #cfd6e4; border-radius:8px }
  button { font:inherit; font-weight:600; padding:.7rem 1.1rem; border-radius:8px; cursor:pointer; border:1px solid transparent }
  .primary { background:#2563eb; color:#fff; width:100%; margin-top:1.2rem }
  .primary:hover { background:#1d4ed8 }
  .secondary { background:#fff; color:#191a1d; border-color:#cfd6e4 }
  .row { display:flex; gap:.6rem; margin-top:1.4rem }
  .row form { flex:1 }
  .row button { width:100% }
  .host { font-weight:600; color:#191a1d }
  ul { margin:.6rem 0; padding-left:1.1rem; color:#5b6270 }
  .who { margin-top:1.4rem; padding-top:1rem; border-top:1px solid #e4e8f1; font-size:.85rem; color:#9aa1ad }
  .warn { background:#fdf1ef; border:1px solid #f3c7c0; color:#c0392b; padding:.7rem .8rem; border-radius:8px; font-size:.9rem }
</style></head><body><main>${body}</main></body></html>`;

export function loginPage(next: string, error?: string): string {
  return shell(
    'Sign in',
    `<h1>Sign in to Power</h1>
     <p>We email you a link. No password to forget.</p>
     ${error ? `<p class="warn">${esc(error)}</p>` : ''}
     <form method="post" action="/login">
       <input type="hidden" name="next" value="${esc(next)}">
       <label for="email">Email address</label>
       <input id="email" name="email" type="email" required autocomplete="email" autofocus
              placeholder="you@example.com" inputmode="email">
       <button class="primary" type="submit">Email me a link</button>
     </form>`,
  );
}

/**
 * Shown whether or not the address is known. Saying "no such account" here
 * turns the form into a way to test whether someone has one.
 */
export function loginSentPage(email: string): string {
  return shell(
    'Check your email',
    `<h1>Check your email</h1>
     <p>If <strong>${esc(email)}</strong> has a Power account, a sign-in link is on its way.
        It works once and expires in 15 minutes.</p>
     <p>You can close this tab once you have clicked it.</p>`,
  );
}

export function linkExpiredPage(reason: 'expired' | 'invalid'): string {
  return shell(
    'Link not valid',
    `<h1>${reason === 'expired' ? 'That link has expired' : 'That link is not valid'}</h1>
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
    `<h1>${esc(args.clientName)} wants access to your Power account</h1>
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
    `<h1>That authorisation request has expired</h1>
     <p>Start the connection again from the app you were connecting.</p>`,
  );
}
