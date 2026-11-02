/**
 * The terms of service.
 *
 * Short on purpose. Terms nobody reads are terms nobody agreed to, so this is
 * written at the length a person will actually finish, and it says the same
 * things the product says elsewhere rather than quietly taking them back.
 *
 * Two deliberate omissions: there is no legal entity named and no governing law
 * or venue clause, because neither can be invented honestly from this
 * repository. The trap is that both read as boilerplate a later editor might
 * fill in from a template; they need the owner's real answers, and until then
 * their absence is the accurate state of the document.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Reveal } from '@/components/motion/reveal';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms',
  description:
    'What Power does, what you can use it for, and what each of us is responsible for. You own your code and your data, and export is always free.',
};

const LAST_UPDATED = '5 October 2026';

export default function TermsPage() {
  return (
    <>
      <section className="pb-8 pt-[132px]">
        <div className="wrap max-w-3xl">
          <span className="eyebrow">Terms of service</span>
          <h1 className="serif mt-6 text-[clamp(2.4rem,5.4vw,4rem)] leading-[1.02] tracking-tight">
            Plain terms, because you should read them.
          </h1>
          <p className="mt-5 text-[1.15rem] leading-relaxed text-ink-2">
            By connecting an AI client to Power or signing in to it, you agree to what is on this
            page. If something here does not work for you, write to us before you rely on the
            service rather than after.
          </p>
          <p className="mono mt-6 text-[0.76rem] text-ink-2">Last updated {LAST_UPDATED}</p>
        </div>
      </section>

      <section className="section pt-10">
        <div className="wrap max-w-3xl space-y-14">
          <Section title="What Power is">
            <P>
              Power is a Model Context Protocol server. You connect the AI client you already pay
              for, and Power gives that AI a workbench: a project with a git repository, a database
              with a live branch and a safe copy, tests it can run, gates that check its work before
              you see it, and a way to publish the result.
            </P>
            <P>
              Power does not run a model. Your AI does the thinking on your own subscription with
              whoever provides it, and that relationship is between you and them.
            </P>
            <P>
              Two decisions stay yours and are enforced by the server rather than left to the model:
              approving the plan, and confirming a publish or a migration against your live data.
            </P>
          </Section>

          <Section title="Your account">
            <P>
              You sign in with an email address and a link sent to it. There is no password, so
              access to that mailbox is access to your account. Keep it secure, and tell us promptly
              if you think someone else has it.
            </P>
            <P>
              You need to be old enough to form a contract where you live, and you are responsible
              for what happens under your account, including what your AI client does with the
              access you granted it. You can revoke that access or sign out of a session at any
              time.
            </P>
            <P>
              One account is for one person or one organisation. Do not share credentials to let
              other people use a plan they are not on.
            </P>
          </Section>

          <Section title="Your code and your data are yours">
            <P>
              You own everything you bring and everything the service produces for you: the spec,
              the code, the schema, the migrations, the git history and the data in your project
              database. We claim no ownership of it and no licence to it beyond what running the
              service requires, which is to store it, build it, test it and deploy it when you say
              so.
            </P>
            <P>
              We do not train models on your code, and we do not use your project contents to build
              anything other than your project.
            </P>
            <P>
              Export is free on every plan, including the free one, and is never metered. If you
              leave, you leave with the whole repository and its history, and nothing in it depends
              on a build step only we can run. Published apps deploy to your own hosting account and
              stay live under your own billing relationship whether or not you keep using Power.
            </P>
          </Section>

          <Section title="What you grant us">
            <P>
              Only the permission needed to operate: to host and process your content so the service
              can function, and to pass it to the providers described in the{' '}
              <Link href="/privacy/" className="text-accent hover:underline">
                privacy policy
              </Link>{' '}
              for the purposes listed there. That permission ends when you delete the content or
              close your account.
            </P>
            <P>
              If you send us feedback or a bug report, we may act on it without owing you anything
              for it. We will not treat your project contents as feedback.
            </P>
          </Section>

          <Section title="Acceptable use">
            <P>Use Power to build software. Do not use it to:</P>
            <Bullets
              items={[
                'break the law where you are, or where the service runs',
                'build or distribute malware, credential harvesters, or tools whose purpose is to attack or deceive other people',
                'store or process other people’s personal data without the right to do so, or handle data you are not allowed to put on infrastructure you do not control',
                'attack the service: probing other tenants, trying to escape a sandbox, trying to read data that is not yours, or circumventing the gates, the plan limits or the metering',
                'run work unrelated to building your project, such as mining, proxying traffic or using the sandbox as general compute',
                'infringe someone else’s copyright, trademark or other rights',
                'resell the service as your own, or use it to build a substantially identical competing service',
              ]}
            />
            <P>
              We may apply rate limits, refuse a call or suspend a project if it threatens the
              service or other customers. Where we can, we will tell you what rule you hit and what
              to do about it, because a refusal that explains itself is the whole idea behind this
              product.
            </P>
          </Section>

          <Section title="Plans, metering and payment">
            <P>
              Plans are flat monthly and metered in build actions rather than tokens. What counts as
              a build action, and what each plan includes, is on the{' '}
              <Link href="/pricing/" className="text-accent hover:underline">
                pricing page
              </Link>
              , which forms part of these terms.
            </P>
            <P>
              Reading context, listing files and exporting your project are free and are not
              metered. A call that a gate refuses is refunded before the response is sent, so a
              refusal never costs you an action.
            </P>
            <P>
              A paid plan runs until you cancel it, and cancelling stops the next renewal. If we
              change a price, we will tell you before it applies to you, and you can cancel instead.
              Your AI provider&rsquo;s charges and your hosting provider&rsquo;s charges are
              separate and are not ours to bill or refund.
            </P>
          </Section>

          <Section title="Availability">
            <P>
              We intend Power to be up, and we will not pretend to promise more than that. There is
              no uptime guarantee on these terms. We may take the service down for maintenance, and
              we will keep that as short and as quiet as we can.
            </P>
            <P>
              Keep your own copies of anything you cannot afford to lose. Export exists, it is free,
              and it is the backup we would want you to have.
            </P>
          </Section>

          <Section title="No warranty">
            <P>
              The service is provided as it is, without warranties of any kind, express or implied,
              including fitness for a particular purpose, merchantability and non-infringement, to
              the extent the law allows us to say so.
            </P>
            <P>
              The gates catch real classes of mistake, and that is why they exist. They are not a
              guarantee that the code is correct, secure or suitable for what you are about to do
              with it. A gate that passed means the checks passed, not that the software is good.
              You are responsible for reviewing what you ship, and for testing it against your own
              requirements before it meets real users or real data.
            </P>
            <P>
              The same applies to anything your AI writes. The model is not ours and its output is
              not something we can warrant.
            </P>
          </Section>

          <Section title="Limits on liability">
            <P>
              To the extent the law allows, neither side is liable to the other for indirect,
              incidental, special or consequential damages, or for lost profits, lost revenue, lost
              business or lost or corrupted data.
            </P>
            <P>
              Our total liability for any claim relating to the service is capped at what you paid
              us in the twelve months before the claim arose, or one hundred United States dollars
              if that is greater. On a free plan, that cap is the one hundred dollars.
            </P>
            <P>
              Some places do not allow these exclusions, and where that is true they do not apply to
              you. Nothing here limits liability for fraud, or for anything else that cannot be
              limited by law.
            </P>
            <P>
              You are responsible for claims that arise from your own content or your own use of the
              service in breach of these terms, including a claim that your project infringes
              someone&rsquo;s rights.
            </P>
          </Section>

          <Section title="Ending it">
            <P>
              You can stop at any time. Delete a project, close your account, or simply disconnect
              the client. Export first, because deletion removes your project files, its database
              branches and its stored credentials.
            </P>
            <P>
              We can suspend or close an account that breaches these terms, that puts the service or
              other customers at risk, or where we are required to. Except where a breach is serious
              enough that waiting would cause harm, we will warn you first and give you a chance to
              fix it. If we close your account, we will give you a reasonable window to export, and
              we will refund the unused part of a prepaid plan unless the closure was for abuse.
            </P>
            <P>
              If we ever discontinue the service, we will give notice with enough time to export and
              move, and export will keep working until the end.
            </P>
          </Section>

          <Section title="Changes to these terms">
            <P>
              We may update these terms. For a material change we will notify account holders by
              email before it takes effect, and continuing to use the service after that date is how
              you accept it. If you do not accept it, stop using the service and ask us to close
              your account.
            </P>
            <P>
              The date at the top of this page says when it last changed, and because this site is
              open source, the history of the change is public.
            </P>
          </Section>

          <Section title="Contact">
            <P>
              Write to{' '}
              <a href={`mailto:${SITE.email}`} className="text-accent hover:underline">
                {SITE.email}
              </a>
              . That is the address for questions about these terms, for a dispute you would rather
              resolve by talking, and for anything about your account.
            </P>
            <P>
              The companion to this page is the{' '}
              <Link href="/privacy/" className="text-accent hover:underline">
                privacy policy
              </Link>
              , which covers what we collect and who else can see it.
            </P>
          </Section>
        </div>
      </section>
    </>
  );
}

/** Same long-form scale as the privacy page, so the two read as one document. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Reveal>
      <section>
        <h2 className="text-[1.5rem] leading-snug">{title}</h2>
        <div className="mt-4 space-y-4">{children}</div>
      </section>
    </Reveal>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="leading-relaxed text-ink-2 [&_strong]:text-ink">{children}</p>;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex gap-3 leading-relaxed text-ink-2">
          <span className="mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-line-2" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
