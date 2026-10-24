#!/usr/bin/env tsx
// PRD A7: profile a tabular folder, propose the existing governed metrics, then a human confirms.
// The script never writes SQL or a new metric definition.
import fs from 'node:fs';
import path from 'node:path';
import { confirmOnboarding, writeConfirmation } from '../src/onboard/confirm';
import { profileDataset } from '../src/onboard/profile';
import { proposeMetrics } from '../src/onboard/propose';
import { OnboardProposal } from '../src/onboard/types';

function usage(): never {
  console.error(`Usage:
  npm run onboard:profile -- <dataset-dir>
  npm run onboard:propose -- <dataset-dir> [--out onboarding/proposal.json]
  npm run onboard:confirm -- <proposal.json> --by <name> --metrics open_pipeline,pipeline_coverage,open_opportunity_count
`);
  process.exit(1);
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const [command, target] = process.argv.slice(2);
if (!command || !target) usage();

if (command === 'profile') {
  console.log(JSON.stringify(profileDataset(target), null, 2));
} else if (command === 'propose') {
  const proposal = proposeMetrics(profileDataset(target));
  const out = arg('--out');
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(proposal, null, 2)}\n`);
    console.log(`Wrote ${out}`);
  }
  console.log(JSON.stringify(proposal, null, 2));
} else if (command === 'confirm') {
  const by = arg('--by');
  const metrics = arg('--metrics');
  if (!by || !metrics) usage();
  const proposal = OnboardProposal.parse(JSON.parse(fs.readFileSync(target, 'utf8')));
  const confirmation = confirmOnboarding(proposal, {
    confirmedBy: by,
    metricIds: metrics.split(',').map((s) => s.trim()).filter(Boolean),
  });
  const dest = writeConfirmation(confirmation);
  console.log(`Confirmed. Seed this dataset with DATASET_DIR=${confirmation.datasetDir}`);
  console.log(`Wrote ${dest}`);
} else usage();
