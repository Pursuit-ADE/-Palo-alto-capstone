// Builds the dataset the app answers from.
// Real tables: the public-domain Maven Analytics "CRM Sales Opportunities" sample in data/maven-crm
// (fictional company "MavenTech", Oct 2016 - Dec 2017). Synthetic, deterministic additions: technical
// sellers, quotas, contacts, support cases and engagements (the sample has none of these).
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SEED = 'alto-pals-v2';
export const AS_OF_DATE = '2026-10-08';
// The sample's last recorded date. Every date is shifted by the same number of days so that
// the end of the sample lands on AS_OF_DATE; durations and order are unchanged.
export const SOURCE_END_DATE = '2017-12-31';
// Median days from "Engaging" to "Won" in the sample; used to estimate close dates of open deals.
export const MEDIAN_CYCLE_DAYS = 57;

// Palo Alto Networks' fiscal year starts Aug 1, so FY27 Q1 = Aug 1 - Oct 31, 2026 (assumption, see glossary).
export const QUOTA_PERIODS = [
  { period: 'FY27-Q1', start: '2026-08-01', end: '2026-10-31' },
  { period: 'FY27-Q2', start: '2026-11-01', end: '2027-01-31' },
] as const;

export const REGIONS = [
  { id: 'central', name: 'Central' },
  { id: 'east', name: 'East' },
  { id: 'west', name: 'West' },
] as const;

// Identities shown in the demo picker. Sales reps and managers are real names from the sample.
export const DEMO_USER_IDS = ['u_ts_east', 'u_ts_west', 'u_darcel_schlecht', 'u_mgr_melvin_marxen', 'u_analyst'] as const;

const DEFAULT_DATA_DIR = path.join(process.cwd(), 'data', 'maven-crm');

export function resolveDataDir(override?: string): string {
  return path.resolve(override || process.env.DATASET_DIR || DEFAULT_DATA_DIR);
}

export function activeDatasetLabel(override?: string): string {
  const dir = resolveDataDir(override);
  const folder = path.basename(dir);
  if (folder === 'maven-crm') return 'Maven CRM data';
  if (folder === 'northstar-crm') return 'Northstar CRM data';
  return `${folder.replace(/[-_]+/g, ' ')} data`;
}

export function defaultSeedForDir(override?: string): string {
  const dir = resolveDataDir(override);
  return dir === path.resolve(DEFAULT_DATA_DIR) ? DEFAULT_SEED : path.basename(dir);
}

function parseCsv(file: string, dataDir = DEFAULT_DATA_DIR): Record<string, string>[] {
  const text = fs.readFileSync(path.join(dataDir, file), 'utf8').replace(/\r/g, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c !== ''));
  return body.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ''])));
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

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

