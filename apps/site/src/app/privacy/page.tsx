/**
 * The privacy policy.
 *
 * Every factual claim on this page was read out of the code it describes:
 * `apps/mcp-server/src/pgstore.ts` for the tenant tables, `secrets-pg.ts` for
 * the credential encryption, `oauth/schema.ts` for what sign-in stores, and
 * `oauth/pages.ts` for the one place an address leaves the server. The trap
 * here is the opposite of the usual one: a policy is easy to pad with the
 * reassuring sentences every other policy has, and each padded sentence is a
 * promise the server does not keep. If a behaviour changes, this page is part
 * of the change, not a document someone updates later.
 *
 * Nothing is named that the repository cannot prove. There is no legal entity,
 * postal address or governing law below, because inventing one would be worse
 * than omitting it, and a reader can tell the difference.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Reveal } from '@/components/motion/reveal';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What Power collects, where it is stored, who else can see it, how long it is kept, and how to take everything with you. Power runs no inference, so your prompts are never sent to a model by us.',
};

const LAST_UPDATED = '5 October 2026';

const SECTIONS: [string, string][] = [
  ['collect', 'What we collect'],
  ['not', 'What we never see'],
  ['use', 'How we use it'],
  ['storage', 'Where it is stored'],
  ['sharing', 'Who else can see it'],
  ['retention', 'How long we keep it'],
  ['export', 'Taking your data with you'],
  ['security', 'Security'],
  ['changes', 'Changes to this policy'],
  ['contact', 'Contact'],
];

/** Third column is deliberately the storage shape, not a reassurance. */
const COLLECTED: [string, string, string][] = [
  [
    'Your email address',
    'The only sign-in identifier. There is no password, so a link sent to this address is how you prove the account is yours.',
    'One row in users, readable',
  ],
  [
    'Sign-in links and sessions',
    'A link works once and expires. A browser session keeps you signed in on the project pages.',
    'sha256 hash only, with the IP and browser that asked',
  ],
  [
    'OAuth tokens',
    'What lets your AI client call Power on your behalf after you consent, and keeps calling without asking you again.',
    'sha256 hash only, with an expiry',
  ],
  [
    'Your project',
    'The spec, the files, the test results, the gate refusals and the full git history. This is the work itself.',
    'A real git repository, plus rows scoped to your user id',
  ],
  [
    'Your project database',
    'The live branch your app reads, and the safe copy your AI is allowed to write to.',
    'A Postgres database per branch, on disk',
  ],
  [
    'Credentials you enter',
    'A hosting token or an API key your app needs. You type it into a browser form that your AI client never sees.',
    'AES-256-GCM encrypted, with a short fingerprint so you can tell which key it is',
  ],
  [
    'A record of what happened',
    'Which tool ran, which phase it moved the run into, when you approved a plan and when you confirmed a publish.',
    'An append-only log scoped to your user id',
  ],
  [
    'Build actions used',
    'The count your plan is metered against. A refused call is refunded before the response is sent, so it is not counted.',
    'A count, not the contents of the call',
  ],
];

