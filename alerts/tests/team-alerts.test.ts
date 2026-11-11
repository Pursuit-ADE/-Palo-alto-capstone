// Team alerts (Nov 3-4): after a person's own alert is delivered, a heads-up goes to their team's Slack channel,
// for team-wide events only, once per event per team, and without the person's name or their private alert text.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { alertDeliveries, alertSubscriptions, appUsers, engagements, supportCases } from '@/db/schema';
import { buildSeed } from '@/db/seed';
import { createChannels, SLACK_TEAM_WEBHOOK_WARNING, teamSlackText, type Channels } from '@/alerts/channels';
import { flushDigests, runAlerts } from '@/alerts/engine';
import { loadRules } from '@/alerts/rules';

const rules = loadRules();
const data = buildSeed();
const SINCE = new Date('2026-09-01T00:00:00Z');
const DAY = new Date('2026-10-08T15:00:00Z');
const jordanAccount = data.accountTeam.find((t) => t.userId === 'u_ts_east')!.accountId;
const jordanTeam = data.users.find((u) => u.id === 'u_ts_east')!.managerId!;

const sub = (userId: string, ruleId = 'high_severity_case') => ({ userId, ruleId, frequency: 'realtime', channel: 'inbox', quietStartHour: null, quietEndHour: null, criticalBypass: false });

type TeamCall = { teamId: string; ids: string[] };
function channels(deliverOk: boolean, teamOk: boolean | undefined): Channels & { team: NonNullable<Channels['team']>; teamCalls: TeamCall[] } {
  const teamCalls: TeamCall[] = [];
  return {
    teamCalls,
    async deliver() { return deliverOk; },
    async team(teamId, items) { teamCalls.push({ teamId, ids: items.map((i) => i.id) }); return teamOk; },
  };
}

let database: Database;
beforeEach(async () => {
  database = await openDatabase();
  await database.db.delete(supportCases);
  await database.db.delete(engagements);
  await database.db.delete(alertSubscriptions);
  await database.db.insert(supportCases).values({ id: 'case_team', snapshotId: data.snapshot.id, accountId: jordanAccount, severity: 'P1', status: 'Open', subject: 'Executive dashboard down', openedAt: new Date('2026-10-08T10:00:00Z') });
  await database.db.insert(alertSubscriptions).values(sub('u_ts_east'));
});
afterEach(async () => {
  await database.close();
});

describe('team alerts', () => {
  it("gives the person's team a heads-up for a team-wide event", async () => {
    const ch = channels(true, true);
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    const [row] = await database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, 'u_ts_east'));
    expect(row?.status).toBe('delivered');
    expect(ch.teamCalls).toEqual([{ teamId: jordanTeam, ids: [row!.id] }]);
  });

  it("keeps a seller's own leads personal: no team heads-up for a CxO engagement", async () => {
    await database.db.delete(supportCases);
    const darcel = data.users.find((u) => u.id === 'u_darcel_schlecht')!;
    const account = data.accountTeam.find((t) => t.userId === darcel.id && data.contacts.some((c) => c.accountId === t.accountId && c.isCxo))!.accountId;
    await database.db.insert(engagements).values({ id: 'eng_team', snapshotId: data.snapshot.id, accountId: account, contactId: data.contacts.find((c) => c.accountId === account && c.isCxo)!.id, type: 'whitepaper_download', asset: 'Zero Trust whitepaper', occurredAt: new Date('2026-10-08T10:00:00Z') });
    await database.db.insert(alertSubscriptions).values(sub(darcel.id, 'cxo_engagement'));
    const ch = channels(true, true);
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect((await database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, darcel.id)))[0]?.status).toBe('delivered');
    expect(ch.teamCalls).toHaveLength(0);
  });

  it('posts nothing to the team when the person did not get the alert', async () => {
    const ch = channels(false, true);
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(ch.teamCalls).toHaveLength(0);
  });

  it("never changes the person's own delivery when the team post fails or the team has no channel", async () => {
    for (const teamOk of [false, undefined]) {
      await database.db.delete(alertDeliveries);
      await runAlerts(database.db, rules, channels(true, teamOk), SINCE, DAY);
      const [row] = await database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, 'u_ts_east'));
      expect(row?.status).toBe('delivered');
    }
  });

  it("posts only to that team's own Slack link, without anyone's name or private alert text", async () => {
    const posted: { url: string; body: string }[] = [];
    const fake = async (url: string, init: { body: string }) => { posted.push({ url, body: init.body }); return { ok: true }; };
    const item = { id: 'a1', title: 'P1 support case at X', explanation: 'Fired because X, an account on your account team', link: 'http://localhost:3000/' } as never;
    const ch = createChannels({ slackWebhooks: {}, teamWebhooks: { [jordanTeam]: 'https://hooks.slack.com/services/T/B/team' }, fetch: fake });
    expect(await ch.team!(jordanTeam, [item])).toBe(true);
    expect(await ch.team!('u_mgr_other', [item])).toBeUndefined();
    expect(posted.map((p) => p.url)).toEqual(['https://hooks.slack.com/services/T/B/team']);
    const text = JSON.parse(posted[0]!.body).text as string;
    expect(text).toContain('P1 support case at X');
    expect(text).not.toContain('your account team');
    expect(text).not.toContain('Jordan');
  });

  it('refuses non-Slack team links, with a warning, and then offers no team channel at all', async () => {
    const warnings: string[] = [];
    const ch = createChannels({ teamWebhooks: { [jordanTeam]: 'https://attacker.example/hook' }, fetch: async () => ({ ok: true }), warn: (m) => warnings.push(m) });
    expect(ch.team).toBeUndefined();
    expect(createChannels({ slackWebhooks: {} }).team).toBeUndefined();
    expect(warnings).toContain(SLACK_TEAM_WEBHOOK_WARNING);
  });

  it('escapes event text in the team note', () => {
    const text = teamSlackText([{ title: 'Case at <http://evil.example|x> <!channel> *bold*' } as never]);
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<http');
    expect(text).not.toContain('*bold*');
  });
});

