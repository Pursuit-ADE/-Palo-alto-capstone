// What the sign-in pages show before anyone signs in: how the product is built, never data. Rule names come from
// rules/*.json and the role model from the seed's regions; no person, account or alert is read here.
import { loadRules } from '@/alerts/rules';
import { REGIONS } from '@/db/seed';
import type { StageInfo } from './auth-stage';

export function authStageInfo(): StageInfo {
  const rules = [...loadRules().values()].map((r) => r.name);
  const regions = REGIONS.map((r) => r.name);
  return {
    product: 'Actionable Alerts',
    hub: {
      title: 'checked against your account team',
      sources: ['Support cases', 'Engagements', 'Account teams'],
      count: rules.length,
      unit: rules.length === 1 ? 'alert rule' : 'alert rules',
      items: rules,
    },
    promises: ['Your role comes from your invite', 'Alerts only cover accounts on your team', 'Access is checked again before each alert'],
    // The demo's role model, one card face per role and region (see src/db/seed.ts).
    cards: [
      ...regions.map((region) => ({ role: 'Sales rep', region })),
      ...regions.map((region) => ({ role: 'Sales manager', region })),
      { role: 'Technical seller', region: 'East' },
      { role: 'Technical seller', region: 'West' },
      { role: 'Analyst', region: 'All regions' },
    ],
  };
}