export default function PrivacyPage() {
  return (
    <>
      <section className="pb-8 pt-16">
        <div className="wrap max-w-3xl">
          <span className="eyebrow">Privacy</span>
          <h1 className="serif mt-6 text-[clamp(2.4rem,5.4vw,4rem)] leading-[1.02] tracking-tight">
            We hold your work, not your thinking.
          </h1>
          <p className="mt-5 text-[1.15rem] leading-relaxed text-ink-2">
            Power is an MCP server. Your own AI client sends it tool calls, it checks the work and
            keeps the project. It runs no model of its own, so the conversation you have with your
            AI is not ours to collect.
          </p>
          <p className="mono mt-6 text-[0.76rem] text-ink-2">Last updated {LAST_UPDATED}</p>
        </div>
      </section>

      <section className="pb-8">
        <div className="wrap max-w-3xl">
          <Reveal>
            <div className="rounded-[18px] border border-accent bg-accent-wash p-7">
              <h2 className="text-[1.15rem] font-semibold">The short version</h2>
              <ul className="mt-4 space-y-2.5 text-[0.95rem] leading-relaxed text-ink-2">
                {[
                  'We store your email address to sign you in, and your project so you can come back to it.',
                  'We do not run inference. Power never sends your prompts to a model, because it has no model to send them to.',
                  'Credentials you enter are encrypted before they are written, and are never returned to your AI client or printed in a log.',
                  'Your code lives in a git repository. Export is free on every plan, including free, and always available.',
                  'When you publish, the app deploys to your own hosting account using your own credential.',
                  'We do not sell your data, and we do not share it with advertisers or data brokers.',
                ].map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <span className="mt-[0.1rem] text-pass">✓</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="pb-4">
        <div className="wrap max-w-3xl">
          <nav
            aria-label="Sections of this policy"
            className="grid gap-x-8 gap-y-2 rounded-[14px] border border-line bg-paper-2 p-6 text-[0.92rem] sm:grid-cols-2"
          >
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="text-ink-2 transition-colors hover:text-ink">
                {label}
              </a>
            ))}
          </nav>
        </div>
      </section>

      <section className="section pt-12">
        <div className="wrap max-w-3xl space-y-14">
          <Section id="collect" title="What we collect">
            <P>
              Everything below exists because something would not work without it. There is no
              analytics profile, no advertising identifier and no tracking of you across other
              sites.
            </P>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-left text-[0.92rem]">
                <thead>
                  <tr className="border-b border-line-2">
                    <th className="py-3 pr-5 font-semibold text-ink">What</th>
                    <th className="py-3 pr-5 font-semibold text-ink">Why we need it</th>
                    <th className="py-3 font-semibold text-ink">How it is stored</th>
                  </tr>
                </thead>
                <tbody>
                  {COLLECTED.map(([what, why, how]) => (
                    <tr key={what} className="border-b border-line align-top">
                      <td className="py-3.5 pr-5 text-ink">{what}</td>
                      <td className="py-3.5 pr-5 leading-relaxed text-ink-2">{why}</td>
                      <td className="py-3.5 leading-relaxed text-ink-2">{how}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <P>
              Tool calls reach us as part of doing the work. When your AI writes a file, the file
              contents arrive with the call, and we keep them because that is your project. The
              surrounding conversation does not arrive and is not stored.
            </P>
          </Section>

          <Section id="not" title="What we never see">
            <P>
              <strong>Your prompts and your model&rsquo;s reasoning.</strong> Power provides the
              workbench and the gates. The thinking happens in the AI you already pay for, on your
              existing subscription. We have no inference provider and make no calls to one, so
              there is nothing on our side for a prompt to be sent to.
            </P>
            <P>
              <strong>Your credential values, once they are in.</strong> A credential is written
              encrypted and read back only to run your build or your deploy. The project pages show
              a name and a fingerprint, never a value, and values are scrubbed out of tool results
              before they are returned, so a key echoed in a build log does not reach the model.
            </P>
            <P>
              <strong>Anything your AI client did not send us.</strong> We cannot see your editor,
              your other files or your other conversations.
            </P>
          </Section>

          <Section id="use" title="How we use it">
            <P>
              To run the service and nothing else: to sign you in, to keep your project and its
              history, to check the work against the gates, to count build actions against your
              plan, to deploy when you confirm a publish, and to answer you when you contact us
              about your account.
            </P>
            <P>
              We also use aggregate counts, such as how often a particular gate refuses, to decide
              what to fix next. Those counts carry no project contents and identify no one.
            </P>
            <P>
              We do not train any model on your code. We do not profile you, and we make no
              automated decisions about you beyond enforcing the limits of the plan you chose.
            </P>
          </Section>

          <Section id="storage" title="Where it is stored">
            <P>
              Account data, projects, approvals and the activity log live in a Postgres database.
              Row-level security is enabled and forced on every tenant table, and the policy is
              checked against the user id set at the start of each transaction. A query that forgets
              to scope itself returns nothing rather than everything.
            </P>
            <P>
              Sign-in tokens, OAuth tokens and session identifiers are held in a separate policy
              scope that a project query cannot read, and they are held as{' '}
              <code className="mono rounded bg-paper-2 px-1.5 py-0.5 text-[0.88em] text-ink">sha256</code>{' '}
              hashes rather than as the tokens themselves. A copy of the database does not let
              anyone act as you.
            </P>
            <P>
              Credentials sit in a third scope, which neither a project query nor a sign-in query can
              read, and each value is encrypted with AES-256-GCM before it is written. The
              encryption key is required configuration and lives outside the database, so a database
              dump on its own does not reveal a credential.
            </P>
            <P>
              Your project files are a real git repository on the server, and your project database
              is a real Postgres database kept as two branches: the live one your app reads, and a
              safe copy your AI is allowed to write to. Promoting a change from one to the other
              takes your confirmation.
            </P>
            <P>
              Power&rsquo;s server and its databases run on rented infrastructure, which means the
              provider hosting those disks could technically reach them. That is the reason
              credentials are encrypted before they are written rather than after someone asks.
            </P>
          </Section>

          <Section id="sharing" title="Who else can see it">
            <P>
              We do not sell personal data, and we do not share it with advertisers or data brokers.
              Data goes to someone else only in the cases below.
            </P>
            <Bullets
              items={[
                <>
                  <strong>Your hosting provider, using your own credential.</strong> Publishing
                  sends your built app to your own account with the provider you connected. The
                  deployment and the live site are yours, under your billing relationship, and
                  remain live if you stop using Power. The credential belongs to you and is used
                  only for your deploys.
                </>,
                <>
                  <strong>An email provider, for the sign-in link.</strong> Delivering a sign-in
                  link means handing your address to whatever mail service the server is configured
                  with. That address and the link are all that is sent.
                </>,
                <>
                  <strong>Your AI client.</strong> The results of tool calls go back to the client
                  you connected, which is how any of this is useful. Credential values are scrubbed
                  out first. What your client then does with a result is governed by that
                  client&rsquo;s own privacy policy, not ours.
                </>,
                <>
                  <strong>Google Fonts, on this marketing site only.</strong> The typefaces on the
                  pages you are reading load from Google&rsquo;s font CDN, which sees the request.
                  The MCP server and the project pages are not involved.
                </>,
                <>
                  <strong>When the law requires it.</strong> If we are compelled to produce data, we
                  will produce only what is actually demanded, and we will tell you unless we are
                  forbidden from doing so.
                </>,
              ]}
            />
          </Section>

          <Section id="retention" title="How long we keep it">
            <P>
              Your project and its history stay until you delete them. Deleting a project removes
              its files, its database branches, its activity log entries and its stored credentials.
              Closing your account removes the account row and everything that hangs off it.
            </P>
            <P>
              Short-lived things expire on their own. A sign-in link is valid once and for fifteen
              minutes. A credential entry form is valid once and for thirty minutes. Access tokens
              expire and refresh tokens rotate, and presenting a refresh token that has already been
              rotated revokes the whole family, on the assumption that it leaked. Signing out
              deletes that session immediately.
            </P>
            <P>
              We would rather say this plainly than imply more housekeeping than there is: expired
              rows stop working at their expiry, and we remove them on a schedule rather than at the
              instant they lapse.
            </P>
          </Section>

          <Section id="export" title="Taking your data with you">
            <P>
              Export is a tool call, it is free on every plan including the free one, and it is
              never metered. You get the whole repository with its git history, the schema and the
              migrations, ready to run somewhere else. There is no build step that only we can run.
            </P>
            <P>
              If you want a copy of the account data that is not part of a project, such as your
              email address and your activity log, or you want all of it deleted, write to us at the
              address below and we will do it.
            </P>
            <P>
              Depending on where you live you may have further rights over your data, including
              access, correction, deletion and objection. Ask and we will honour them. We do not ask
              you to prove a jurisdiction first.
            </P>
          </Section>

          <Section id="security" title="Security">
            <P>
              The choices that matter here are enforced in code rather than promised in prose:
              tenant isolation through forced row-level security, tokens stored only as hashes,
              constant-time comparison where a secret is compared, credentials encrypted at rest in
              a scope of their own, and no raw error text or secret value returned to a caller or
              written to a log.
            </P>
            <P>
              The server refuses to start if it cannot tell who is calling, and refuses to start if
              it finds itself connected in a way that would not enforce those isolation policies. A
              loud failure at boot is better than quietly serving every tenant every row.
            </P>
            <P>
              No system is beyond compromise. If we discover a breach affecting your data, we will
              tell you what happened, what was reached and what to do about it, without waiting
              until the story is flattering.
            </P>
            <P>
              If you have found a vulnerability, please report it to {' '}
              <a href={`mailto:${SITE.email}`} className="text-accent hover:underline">
                {SITE.email}
              </a>{' '}
              before disclosing it publicly. We will not take legal action against good-faith
              research.
            </P>
          </Section>

          <Section id="changes" title="Changes to this policy">
            <P>
              When the service changes in a way that changes this page, we update the page as part
              of that change and move the date at the top. For a change that materially affects what
              we collect or who can see it, we will tell account holders by email rather than
              relying on you to notice a new date.
            </P>
            <P>
              This site is open source, so the history of this page is public and you can read
              exactly what changed and when.
            </P>
          </Section>

          <Section id="contact" title="Contact">
            <P>
              Questions about this policy, a request for your data, a deletion request or a security
              report all go to the same place:{' '}
              <a href={`mailto:${SITE.email}`} className="text-accent hover:underline">
                {SITE.email}
              </a>
              . A person reads it.
            </P>
            <P>
              The companion to this page is the{' '}
              <Link href="/terms/" className="text-accent hover:underline">
                terms of service
              </Link>
              , which covers what the service does and what each of us is responsible for.
            </P>
          </Section>
        </div>
      </section>
    </>
  );
}

/**
 * The long-form scale from the docs article, not the landing-page one. Ten
 * headings at `text-h2` would each be larger than the sentence under it.
 */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Reveal>
      <section id={id} className="scroll-mt-28">
        <h2 className="text-[1.5rem] leading-snug">{title}</h2>
        <div className="mt-4 space-y-4">{children}</div>
      </section>
    </Reveal>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="leading-relaxed text-ink-2 [&_strong]:text-ink">{children}</p>;
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-3 border-t border-line pt-4">
      {items.map((item, i) => (
        <li key={i} className="border-b border-line pb-3 leading-relaxed text-ink-2 [&_strong]:text-ink">
          {item}
        </li>
      ))}
    </ul>
  );
}
