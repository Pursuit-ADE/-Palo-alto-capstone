// The app's icons, drawn in one grammar: a 24-unit grid, a 1.75 stroke, round caps and joins, colour from the text.
// Decorative only: every icon sits next to words, so screen readers skip it.
import type { ReactNode } from 'react';

function Icon({ children, small = false }: { children: ReactNode; small?: boolean }) {
  return (
    <svg className={small ? 'icon icon-sm' : 'icon'} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const OverviewIcon = () => (
  <Icon>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Icon>
);

export const AskIcon = () => (
  <Icon>
    <path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H11l-4.5 3.5V16a2 2 0 0 1-2-2z" />
    <path d="M8.5 9h7M8.5 12h4.5" />
  </Icon>
);

export const MetricsIcon = () => (
  <Icon>
    <path d="M5 18.5V5.5a2 2 0 0 1 2-2h11.5v13H7a2 2 0 0 0-2 2 2 2 0 0 0 2 2h11.5v-4" />
    <path d="M9 7.5h6M9 10.5h4" />
  </Icon>
);

export const TrendsIcon = () => (
  <Icon>
    <path d="M4 20h16" />
    <path d="M7 16v-5M12 16V7M17 16v-8" />
  </Icon>
);

export const BellIcon = () => (
  <Icon>
    <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5L19 18H5z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Icon>
);

export const ExternalIcon = () => (
  <Icon small>
    <path d="M10 5.5H6.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V14" />
    <path d="M13.5 5.5h5v5M18.5 5.5 11 13" />
  </Icon>
);

export const LockIcon = () => (
  <Icon small>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Icon>
);

export const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Icon>
);

export const MoonIcon = () => (
  <Icon>
    <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z" />
  </Icon>
);

/** The metric registry at the centre of the overview's map: reviewed definitions stacked as layers. */
export const RegistryIcon = () => (
  <Icon>
    <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
    <path d="m3.5 12 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16 8.5 4.5 8.5-4.5" />
  </Icon>
);