export function hashString(s: string): number {
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

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

const SHIFT_DAYS = daysBetween(SOURCE_END_DATE, AS_OF_DATE);
export const shiftDate = (iso: string) => addDays(iso, SHIFT_DAYS);

// Known typos and naming mismatches in the public sample.
const SECTOR_FIX: Record<string, string> = { technolgy: 'technology' };
const PRODUCT_FIX: Record<string, string> = { GTXPro: 'GTX Pro' };

const TITLES = [
  { title: 'Chief Information Security Officer', cxo: true },
  { title: 'Chief Information Officer', cxo: true },
  { title: 'Chief Technology Officer', cxo: true },
  { title: 'Director of Security Operations', cxo: false },
  { title: 'Network Engineering Manager', cxo: false },
  { title: 'Cloud Architect', cxo: false },
];
const ASSETS = ['Zero Trust whitepaper', 'SOC modernization whitepaper', 'Cloud security report', 'AI security webinar'];

export type Dataset = ReturnType<typeof buildSeed>;

const entityNamesCache = new Map<string, { products: string[]; accounts: string[]; people: string[]; sectors: string[] }>();

/**
 * Names the active dataset holds that a question can't filter by yet: products and product series, accounts,
 * sectors, and people. The normalizer asks a clarifying question when one appears, instead of quietly answering
 * for the whole scope. Read from the same folder the database was loaded from.
 */
export function entityNames(dataDir: string = resolveDataDir()) {
  let names = entityNamesCache.get(dataDir);
  if (!names) {
    const products = parseCsv('products.csv', dataDir);
    const accounts = parseCsv('accounts.csv', dataDir);
    const teams = parseCsv('sales_teams.csv', dataDir);
    names = {
      products: [...new Set(products.flatMap((p) => [p.product!, p.series!]))],
      accounts: accounts.map((a) => a.account!),
      people: [...new Set(teams.flatMap((t) => [t.sales_agent!, t.manager!]))],
      sectors: [...new Set(accounts.map((a) => SECTOR_FIX[a.sector!] ?? a.sector!))],
    };
    entityNamesCache.set(dataDir, names);
  }
  return names;
}

export function buildSeed(seed?: string, options: { dataDir?: string } = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const resolvedSeed = seed ?? defaultSeedForDir(options.dataDir);
  const rand = mulberry32(hashString(resolvedSeed));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const snapshotId = `snap_${resolvedSeed}`;

  const snapshot = {
    id: snapshotId,
    seed: resolvedSeed,
    asOfDate: AS_OF_DATE,
    loadedAt: new Date(`${AS_OF_DATE}T06:00:00Z`),
    notes:
      dataDir === path.resolve(DEFAULT_DATA_DIR)
        ? `Maven Analytics CRM Sales Opportunities sample (public domain, fictional company), dates shifted +${SHIFT_DAYS} days; quotas, contacts, cases, engagements and technical sellers are synthetic.`
        : `CRM sample from ${path.relative(process.cwd(), dataDir) || dataDir}, dates shifted +${SHIFT_DAYS} days; quotas, contacts, cases, engagements and technical sellers are synthetic.`,
  };
  const regions = REGIONS.map((r) => ({ ...r }));

  // People: sales agents and managers from the sample, plus synthetic technical sellers and an analyst.
  const teams = parseCsv('sales_teams.csv', dataDir);
  const managerIds = new Map<string, { id: string; region: string }>();
  for (const t of teams) {
    if (!managerIds.has(t.manager!)) managerIds.set(t.manager!, { id: `u_mgr_${slug(t.manager!)}`, region: t.regional_office!.toLowerCase() });
  }
  const users: { id: string; displayName: string; role: string; regionId: string | null; managerId: string | null; source: string }[] = [];
  for (const [name, m] of managerIds) {
    users.push({ id: m.id, displayName: `${name} (Sales manager, ${m.region[0]!.toUpperCase()}${m.region.slice(1)})`, role: 'sales_manager', regionId: m.region, managerId: null, source: 'maven' });
  }
  const agentIds = new Map<string, { id: string; region: string }>();
  for (const t of teams) {
    const region = t.regional_office!.toLowerCase();
    const id = `u_${slug(t.sales_agent!)}`;
    agentIds.set(t.sales_agent!, { id, region });
    users.push({ id, displayName: `${t.sales_agent} (Sales rep, ${t.regional_office})`, role: 'sales_rep', regionId: region, managerId: managerIds.get(t.manager!)!.id, source: 'maven' });
  }
  const eastMgr = [...managerIds.values()].find((m) => m.region === 'east')!.id;
  const westMgr = [...managerIds.values()].find((m) => m.region === 'west')!.id;
  users.push(
    { id: 'u_ts_east', displayName: 'Jordan Lee (Technical seller, East)', role: 'technical_seller', regionId: 'east', managerId: managerIds.get('Cara Losch')?.id ?? eastMgr, source: 'synthetic' },
    { id: 'u_ts_west', displayName: 'Sam Rivera (Technical seller, West)', role: 'technical_seller', regionId: 'west', managerId: managerIds.get('Celia Rouche')?.id ?? westMgr, source: 'synthetic' },
    { id: 'u_analyst', displayName: 'Avery Patel (Customer analytics, all regions)', role: 'analyst', regionId: null, managerId: null, source: 'synthetic' },
  );

  const products = parseCsv('products.csv', dataDir).map((p) => ({ id: p.product!, series: p.series!, listPrice: Number(p.sales_price).toFixed(2) }));
  const listPrice = new Map(products.map((p) => [p.id, Number(p.listPrice)]));

  const accounts = parseCsv('accounts.csv', dataDir).map((a) => ({
    id: `acc_${slug(a.account!)}`,
    snapshotId,
    name: a.account!,
    sector: SECTOR_FIX[a.sector!] ?? a.sector!,
    yearEstablished: a.year_established ? Number(a.year_established) : null,
    revenueMusd: a.revenue ? Number(a.revenue).toFixed(2) : null,
    employees: a.employees ? Number(a.employees) : null,
    hqCountry: a.office_location || null,
    parentAccount: a.subsidiary_of || null,
  }));
  const accountId = new Map(accounts.map((a) => [a.name, a.id]));

  const opportunities = parseCsv('sales_pipeline.csv', dataDir).map((o) => {
    const agent = agentIds.get(o.sales_agent!)!;
    const product = PRODUCT_FIX[o.product!] ?? o.product!;
    const isClosed = o.deal_stage === 'Won' || o.deal_stage === 'Lost';
    const engageDate = o.engage_date ? shiftDate(o.engage_date) : null;
    let closeDate: string;
    if (o.close_date) closeDate = shiftDate(o.close_date);
    else {
      // Open deal: expected close = engage date + median cycle. Past-due or unscheduled deals are
      // rolled forward 0-59 days from the as-of date (stable per deal), as a CRM hygiene rule would.
      const expected = engageDate ? addDays(engageDate, MEDIAN_CYCLE_DAYS) : null;
      closeDate = expected && expected > AS_OF_DATE ? expected : addDays(AS_OF_DATE, hashString(o.opportunity_id!) % 60);
    }
    return {
      id: o.opportunity_id!,
      snapshotId,
      accountId: o.account ? accountId.get(o.account)! : null,
      regionId: agent.region,
      ownerUserId: agent.id,
      productId: product,
      stage: o.deal_stage!,
      // Open deals have no value in the sample; the product's list price is used as the estimate.
      amount: (o.close_value ? Number(o.close_value) : listPrice.get(product)!).toFixed(2),
      amountIsEstimate: !o.close_value,
      engageDate,
      closeDate,
      closeDateIsEstimate: !o.close_date,
      isClosed,
      isWon: o.deal_stage === 'Won',
    };
  });

  // Account teams: every agent who has a deal on an account, plus the technical seller supporting that agent's team.
  const team = new Map<string, { accountId: string; userId: string; teamRole: string; snapshotId: string }>();
  const tsByManager = new Map(users.filter((u) => u.role === 'technical_seller').map((u) => [u.managerId, u.id]));
  const managerOf = new Map(users.map((u) => [u.id, u.managerId]));
  for (const o of opportunities) {
    if (!o.accountId) continue;
    team.set(`${o.accountId}|${o.ownerUserId}`, { accountId: o.accountId, userId: o.ownerUserId, teamRole: 'account_owner', snapshotId });
    const ts = tsByManager.get(managerOf.get(o.ownerUserId) ?? null);
    if (ts) team.set(`${o.accountId}|${ts}`, { accountId: o.accountId, userId: ts, teamRole: 'technical_seller', snapshotId });
  }
  const accountTeam = [...team.values()];

  // Synthetic quotas: 1.2x each rep's average quarterly won revenue over the last 4 (shifted) quarters, rounded to $1,000.
  const windowStart = addDays(AS_OF_DATE, -365);
  const wonByRep = new Map<string, number>();
  for (const o of opportunities) {
    if (o.isWon && o.closeDate > windowStart) wonByRep.set(o.ownerUserId, (wonByRep.get(o.ownerUserId) ?? 0) + Number(o.amount));
  }
  const quotas = QUOTA_PERIODS.flatMap((p) =>
    users
      .filter((u) => u.role === 'sales_rep' && (wonByRep.get(u.id) ?? 0) > 0)
      .map((u) => ({
        id: `quota_${u.id}_${p.period}`,
        snapshotId,
        userId: u.id,
        regionId: u.regionId!,
        period: p.period,
        periodStart: p.start,
        periodEnd: p.end,
        amount: (Math.round(((wonByRep.get(u.id)! / 4) * 1.2) / 1000) * 1000).toFixed(2),
      })),
  );

  const contacts = accounts.flatMap((a, ai) =>
    [0, 1, 2].map((ci) => {
      const t = pick(TITLES);
      return { id: `con_${ai + 1}_${ci + 1}`, snapshotId, accountId: a.id, fullName: `Contact ${ai + 1}-${ci + 1}`, title: t.title, isCxo: t.cxo };
    }),
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

  return { snapshot, regions, users, products, accounts, accountTeam, contacts, opportunities, quotas, supportCases, engagements };
}

/** Identities for the demo picker, in display order. */
export function demoUsers(data: Dataset = buildSeed()) {
  const picked = DEMO_USER_IDS.map((id) => data.users.find((u) => u.id === id)!).filter(Boolean);
  if (picked.length === DEMO_USER_IDS.length) return picked;
  const rep = data.users.find((u) => u.role === 'sales_rep');
  const mgr = data.users.find((u) => u.role === 'sales_manager');
  return [
    data.users.find((u) => u.id === 'u_ts_east')!,
    data.users.find((u) => u.id === 'u_ts_west')!,
    ...(rep ? [rep] : []),
    ...(mgr ? [mgr] : []),
    data.users.find((u) => u.id === 'u_analyst')!,
  ].filter(Boolean);
}
