// Profiling must catch names the loader turns into the same id: the loader slugs names into ids (src/db/seed.ts), so
// "Alpha Inc" and "Alpha-Inc" would both become acc_alpha_inc and the load would fail on a duplicate key after the
// folder had been confirmed (project review, Nov 1, finding 6).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSeed, DEMO_PERSON_IDS } from '@/db/seed';
import { profileDataset } from '@/onboard/profile';

const NORTHSTAR = path.join(process.cwd(), 'data', 'northstar-crm');

/** A copy of the Northstar folder with extra rows appended to one file. */
function folderWith(extra: Partial<Record<'accounts' | 'sales_teams', string>>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboard-ids-'));
  for (const file of fs.readdirSync(NORTHSTAR)) fs.copyFileSync(path.join(NORTHSTAR, file), path.join(dir, file));
  for (const [name, rows] of Object.entries(extra)) fs.appendFileSync(path.join(dir, `${name}.csv`), rows);
  return dir;
}

const ACCOUNT = (name: string) => `${name},technology,2001,10.5,50,United States,\n`;
const TEAM = (agent: string, manager: string, region = 'East') => `${agent},${manager},${region}\n`;

describe('onboarding profile: names that become the same id', () => {
  it('still passes the untouched Northstar folder', () => {
    expect(profileDataset(NORTHSTAR)).toMatchObject({ mavenShaped: true, problems: [] });
  });

  it('refuses two account names that become one id, and names both', () => {
    const profile = profileDataset(folderWith({ accounts: ACCOUNT('Alpha Inc') + ACCOUNT('Alpha-Inc') }));
    expect(profile.mavenShaped).toBe(false);
    expect(profile.problems.join('\n')).toMatch(/account "Alpha Inc" and account "Alpha-Inc" both become the id acc_alpha_inc/);
  });

  it('refuses names that differ only in case or punctuation, and says "all" for three', () => {
    const profile = profileDataset(folderWith({ accounts: ACCOUNT('Zeta Corp') + ACCOUNT('zeta corp') + ACCOUNT('Zeta.Corp') }));
    expect(profile.problems.join('\n')).toMatch(/account "Zeta Corp" and account "zeta corp" and account "Zeta\.Corp" all become the id acc_zeta_corp/);
  });

  it('refuses two sales reps that become one id', () => {
    const profile = profileDataset(folderWith({ sales_teams: TEAM('Mia Cho', 'Owen Blake') + TEAM('Mia-Cho', 'Owen Blake') }));
    expect(profile.mavenShaped).toBe(false);
    expect(profile.problems.join('\n')).toMatch(/rep "Mia Cho" and rep "Mia-Cho".*u_mia_cho/);
  });

  it('refuses two managers that become one id', () => {
    const profile = profileDataset(folderWith({ sales_teams: TEAM('Rae Lin', 'Kit Moss') + TEAM('Ben Ode', 'Kit-Moss') }));
    expect(profile.mavenShaped).toBe(false);
    expect(profile.problems.join('\n')).toMatch(/manager "Kit Moss" and manager "Kit-Moss".*u_mgr_kit_moss/);
  });

  it('refuses a rep whose id is a manager id, and a rep who takes one of the demo ids', () => {
    // "Mgr Owen Blake" becomes u_mgr_owen_blake, the id of the manager Owen Blake. "TS East" becomes u_ts_east.
    const profile = profileDataset(folderWith({ sales_teams: TEAM('Mgr Owen Blake', 'Owen Blake') + TEAM('TS East', 'Owen Blake') }));
    const text = profile.problems.join('\n');
    expect(text).toMatch(/rep "Mgr Owen Blake" and manager "Owen Blake".*u_mgr_owen_blake/);
    expect(text).toMatch(/rep "TS East" would take the id u_ts_east, which belongs to a demo person/);
  });

  it('refuses a name with no letters or digits, which has nothing to become an id from', () => {
    const profile = profileDataset(folderWith({ accounts: ACCOUNT('***') }));
    expect(profile.mavenShaped).toBe(false);
    expect(profile.problems.join('\n')).toMatch(/"\*\*\*".*no letters or digits/);
  });

  it('keeps the list of demo-person ids in step with the people the loader adds', () => {
    expect(buildSeed().users.map((u) => u.id)).toEqual(expect.arrayContaining(DEMO_PERSON_IDS));
  });

  it('reports the same collision the loader hits, so the profile is not stricter than needed', () => {
    const dir = folderWith({ accounts: ACCOUNT('Alpha Inc') + ACCOUNT('Alpha-Inc') });
    const ids = buildSeed('collision', { dataDir: dir }).accounts.map((a) => a.id);
    expect(new Set(ids).size).toBeLessThan(ids.length);
    expect(profileDataset(dir).mavenShaped).toBe(false);
  });
});
