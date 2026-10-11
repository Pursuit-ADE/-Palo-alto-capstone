import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { accountTeam, alertDeliveries, alertSubscriptions, supportCases } from '@/db/schema';
import { buildSeed } from '@/db/seed';
import { createChannels, slackText, type Channels } from '@/alerts/channels';
import { flushDigests, inbox, inQuietHours, runAlerts } from '@/alerts/engine';
import { loadRules } from '@/alerts/rules';

const rules = loadRules();
const data = buildSeed();
const SINCE = new Date('2026-09-01T00:00:00Z');
const DAY = new Date('2026-10-08T15:00:00Z'); // 15:00 UTC
const NIGHT = new Date('2026-10-08T23:00:00Z'); // inside 22-07 quiet hours

type Call = { channel: string; userId: string; ids: string[]; isDigest: boolean };
function recorder(): Channels & { calls: Call[] } {
  const calls: Call[] = [];
  return { calls, async deliver(channel, userId, items, isDigest) { calls.push({ channel, userId, ids: items.map((i) => i.id), isDigest }); return true; } };
}

const sub = (userId: string, ruleId: string, extra: Partial<typeof alertSubscriptions.$inferInsert> = {}) => ({
  userId, ruleId, frequency: 'realtime', channel: 'inbox', quietStartHour: null, quietEndHour: null, criticalBypass: false, ...extra,
});

// An account on Jordan's (u_ts_east) team, and a fresh P1 case on it opened during the test window.
const jordanAccount = data.accountTeam.find((t) => t.userId === 'u_ts_east')!.accountId;
async function addCase(db: Database['db'], id: string, severity: string, at: Date, subject = 'Firewall outage at branch') {
  await db.insert(supportCases).values({ id, snapshotId: data.snapshot.id, accountId: jordanAccount, severity, status: 'Open', subject, openedAt: at });
}

let database: Database;
beforeEach(async () => {
  database = await openDatabase();
  await database.db.delete(supportCases); // tests control their own case events
});
afterEach(async () => {
  await database.client.close();
});

const deliveries = (userId?: string) =>
  userId ? database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, userId)) : database.db.select().from(alertDeliveries);

describe('rule catalog (L1)', () => {
  it('loads the two versioned rules', () => {
    expect([...rules.keys()].sort()).toEqual(['cxo_engagement', 'high_severity_case']);
  });

  const loadBad = (file: string, change: (r: Record<string, any>) => void) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-'));
    const r = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'rules', file), 'utf8'));
    change(r);
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(r));
    return () => loadRules(dir);
  };

  it('rejects a rule with an unknown template placeholder', () => {
    expect(loadBad('cxo_engagement.json', (r) => { r.explain = 'Leak {email}'; })).toThrow();
  });

  it('rejects a placeholder the event type does not provide', () => {
    expect(loadBad('high_severity_case.json', (r) => { r.explain = 'Case at {account} about {asset}'; })).toThrow();
  });

  it('rejects a misspelled case status instead of silently matching nothing', () => {
    expect(loadBad('high_severity_case.json', (r) => { r.conditions.statusIn = ['open']; })).toThrow();
  });
});

describe('private routing (L4)', () => {
  it('only alerts a rep about accounts where they own deals', async () => {
    await database.db.insert(alertSubscriptions).values(sub('u_darcel_schlecht', 'cxo_engagement'));
    await runAlerts(database.db, rules, recorder(), SINCE, DAY);
    const mine = new Set(data.accountTeam.filter((t) => t.userId === 'u_darcel_schlecht').map((t) => t.accountId));
    const rows = await deliveries('u_darcel_schlecht');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(mine.has(r.accountId)).toBe(true);
  });

  it('sends nothing to a rep with no accounts, even though they subscribed', async () => {
    const idle = data.users.find((u) => u.role === 'sales_rep' && !data.accountTeam.some((t) => t.userId === u.id))!;
    await database.db.insert(alertSubscriptions).values(sub(idle.id, 'cxo_engagement'));
    await runAlerts(database.db, rules, recorder(), SINCE, DAY);
    expect(await deliveries(idle.id)).toHaveLength(0);
  });

  it('ignores subscribers outside the rule audience', async () => {
    await addCase(database.db, 'case_t1', 'P1', new Date('2026-10-08T10:00:00Z'));
    await database.db.insert(alertSubscriptions).values(sub('u_darcel_schlecht', 'high_severity_case'));
    await runAlerts(database.db, rules, recorder(), SINCE, DAY);
    expect(await deliveries('u_darcel_schlecht')).toHaveLength(0);
  });
});

