// What the sign-in pages show before anyone signs in: how the product is built, never data. Metric names come from
// the registry and the role model from the seed's regions; no person, account or number is read here.
import { REGIONS } from '@/db/seed';
import { loadRegistry } from '@/registry/load';
import type { StageInfo } from './auth-stage';

export function authStageInfo(): StageInfo {
  const metrics = [...loadRegistry().metrics.values()].map((m) => m.name);
  const regions = REGIONS.map((r) => r.name);
  return {
    product: 'Governed Analytics Copilot',
    hub: {
      title: 'in the governed semantic layer',
      sources: ['Opportunities', 'Accounts', 'Sales teams', 'Quotas'],
      count: metrics.length,
      unit: metrics.length === 1 ? 'approved metric' : 'approved metrics',
      items: metrics,
    },
    promises: ['Your role comes from your invite', 'Your scope comes from the database', 'Every answer shows its source'],
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