// Review of #125: the main claim, and the cases where one teammate used to decide whether the team heard.
describe('team alerts: once per event, best effort', () => {
  describe('two teammates on the same event', () => {
    const mate = data.accountTeam.find((t) => t.accountId === jordanAccount && t.userId !== 'u_ts_east' && data.users.find((u) => u.id === t.userId)?.managerId === jordanTeam)!.userId;
    const [first, second] = ['u_ts_east', mate].sort() as [string, string];
    const reset = async (...subs: ReturnType<typeof sub>[]) => {
      // The rule's audience is technical sellers, and the seed has one per team: make the teammate a second one.
      await database.db.update(appUsers).set({ role: 'technical_seller' }).where(eq(appUsers.id, mate));
      await database.db.delete(alertSubscriptions);
      await database.db.insert(alertSubscriptions).values(subs);
    };

    it('posts one team note, not two', async () => {
      await reset(sub(first), sub(second));
      const ch = channels(true, true);
      await runAlerts(database.db, rules, ch, SINCE, DAY);
      const rows = await database.db.select().from(alertDeliveries);
      expect(rows.filter((r) => r.status === 'delivered')).toHaveLength(2);
      expect(ch.teamCalls).toHaveLength(1);
      expect(ch.teamCalls[0]!.ids).toHaveLength(1);
    });

    it('tells the team right away when the lowest-id teammate is on a digest, and not again when the digest goes out', async () => {
      await reset({ ...sub(first), frequency: 'daily' }, sub(second));
      const ch = channels(true, true);
      await runAlerts(database.db, rules, ch, SINCE, DAY);
      const [realtime] = await database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, second));
      expect(ch.teamCalls).toEqual([{ teamId: jordanTeam, ids: [realtime!.id] }]);
      await flushDigests(database.db, rules, ch, new Date('2026-10-10T15:00:00Z'));
      const [digest] = await database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, first));
      expect(digest?.status).toBe('delivered');
      expect(ch.teamCalls).toHaveLength(1);
    });

    it("still tells the team when the lowest-id teammate's alert is not delivered", async () => {
      await reset(sub(first), sub(second));
      const ch = channels(true, true);
      const failFirst: Channels = { ...ch, deliver: async (_c, userId) => userId !== first };
      await runAlerts(database.db, rules, failFirst, SINCE, DAY);
      expect(ch.teamCalls).toHaveLength(1);
    });
  });

  it('a team channel that throws or hangs never fails the run or the personal delivery', async () => {
    const ch: Channels = { deliver: async () => true, team: async () => { throw new Error('slack down'); } };
    await expect(runAlerts(database.db, rules, ch, SINCE, DAY)).resolves.not.toThrow();
    const [row] = await database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, 'u_ts_east'));
    expect(row?.status).toBe('delivered');
  });

  it('says only that an alert fired, not that everyone was alerted', () => {
    const text = teamSlackText([{ title: 'P1 support case at X' } as never]);
    expect(text).toContain('an alert fired');
    expect(text).not.toContain('have been alerted');
  });
});