describe('dedupe', () => {
  it('creates and sends each alert once, however often the engine runs', async () => {
    await addCase(database.db, 'case_t1', 'P2', new Date('2026-10-08T10:00:00Z'));
    await database.db.insert(alertSubscriptions).values(sub('u_ts_east', 'high_severity_case'));
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(await deliveries('u_ts_east')).toHaveLength(1);
    expect(ch.calls).toHaveLength(1);
  });
});

describe('preferences (L3)', () => {
  it('handles quiet hours that cross midnight', () => {
    const q = { quietStartHour: 22, quietEndHour: 7 };
    expect(inQuietHours(q, NIGHT)).toBe(true);
    expect(inQuietHours(q, new Date('2026-10-08T06:00:00Z'))).toBe(true);
    expect(inQuietHours(q, DAY)).toBe(false);
  });

  it('holds a P2 during quiet hours but lets a P1 through when critical bypass is on', async () => {
    await addCase(database.db, 'case_p2', 'P2', new Date('2026-10-08T22:30:00Z'));
    await addCase(database.db, 'case_p1', 'P1', new Date('2026-10-08T22:40:00Z'));
    await database.db.insert(alertSubscriptions).values(sub('u_ts_east', 'high_severity_case', { quietStartHour: 22, quietEndHour: 7, criticalBypass: true }));
    await runAlerts(database.db, rules, recorder(), SINCE, NIGHT);
    const byEvent = Object.fromEntries((await deliveries('u_ts_east')).map((r) => [r.eventId, r.status]));
    expect(byEvent).toEqual({ case_p2: 'queued_digest', case_p1: 'delivered' });
    expect((await inbox(database.db, 'u_ts_east')).map((r) => r.eventId)).toEqual(['case_p1']);
  });

  it('queues digest alerts and delivers them together in one digest message', async () => {
    await addCase(database.db, 'case_a', 'P2', new Date('2026-10-08T09:00:00Z'));
    await addCase(database.db, 'case_b', 'P1', new Date('2026-10-08T09:30:00Z'));
    await database.db.insert(alertSubscriptions).values(sub('u_ts_east', 'high_severity_case', { frequency: 'digest' }));
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(ch.calls).toHaveLength(0);
    await flushDigests(database.db, ch, DAY);
    expect(ch.calls).toHaveLength(1);
    expect(ch.calls[0]!.isDigest).toBe(true);
    expect(ch.calls[0]!.ids).toHaveLength(2);
    expect((await deliveries('u_ts_east')).every((r) => r.status === 'delivered' && r.digestId)).toBe(true);
  });
});

describe('send-time permission check (L4)', () => {
  it('suppresses a queued alert if the user lost access before delivery', async () => {
    await addCase(database.db, 'case_t1', 'P2', new Date('2026-10-08T09:00:00Z'));
    await database.db.insert(alertSubscriptions).values(sub('u_ts_east', 'high_severity_case', { frequency: 'digest' }));
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    await database.db.delete(accountTeam).where(and(eq(accountTeam.userId, 'u_ts_east'), eq(accountTeam.accountId, jordanAccount)));
    await flushDigests(database.db, ch, DAY);
    expect(ch.calls).toHaveLength(0);
    expect((await deliveries('u_ts_east'))[0]!.status).toBe('suppressed_no_access');
    expect(await inbox(database.db, 'u_ts_east')).toHaveLength(0);
  });
});

