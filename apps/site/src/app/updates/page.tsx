import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Updates',
  description: 'What is new in Power: the approval gate, the Project Contract editor, the pipeline builder and scoped integrations.',
};

const ENTRIES = [
  {
    id: 'approval-gate',
    date: 'Oct 23, 2026',
    datetime: '2026-10-23',
    title: 'Approval gate',
    body: [
      'Production changes now stop for one exact approval. The gate shows the target, the action and the risk, so you review the change rather than a summary of it.',
      'The model cannot skip this step, and cancelling stops the run cleanly without promoting anything.',
    ],
    improved: [
      ['Approval', 'Shows the target, action and risk before anything is promoted.'],
      ['Evidence', 'Lists the checks that passed: tests, security and browser QA.'],
      ['History', 'Records the decision and exactly what was shown.'],
    ],
    fixed: [
      ['Approvals', 'A publish call can no longer bypass the production gate.'],
      ['Focus', 'Approval actions are reachable by keyboard.'],
    ],
  },
  {
    id: 'contract-editor',
    date: 'Oct 16, 2026',
    datetime: '2026-10-16',
    title: 'Project Contract editor',
    body: [
      'You can now edit the Project Contract in the workspace: frontend, database, accounts, billing, deployment and permanent rules.',
      'Answer an open question once and keep the answer as project context, so the next agent starts from the same facts.',
    ],
    improved: [
      ['Fields', 'Edit stack choices in place.'],
      ['Rules', 'Add permanent rules that every agent follows.'],
      ['Versioning', 'Every change is attributed and available to the next run.'],
    ],
    fixed: [
      ['Storage', 'Credentials are never saved in the browser sandbox.'],
      ['Labels', 'Sample data is clearly marked as sample data.'],
    ],
  },
  {
    id: 'pipeline-builder',
    date: 'Oct 9, 2026',
    datetime: '2026-10-09',
    title: 'Pipeline builder',
    body: [
      'Build a pipeline from steps, skills and checkpoints, and run it in the sandbox to see every step and its status.',
      'Pipelines combine validation, review and delivery, with a human approval before production.',
    ],
    improved: [
      ['Steps', 'Add and reorder steps in a pipeline.'],
      ['Skills', 'Attach skills to the steps that need expertise.'],
    ],
    fixed: [
      ['Checkpoints', 'Approval steps pause the run until you decide.'],
      ['Status', 'Step status always matches the run state.'],
    ],
  },
  {
    id: 'integrations-skills-packs',
    date: 'Oct 2, 2026',
    datetime: '2026-10-02',
    title: 'Integrations, skills and packs',
    body: [
      'Browse integrations, skills and starter packs, and see what each one would be able to access before anything is connected.',
      'Review the scopes an integration requests, then let every agent use it with the least access it needs.',
    ],
    improved: [
      ['Integrations', 'Review the scopes an integration would request.'],
      ['Packs', 'Start from SaaS, website or launch packs.'],
    ],
    fixed: [
      ['Permissions', 'Scopes are shown before any connection.'],
      ['Credentials', 'No credentials are stored in the sandbox.'],
    ],
  },
];

export default function UpdatesPage() {
  return (
    <div className="page">
      <section className="page-hero">
        <div className="shell">
          <span className="eyebrow reveal">
            <span className="eyebrow-dot" />
            Updates
          </span>
          <h1 className="page-title reveal">What&rsquo;s new in Power</h1>
          <p className="page-sub reveal">
            Every change that affects the pipeline, the contract or what an agent is allowed
            to do. <Link className="inline-link" href="/docs/how-it-works/">Read how it works</Link>.
          </p>
        </div>
      </section>

      <section className="page-section updates-list">
        <div className="shell">
          {ENTRIES.map((entry) => (
            <article className="update-entry reveal" id={entry.id} key={entry.id}>
              <div className="update-entry-date">
                <time dateTime={entry.datetime}>{entry.date}</time>
                <a className="anchor-link" href={`#${entry.id}`} aria-label={`Link to ${entry.title}`}>
                  #
                </a>
              </div>
              <div className="update-entry-body">
                <h2>{entry.title}</h2>
                {entry.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                <div className="update-notes">
                  <div>
                    <h3>Improved</h3>
                    <ul>
                      {entry.improved.map(([label, copy]) => (
                        <li key={label}>
                          <strong>{label}</strong>
                          <span>{copy}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3>Fixed</h3>
                    <ul>
                      {entry.fixed.map(([label, copy]) => (
                        <li key={label}>
                          <strong>{label}</strong>
                          <span>{copy}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
