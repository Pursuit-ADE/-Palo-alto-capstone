import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { activeDatasetLabel, buildSeed } from '@/db/seed';
import { confirmOnboarding, OnboardError, writeConfirmation } from '@/onboard/confirm';
import { profileDataset } from '@/onboard/profile';
import { proposeMetrics } from '@/onboard/propose';
import { loadRegistry } from '@/registry/load';
import { answerIntent } from '@/semantic/answer';

const NORTHSTAR = path.join(process.cwd(), 'data', 'northstar-crm');
const MAVEN = path.join(process.cwd(), 'data', 'maven-crm');

describe('A7 dataset onboarding', () => {
  it('profiles the second CRM folder as Maven-shaped', () => {
    const profile = profileDataset(NORTHSTAR);
    expect(profile.mavenShaped).toBe(true);
    expect(profile.files.map((f) => f.file).sort()).toEqual([
      'accounts.csv',
      'products.csv',
      'sales_pipeline.csv',
      'sales_teams.csv',
    ]);
    expect(profile.files.find((f) => f.file === 'accounts.csv')!.rows).toBe(6);
    expect(profile.files.find((f) => f.file === 'sales_pipeline.csv')!.rows).toBe(12);
  });

  it('proposes only the three existing governed metrics', () => {
    const proposal = proposeMetrics(profileDataset(NORTHSTAR));
    expect(proposal.blockers).toEqual([]);
    expect(proposal.proposedMetrics.map((m) => m.id)).toEqual([
      'open_pipeline',
      'pipeline_coverage',
      'open_opportunity_count',
    ]);
    const registry = loadRegistry();
    for (const id of proposal.proposedMetrics.map((m) => m.id)) expect(registry.metrics.has(id)).toBe(true);
  });

  it('refuses a folder that is not the CRM shape and does not invent a metric', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboard-'));
    fs.writeFileSync(path.join(dir, 'notes.csv'), 'title,body\nhello,world\n');
    const proposal = proposeMetrics(profileDataset(dir));
    expect(proposal.profile.mavenShaped).toBe(false);
    expect(proposal.proposedMetrics).toEqual([]);
    expect(proposal.blockers.length).toBeGreaterThan(0);
    expect(() => confirmOnboarding(proposal, { confirmedBy: 'tester', metricIds: ['open_pipeline'] })).toThrow(OnboardError);
  });

  it('refuses confirmation of a metric that is not in the registry', () => {
    const proposal = proposeMetrics(profileDataset(NORTHSTAR));
    expect(() => confirmOnboarding(proposal, { confirmedBy: 'tester', metricIds: ['win_rate'] })).toThrow(/ungoverned|Unknown/);
  });

  it('writes a confirmation without creating a new metric file', () => {
    const proposal = proposeMetrics(profileDataset(NORTHSTAR));
    const confirmation = confirmOnboarding(proposal, {
      confirmedBy: 'Mofazzal',
      metricIds: ['open_pipeline', 'pipeline_coverage', 'open_opportunity_count'],
      seed: 'northstar-v1',
      writtenAt: '2026-10-14T00:00:00.000Z',
    });
    const dest = path.join(os.tmpdir(), `onboard-active-${Date.now()}.json`);
    writeConfirmation(confirmation, dest);
    expect(JSON.parse(fs.readFileSync(dest, 'utf8')).status).toBe('confirmed');
    expect(fs.existsSync(path.join(process.cwd(), 'registry', 'metrics', 'northstar.json'))).toBe(false);
  });
});

describe('A7 confirmed dataset is queryable', () => {
  const northstar = buildSeed('northstar-v1', { dataDir: NORTHSTAR });
  const maven = buildSeed();
  let database: Database;

  beforeAll(async () => {
    database = await openDatabase('northstar-v1', { dataDir: NORTHSTAR });
  });
  afterAll(async () => {
    await database.close();
  });

  it('loads Northstar, not the Maven row counts', () => {
    expect(northstar.accounts).toHaveLength(6);
    expect(northstar.opportunities).toHaveLength(12);
    expect(maven.accounts).toHaveLength(85);
    expect(activeDatasetLabel()).toBe('Maven CRM data');
    expect(activeDatasetLabel(NORTHSTAR)).toBe('Northstar CRM data');
    expect(buildSeed(undefined, { dataDir: NORTHSTAR }).snapshot.id).toBe('snap_northstar-crm');
  });

  it('open pipeline for the analyst is the hand-computed Northstar total', async () => {
    const open = northstar.opportunities.filter((o) => !o.isClosed);
    const expected = open.reduce((t, o) => t + Number(o.amount), 0);
    expect(expected).toBe(16500);
    const r = await answerIntent(database, loadRegistry(), 'u_analyst', { metric: 'open_pipeline', filters: {}, groupBy: [] });
    expect(r.rows[0]!.value).toBeCloseTo(expected, 2);
    expect(r.provenance.snapshotId).toBe(northstar.snapshot.id);
  });

  it('still refuses an East seller who asks for West', async () => {
    const { ScopeViolation } = await import('@/semantic/scope');
    const { ask } = await import('@/semantic/answer');
    await expect(ask(database, loadRegistry(), 'u_ts_east', 'number of open deals in the west')).rejects.toBeInstanceOf(ScopeViolation);
  });
});
