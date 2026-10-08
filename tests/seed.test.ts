import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildSeed } from '@/db/seed';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

describe('deterministic synthetic seed', () => {
  it('produces identical data for the same seed', () => {
    expect(hash(buildSeed('x'))).toBe(hash(buildSeed('x')));
  });

  it('produces different data for a different seed', () => {
    expect(hash(buildSeed('x').opportunities)).not.toBe(hash(buildSeed('y').opportunities));
  });

  it('has 2 regions, 5 mock identities, quotas for both regions and an account team for every account', () => {
    const s = buildSeed();
    expect(s.regions.map((r) => r.id)).toEqual(['east', 'west']);
    expect(s.users).toHaveLength(5);
    for (const region of ['east', 'west']) expect(s.quotas.some((q) => q.regionId === region)).toBe(true);
    for (const a of s.accounts) expect(s.accountTeam.filter((t) => t.accountId === a.id).length).toBeGreaterThan(0);
  });

  it('includes event data for both alert types', () => {
    const s = buildSeed();
    expect(s.supportCases.length).toBeGreaterThan(0);
    expect(s.engagements.length).toBeGreaterThan(0);
  });
});
