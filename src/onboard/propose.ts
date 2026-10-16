import { loadRegistry } from '../registry/load';
import { GOVERNED_METRIC_IDS, type DatasetProfile, type OnboardProposal } from './types';

/**
 * Proposes the existing governed metrics when the folder matches the CRM shape.
 * It never writes a metric file and never invents SQL or a new formula.
 */
export function proposeMetrics(profile: DatasetProfile, registryRoot?: string): OnboardProposal {
  const registry = loadRegistry(registryRoot);
  const blockers: string[] = [];
  if (!profile.mavenShaped) {
    blockers.push('Folder is not the CRM shape the seed loader and compiler already know (accounts, products, sales_teams, sales_pipeline).');
    for (const f of profile.missingFiles) blockers.push(`Missing ${f}.`);
    for (const [file, cols] of Object.entries(profile.missingColumns)) {
      blockers.push(`${file} is missing columns: ${cols.join(', ')}.`);
    }
    for (const p of profile.problems) blockers.push(p);
  }
  const proposedMetrics = profile.mavenShaped
    ? GOVERNED_METRIC_IDS.map((id) => {
        const metric = registry.metrics.get(id);
        if (!metric) throw new Error(`Registry is missing governed metric ${id}`);
        return { id, reason: `${metric.name} already exists in the registry. Confirming this dataset lets that metric run on the new rows.` };
      })
    : [];
  return { status: 'pending', profile, proposedMetrics, blockers };
}
