// Deterministic synthetic seed. Same seed string -> identical rows, so tests and demos are repeatable.
// 2 regions, 5 mock identities, accounts, account teams, contacts, opportunities, quotas, cases, engagements.

export const DEFAULT_SEED = 'alto-pals-v1';
export const AS_OF_DATE = '2026-10-08';

// Palo Alto Networks' fiscal year starts Aug 1, so FY27 Q1 = Aug 1 - Oct 31, 2026 (assumption, see glossary).
export const QUOTA_PERIODS = [
  { period: 'FY27-Q1', start: '2026-08-01', end: '2026-10-31' },
  { period: 'FY27-Q2', start: '2026-11-01', end: '2027-01-31' },
] as const;

export const STAGES = ['Prospecting', 'Qualification', 'Technical Validation', 'Proposal', 'Negotiation'] as const;

function mulberry32(seedNum: number) {
  let a = seedNum >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const USERS = [
  { id: 'u_ts_east', displayName: 'Jordan Lee (Technical seller, East)', role: 'technical_seller', regionId: 'east' },
  { id: 'u_ts_west', displayName: 'Sam Rivera (Technical seller, West)', role: 'technical_seller', regionId: 'west' },
  { id: 'u_ao_east', displayName: 'Casey Morgan (Account owner, East)', role: 'account_owner', regionId: 'east' },
  { id: 'u_ao_west', displayName: 'Riley Chen (Account owner, West)', role: 'account_owner', regionId: 'west' },
  { id: 'u_analyst', displayName: 'Avery Patel (Customer analytics, all regions)', role: 'analyst', regionId: null },
] as const;

const INDUSTRIES = ['Financial services', 'Healthcare', 'Retail', 'Manufacturing', 'Public sector', 'Technology'];
const NAME_A = ['Northwind', 'Bluefin', 'Cedar', 'Granite', 'Harbor', 'Juniper', 'Keystone', 'Lumen', 'Meridian', 'Orchid', 'Pioneer', 'Quarry'];
const NAME_B = ['Health', 'Bank', 'Logistics', 'Retail', 'Energy', 'Labs', 'Systems', 'Foods'];
const TITLES = [
  { title: 'Chief Information Security Officer', cxo: true },
  { title: 'Chief Information Officer', cxo: true },
  { title: 'Chief Technology Officer', cxo: true },
  { title: 'Director of Security Operations', cxo: false },
  { title: 'Network Engineering Manager', cxo: false },
  { title: 'Cloud Architect', cxo: false },
];
const ASSETS = ['Zero Trust whitepaper', 'SOC modernization whitepaper', 'Cloud security report', 'AI security webinar'];

export type SeedData = ReturnType<typeof buildSeed>;

export function buildSeed(seed: string = DEFAULT_SEED) {
  const rand = mulberry32(hashString(seed));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const snapshotId = `snap_${seed}`;

  const snapshot = {
    id: snapshotId,
    seed,
    asOfDate: AS_OF_DATE,
    loadedAt: new Date(`${AS_OF_DATE}T06:00:00Z`),
    notes: 'Synthetic data only. No real customer or Palo Alto Networks data.',
  };
  const regions = [
    { id: 'east', name: 'East' },
    { id: 'west', name: 'West' },
  ];
  const users = USERS.map((u) => ({ ...u }));

  const accounts: {
    id: string; snapshotId: string; name: string; industry: string; regionId: string;
    ownerUserId: string; technicalSellerUserId: string | null;
  }[] = [];
  const accountTeam: { accountId: string; userId: string; teamRole: string; snapshotId: string }[] = [];
  const usedNames = new Set<string>();
  for (const region of ['east', 'west'] as const) {
    for (let i = 0; i < 10; i++) {
      let name = '';
      do name = `${pick(NAME_A)} ${pick(NAME_B)}`; while (usedNames.has(name));
      usedNames.add(name);
      const id = `acc_${region}_${String(i + 1).padStart(2, '0')}`;
      const owner = `u_ao_${region}`;
      const ts = `u_ts_${region}`;
      accounts.push({ id, snapshotId, name, industry: pick(INDUSTRIES), regionId: region, ownerUserId: owner, technicalSellerUserId: ts });
      accountTeam.push({ accountId: id, userId: owner, teamRole: 'account_owner', snapshotId });
      accountTeam.push({ accountId: id, userId: ts, teamRole: 'technical_seller', snapshotId });
    }
  }

  const contacts = accounts.flatMap((a, ai) =>
    [0, 1, 2].map((ci) => {
      const t = pick(TITLES);
      return { id: `con_${ai + 1}_${ci + 1}`, snapshotId, accountId: a.id, fullName: `Contact ${ai + 1}-${ci + 1}`, title: t.title, isCxo: t.cxo };
    }),
  );

  const opportunities = accounts.flatMap((a, ai) =>
    [0, 1, 2].map((oi) => {
      const closed = rand() < 0.3;
      const won = closed && rand() < 0.5;
      return {
        id: `opp_${ai + 1}_${oi + 1}`,
        snapshotId,
        accountId: a.id,
        regionId: a.regionId,
        ownerUserId: a.ownerUserId,
        name: `${a.name} ${pick(['NGFW refresh', 'SASE rollout', 'Cortex XSIAM', 'Prisma Cloud', 'Unit 42 retainer'])}`,
        stage: closed ? (won ? 'Closed Won' : 'Closed Lost') : pick(STAGES),
        amount: (int(40, 900) * 1000).toFixed(2),
        closeDate: addDays('2026-08-01', int(0, 180)),
        isClosed: closed,
        isWon: won,
      };
    }),
  );

  const quotas = QUOTA_PERIODS.flatMap((p) =>
    (['east', 'west'] as const).map((region) => ({
      id: `quota_${region}_${p.period}`,
      snapshotId,
      userId: `u_ao_${region}`,
      regionId: region,
      period: p.period,
      periodStart: p.start,
      periodEnd: p.end,
      amount: (int(18, 30) * 100000).toFixed(2),
    })),
  );

  const supportCases = accounts.flatMap((a, ai) =>
    rand() < 0.5
      ? [{
          id: `case_${ai + 1}`,
          snapshotId,
          accountId: a.id,
          severity: pick(['P1', 'P2', 'P3', 'P4']),
          status: pick(['Open', 'Open', 'Closed']),
          subject: pick(['Firewall outage at branch', 'Policy push failing', 'Agent upgrade issue', 'Log forwarding delay']),
          openedAt: new Date(`${addDays('2026-09-01', int(0, 37))}T${String(int(0, 23)).padStart(2, '0')}:00:00Z`),
        }]
      : [],
  );

  const engagements = contacts
    .filter(() => rand() < 0.35)
    .map((c, i) => ({
      id: `eng_${i + 1}`,
      snapshotId,
      accountId: c.accountId,
      contactId: c.id,
      type: rand() < 0.7 ? 'whitepaper_download' : 'campaign_response',
      asset: pick(ASSETS),
      occurredAt: new Date(`${addDays('2026-09-01', int(0, 37))}T${String(int(0, 23)).padStart(2, '0')}:00:00Z`),
    }));

  return { snapshot, regions, users, accounts, accountTeam, contacts, opportunities, quotas, supportCases, engagements };
}