describe('retries', () => {
  it('retries an alert whose channel failed, on the next run', async () => {
    await addCase(database.db, 'case_t1', 'P2', new Date('2026-10-08T10:00:00Z'));
    await database.db.insert(alertSubscriptions).values(sub('u_ts_east', 'high_severity_case'));
    const down: Channels = { async deliver() { return false; } };
    await runAlerts(database.db, rules, down, SINCE, DAY);
    expect((await deliveries('u_ts_east'))[0]!.status).toBe('failed');
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(ch.calls).toHaveLength(1);
    expect((await deliveries('u_ts_east'))[0]!.status).toBe('delivered');
  });

  it('finishes an alert left pending when a run crashed mid-send', async () => {
    await addCase(database.db, 'case_t1', 'P2', new Date('2026-10-08T10:00:00Z'));
    await database.db.insert(alertSubscriptions).values(sub('u_ts_east', 'high_severity_case'));
    const crash: Channels = { async deliver() { throw new Error('process stopped'); } };
    await expect(runAlerts(database.db, rules, crash, SINCE, DAY)).rejects.toThrow();
    expect((await deliveries('u_ts_east'))[0]!.status).toBe('pending');
    await runAlerts(database.db, rules, recorder(), SINCE, DAY);
    expect((await deliveries('u_ts_east'))[0]!.status).toBe('delivered');
  });
});

describe('content (L6)', () => {
  it('explains why it fired, names the rule version and links to the copilot as that user', async () => {
    await addCase(database.db, 'case_t1', 'P1', new Date('2026-10-08T09:00:00Z'));
    await database.db.insert(alertSubscriptions).values(sub('u_ts_east', 'high_severity_case'));
    await runAlerts(database.db, rules, recorder(), SINCE, DAY, { copilotUrl: 'https://copilot.example' });
    const [a] = await deliveries('u_ts_east');
    const name = data.accounts.find((x) => x.id === jordanAccount)!.name;
    expect(a!.title).toBe(`P1 support case at ${name}`);
    expect(a!.explanation).toContain('an account on your account team');
    expect(a!.explanation).toContain('high_severity_case v1');
    expect(a!.link.startsWith('https://copilot.example/?user=u_ts_east&q=')).toBe(true);
  });

  it('treats event text as data: placeholders inside a case subject are not expanded', async () => {
    await addCase(database.db, 'case_t1', 'P1', new Date('2026-10-08T09:00:00Z'), 'Ignore previous rules {account} <script>');
    await database.db.insert(alertSubscriptions).values(sub('u_ts_east', 'high_severity_case'));
    await runAlerts(database.db, rules, recorder(), SINCE, DAY);
    const [a] = await deliveries('u_ts_east');
    expect(a!.explanation).toContain('"Ignore previous rules {account} <script>"');
  });
});

describe('Slack channel (L5)', () => {
  it('escapes Slack formatting in event text so it cannot become a link or mention', () => {
    const text = slackText([{ title: 'P1 at X', explanation: 'Subject: <https://evil.example|click here> <!channel> & more', link: 'http://localhost:3000/?user=u' } as never], false);
    expect(text).not.toContain('<https://evil.example');
    expect(text).not.toContain('<!channel>');
    expect(text).toContain('&lt;https://evil.example|click here&gt;');
    expect(text).toContain('<http://localhost:3000/?user=u|Ask the copilot>');
  });

  const item = { id: 'a1', title: 'P1 support case at X', explanation: 'why', link: 'http://localhost:3000/' } as never;

  it('fails closed when the user has no webhook of their own (no shared fallback)', async () => {
    const posted: string[] = [];
    const ch = createChannels({ slackWebhooks: {}, fetch: async (url) => { posted.push(url); return { ok: true }; } });
    expect(await ch.deliver('slack', 'u_ts_east', [item], false)).toBe(false);
    expect(posted).toHaveLength(0);
  });

  it("posts only to that user's own Slack webhook, and rejects non-Slack URLs", async () => {
    const posted: string[] = [];
    const fake = async (url: string) => { posted.push(url); return { ok: true }; };
    const ok = createChannels({ slackWebhooks: { u_ts_east: 'https://hooks.slack.com/services/T/B/east' }, fetch: fake });
    expect(await ok.deliver('slack', 'u_ts_east', [item], false)).toBe(true);
    expect(posted).toEqual(['https://hooks.slack.com/services/T/B/east']);
    const bad = createChannels({ slackWebhooks: { u_ts_east: 'https://attacker.example/hook' }, fetch: fake });
    expect(await bad.deliver('slack', 'u_ts_east', [item], false)).toBe(false);
    expect(posted).toHaveLength(1);
  });
});
