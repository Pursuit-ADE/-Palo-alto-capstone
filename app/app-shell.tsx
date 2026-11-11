// The frame every signed-in page shares: the rail (where to go, and how the numbers are kept) and the top bar
// (synthetic-data badge, light/dark switch, who is signed in). Server-rendered; only the light/dark switch runs in the browser.
import type { ReactNode } from 'react';
import { AskIcon, BellIcon, ExternalIcon, MetricsIcon, OverviewIcon, TrendsIcon } from './icons';
import { SyntheticBadge } from './synthetic-badge';
import type { Theme } from './theme-shared';
import { ThemeToggle } from './theme-toggle';
import './shell.css';

export interface ShellProps {
  current: 'overview' | 'trends';
  /** Question trends are for analysts only (anyone else gets a 404 there), so the rail offers it to them alone. */
  analyst: boolean;
  /** The alerts app, when it is configured (src/server/alerts-link.ts). */
  alertsHref: string | null;
  theme: Theme | null;
  dataset: string;
  /** The data date, already in words. */
  asOf: string;
  metricCount: number;
  /** The signed-in person and Log out, or the local-testing identity switch. */
  who: ReactNode;
  children: ReactNode;
}

const here = (on: boolean) => (on ? ('page' as const) : undefined);

function RailNav({ current, analyst, alertsHref }: Pick<ShellProps, 'current' | 'analyst' | 'alertsHref'>) {
  return (
    <nav aria-label="Main">
      <ul>
        <li><a href="/" aria-current={here(current === 'overview')}><OverviewIcon />Overview</a></li>
        <li><a href="/#ask"><AskIcon />Ask</a></li>
        <li><a href="/#rulebook"><MetricsIcon />Metrics</a></li>
        {analyst && <li><a href="/trends" aria-current={here(current === 'trends')}><TrendsIcon />Trends</a></li>}
        {alertsHref && (
          // A new tab, as before: the alerts app has its own accounts, and in the same tab Back reloaded the copilot and
          // the conversation was gone (UX review, Nov 2). noopener: the alerts page gets no handle back to this one.
          <li>
            <a href={alertsHref} target="_blank" rel="noopener noreferrer" title="Opens the alerts app in a new tab, where you sign in separately">
              <BellIcon />My alerts<ExternalIcon />
              <span className="visually-hidden"> (opens the alerts app in a new tab, where you sign in separately)</span>
            </a>
          </li>
        )}
      </ul>
    </nav>
  );
}

/** How the numbers are kept, in five plain facts (docs/SYSTEM-CARD.md rules 2, 4, 10 and the least-privilege logins). */
function Governance({ metricCount, asOf }: { metricCount: number; asOf: string }) {
  return (
    <section className="rail-status" aria-labelledby="rail-status-title">
      <h2 id="rail-status-title">How numbers are kept</h2>
      <dl>
        <div><dt>Metrics</dt><dd>{metricCount} approved definitions</dd></div>
        <div><dt>Access</dt><dd>From your account</dd></div>
        <div><dt>Answers</dt><dd>Read-only</dd></div>
        <div><dt>Questions</dt><dd>Every one recorded</dd></div>
        <div><dt>Data</dt><dd>Synthetic, as of {asOf}</dd></div>
      </dl>
    </section>
  );
}

export function AppShell({ current, analyst, alertsHref, theme, dataset, asOf, metricCount, who, children }: ShellProps) {
  return (
    <div className="shell">
      <aside className="rail">
        <a className="rail-brand" href="/">
          <span className="mark" aria-hidden="true" />
          <span>ALTO PALS</span>
        </a>
        <RailNav current={current} analyst={analyst} alertsHref={alertsHref} />
        <Governance metricCount={metricCount} asOf={asOf} />
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <strong>Governed Analytics Copilot</strong>
            <span>Customer Analytics · Team ALTO PALS</span>
          </div>
          <SyntheticBadge dataset={dataset} />
          <ThemeToggle saved={theme} />
          {who}
        </header>
        {children}
      </div>
    </div>
  );
}
