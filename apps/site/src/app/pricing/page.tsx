import type { Metadata } from 'next';
import { PLANS } from '@power/protocol';
import { signUp } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Flat monthly plans metered in build actions, not tokens. Refused calls are never billed. Reads, export and every gate are included on every plan.',
};

const ORDER = ['free', 'pro', 'power'] as const;

const DATA = {
  free: {
    label: 'Free',
    price: 0,
    blurb: 'Enough to take one idea all the way to published.',
    cta: 'Start free',
    facts: [
      ['Build actions', '100 / day'],
      ['Projects', '3'],
      ['Every gate', 'Included'],
    ],
    list: [
      'Every gate and refusal',
      'Live database with a safe copy',
      'Hosting and a rollback tag',
      'Export and self-host',
    ],
  },
  pro: {
    label: 'Pro',
    price: 25,
    blurb: 'For someone shipping and maintaining real projects.',
    cta: 'Choose Pro',
    facts: [
      ['Build actions', '1,000 / day'],
      ['Projects', 'Unlimited'],
      ['Priority jobs', 'Included'],
    ],
    list: ['Everything in Free', 'Unlimited projects', 'Priority on long jobs', 'Bring your own inference'],
  },
  power: {
    label: 'Power',
    price: 100,
    blurb: 'For a team running several projects at once.',
    cta: 'Choose Power',
    facts: [
      ['Build actions', '5,000 / day'],
      ['Projects', 'Unlimited'],
      ['Priority jobs', 'Included'],
    ],
    list: [
      'Everything in Pro',
      '5,000 build actions a day',
      'Priority on long jobs',
      'Self-host the server',
    ],
  },
} as const;

const COMPARE: [string, string[]][] = [
  ['Build actions a day', ['100', '1,000', '5,000']],
  ['Projects', ['3', 'Unlimited', 'Unlimited']],
  ['Every gate and every refusal', ['Included', 'Included', 'Included']],
  ['Reads, context and export', ['Free', 'Free', 'Free']],
  ['Live database with a safe copy', ['Included', 'Included', 'Included']],
  ['Hosting and a rollback tag', ['Included', 'Included', 'Included']],
  ['Bring your own inference', ['Included', 'Included', 'Included']],
  ['Priority on long jobs', ['—', 'Included', 'Included']],
  ['Self-host the server', ['Included', 'Included', 'Included']],
];

const FAQ: [string, string][] = [
  [
    'What is a build action?',
    'One tool call that changes something: writing a file, proposing a migration, running the tests, publishing. Reading context, listing files and exporting your code are free and always have been.',
  ],
  [
    'What happens when a gate refuses?',
    'The call is refunded before the response is sent, so a refusal never costs you an action. Your AI gets the rule id, the reason and the next action to take.',
  ],
  [
    'Do I pay for tokens as well?',
    'Not to us. Power runs inside the AI you already pay for, so the thinking happens on your existing subscription. We meter the work, not the words.',
  ],
  [
    'Can I take my code with me?',
    'Yes, at any time, on any plan, including free. Export gives you the full git history, the schema and the migrations. There is no build step that only we can run.',
  ],
  [
    'Can I switch plans or cancel?',
    'Plans are monthly. Change or cancel whenever you like. Export stays free on every plan, including your full git history.',
  ],
];

export default function PricingPage() {
  return (
    <div className="page">
      <section className="page-hero">
        <div className="shell">
          <span className="eyebrow reveal">
            <span className="eyebrow-dot" />
            Pricing
          </span>
          <h1 className="page-title reveal">Pay for work that passed.</h1>
          <p className="page-sub reveal">
            Flat monthly plans, metered in build actions rather than tokens. A refused call is
            refunded before the response is sent.
          </p>
        </div>
      </section>

      <section className="page-section">
        <div className="shell">
          <div className="price-grid">
            {ORDER.map((key) => {
              const plan = DATA[key];
              const featured = key === 'pro';
              return (
                <article className={`price-card reveal${featured ? ' is-featured' : ''}`} key={key}>
                  <span className="plan-label">{plan.label}</span>
                  <div className="price-line">
                    {plan.price === 0 ? (
                      <span className="price-free">Free</span>
                    ) : (
                      <>
                        <span className="currency">$</span>
                        <span className="amount">{plan.price}</span>
                        <span className="per">/month</span>
                      </>
                    )}
                  </div>
                  <p className="plan-desc">{plan.blurb}</p>
                  <a className={`btn ${featured ? 'btn-light' : 'btn-dark'} btn-md`} href={signUp}>
                    {plan.cta}
                  </a>
                  <ul className="plan-facts">
                    {plan.facts.map(([label, value]) => (
                      <li key={label}>
                        <span>{label}:</span>
                        <strong>{value}</strong>
                      </li>
                    ))}
                  </ul>
                  <ul className="plan-list">
                    {plan.list.map((item) => (
                      <li className="has" key={item}>
                        <span className="tick">
                          <svg className="icon">
                            <use href="#i-check" />
                          </svg>
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
          <p className="price-foot reveal">
            Every plan includes the same gates. {PLANS.free.per_day} free actions a day, forever.
          </p>
        </div>
      </section>

      <section className="page-section">
        <div className="shell">
          <div className="sec-head">
            <div className="sec-head-main">
              <span className="eyebrow reveal">
                <span className="eyebrow-dot" />
                Compare
              </span>
              <h2 className="sec-title reveal">What each plan includes.</h2>
            </div>
            <p className="sec-copy reveal">
              Limits change with the plan. The gates, the safe database copy and the way out never do.
            </p>
          </div>
          <table className="compare reveal">
            <thead>
              <tr>
                <th />
                {ORDER.map((key) => (
                  <th key={key}>{DATA[key].label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(([label, values]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {values.map((value, index) => (
                    <td key={index} className={value === '—' ? 'is-off' : undefined}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="page-section faq-page">
        <div className="shell">
          <div className="sec-head">
            <div className="sec-head-main">
              <span className="eyebrow reveal">
                <span className="eyebrow-dot" />
                FAQ
              </span>
              <h2 className="sec-title reveal">Questions people actually ask.</h2>
            </div>
            <p className="sec-copy reveal">
              The short answers. Everything else is in the docs.
            </p>
          </div>
          <div className="faq-layout">
            <div className="faq-side">
              <div className="faq-promo reveal">
                <h3>Not sure yet?</h3>
                <p>Read the pipeline, the gates and the two decisions before you connect anything.</p>
                <a className="text-link" href="/docs/how-it-works/">
                  How it works
                  <svg className="icon">
                    <use href="#i-arrow-right" />
                  </svg>
                </a>
              </div>
            </div>
            <div className="faq-panels reveal">
              {FAQ.map(([question, answer]) => (
                <div className="acc" key={question}>
                  <button className="acc-btn" type="button" aria-expanded="false">
                    <span>{question}</span>
                    <span className="acc-icon">
                      <svg className="icon">
                        <use href="#i-chevron-down" />
                      </svg>
                    </span>
                  </button>
                  <div className="acc-panel">
                    <p>{answer}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
