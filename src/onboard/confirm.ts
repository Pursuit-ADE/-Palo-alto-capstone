import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { listCsvFiles } from './csv';
import { loadRegistry } from '../registry/load';
import { GOVERNED_METRIC_IDS, OnboardConfirmation, type OnboardProposal } from './types';

export const DEFAULT_ACTIVE_PATH = path.join(process.cwd(), 'onboarding', 'active.json');

export class OnboardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardError';
  }
}

/** SHA-256 of every CSV file in a dataset folder, by file name. */
export function datasetFileHashes(dir: string): Record<string, string> {
  return Object.fromEntries(listCsvFiles(dir).map((f) => [path.basename(f), createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
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
    fileHashes: datasetFileHashes(proposal.profile.datasetDir),
  });
}

export function writeConfirmation(confirmation: OnboardConfirmation, dest: string = DEFAULT_ACTIVE_PATH): string {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(confirmation, null, 2)}\n`);
  return dest;
}

/**
 * A dataset folder other than the default may only be loaded from DATASET_DIR after a person confirmed it
 * (`npm run onboard:confirm`). Reads onboarding/active.json, or ONBOARDING_CONFIRMATION if set.
 */
export function assertDatasetConfirmed(datasetDir: string, file: string = process.env.ONBOARDING_CONFIRMATION || DEFAULT_ACTIVE_PATH): void {
  const wanted = path.resolve(datasetDir);
  let confirmed: OnboardConfirmation | undefined;
  try {
    confirmed = readConfirmation(file);
  } catch {
    confirmed = undefined;
  }
  if (!confirmed || path.resolve(confirmed.datasetDir) !== wanted) {
    throw new OnboardError(`Dataset ${datasetDir} is not confirmed. Run npm run onboard:propose and npm run onboard:confirm first.`);
  }
  // The confirmation covers the files as they were reviewed (U2): a changed, added or removed CSV needs a new one.
  const now = datasetFileHashes(datasetDir);
  const names = new Set([...Object.keys(now), ...Object.keys(confirmed.fileHashes)]);
  const changed = [...names].filter((n) => now[n] !== confirmed!.fileHashes[n]).sort();
  if (changed.length) {
    throw new OnboardError(`Dataset ${datasetDir} changed since it was confirmed (${changed.join(', ')}). Review it again with npm run onboard:propose and npm run onboard:confirm.`);
  }
}

export function readConfirmation(file: string): OnboardConfirmation {
  return OnboardConfirmation.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}
