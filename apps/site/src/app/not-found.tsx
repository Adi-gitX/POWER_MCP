import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Page not found',
  description: 'That route is not part of the pipeline.',
};

export default function NotFound() {
  return (
    <div className="page not-found">
      <section className="page-hero">
        <div className="shell">
          <span className="eyebrow">
            <span className="eyebrow-dot" />
            404
          </span>
          <h1 className="page-title">This page is not in the pipeline.</h1>
          <p className="page-sub">
            The address you followed does not exist, or it moved. Nothing was lost — the gates and
            the project are still where you left them.
          </p>
          <div className="not-found-actions">
            <a className="btn btn-light btn-md" href="/">
              Back to Power
            </a>
            <a className="btn btn-dark btn-md" href="/docs/getting-started/">
              Read the docs
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
