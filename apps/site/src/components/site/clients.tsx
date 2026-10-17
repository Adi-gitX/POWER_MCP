import { Reveal } from '@/components/motion/reveal';
import { CopyLine } from './copy-line';
import { SITE } from '@/lib/site';

/**
 * Where it plugs in.
 *
 * Power is a protocol server, not an application, so the honest answer to
 * "what does it work with" is a list of clients and the one line each needs.
 * Showing the actual line is also the point: there is no account to create and
 * nothing to install before it.
 */
const CLIENTS = [
  {
    name: 'Claude Code',
    how: 'One command in the terminal, then authenticate in the browser.',
    command: `claude mcp add --transport http power ${SITE.mcp}`,
  },
  {
    name: 'Claude',
    how: 'Settings → Connectors → Add custom connector, then paste the URL.',
    command: SITE.mcp,
  },
  {
    name: 'Anything else that speaks MCP',
    how: 'Streamable HTTP with OAuth 2.1 and dynamic client registration. No bespoke client.',
    command: SITE.mcp,
  },
];

export function Clients() {
  return (
    <section className="section border-t border-line bg-paper-2">
      <div className="wrap">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Works where you already work</span>
          <h2 className="serif mt-5 text-h2">
            Your model. Your <em className="text-accent">subscription.</em>
          </h2>
          <p className="mt-4 text-[1.08rem] leading-relaxed text-ink-2">
            Power pays for no inference, because your assistant does the thinking. That is why the
            free tier can be real.
          </p>
        </Reveal>

        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-[minmax(0,1fr)] gap-3">
          {CLIENTS.map((client, i) => (
            <Reveal key={client.name} delay={i * 0.06} className="min-w-0">
              <div className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 md:flex-row md:items-center md:justify-between md:gap-6">
                <div className="min-w-0">
                  <h3 className="text-[1rem] font-semibold text-ink">{client.name}</h3>
                  <p className="mt-0.5 text-[0.9rem] leading-snug text-ink-2">{client.how}</p>
                </div>
                <CopyLine command={client.command} className="w-full md:w-[22rem] md:shrink-0" />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
