import fs from 'node:fs';
import path from 'node:path';
import { loadRegistry } from '../registry/load';
import { GOVERNED_METRIC_IDS, OnboardConfirmation, type OnboardProposal } from './types';

export const DEFAULT_ACTIVE_PATH = path.join(process.cwd(), 'onboarding', 'active.json');

export class OnboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardError';
  }
}

/**
 * Human confirmation only. Metrics stay in the reviewed registry; this file only records
 * which dataset folder the seed loader may use.
 */
export function confirmOnboarding(
  proposal: OnboardProposal,
  input: { confirmedBy: string; metricIds: string[]; seed?: string; notes?: string; writtenAt?: string },
  registryRoot?: string,
): OnboardConfirmation {
  if (proposal.blockers.length) {
    throw new OnboardError(`Cannot confirm: ${proposal.blockers.join(' ')}`);
  }
  const registry = loadRegistry(registryRoot);
  const allowed = new Set<string>(GOVERNED_METRIC_IDS);
  const unknown = input.metricIds.filter((id) => !allowed.has(id) || !registry.metrics.has(id));
  if (unknown.length) throw new OnboardError(`Unknown or ungoverned metric: ${unknown.join(', ')}`);
  if (!input.metricIds.length) throw new OnboardError('Confirm at least one existing governed metric.');
  const seed = input.seed ?? path.basename(proposal.profile.datasetDir);
  return OnboardConfirmation.parse({
    status: 'confirmed',
    datasetDir: proposal.profile.datasetDir,
    seed,
    confirmedMetricIds: input.metricIds,
    confirmedBy: input.confirmedBy,
    confirmedAt: input.writtenAt ?? new Date().toISOString(),
    notes: input.notes,
  });
}

export function writeConfirmation(confirmation: OnboardConfirmation, dest: string = DEFAULT_ACTIVE_PATH): string {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(confirmation, null, 2)}\n`);
  return dest;
}

export function readConfirmation(file: string): OnboardConfirmation {
  return OnboardConfirmation.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}
