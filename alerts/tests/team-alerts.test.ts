// Team alerts (local, Nov 3): after a person's own alert is delivered, a short note goes to their team's Slack channel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { alertDeliveries, alertSubscriptions, appUsers, supportCases } from '@/db/schema';
import { buildSeed } from '@/db/seed';
import { createChannels, SLACK_TEAM_WEBHOOK_WARNING, teamSlackText, type Channels } from '@/alerts/channels';
import { runAlerts } from '@/alerts/engine';
import { loadRules } from '@/alerts/rules';

const rules = loadRules();
const data = buildSeed();
const SINCE = new Date('2026-09-01T00:00:00Z');
const DAY = new Date('2026-10-08T15:00:00Z');
const jordanAccount = data.accountTeam.find((t) => t.userId === 'u_ts_east')!.accountId;
const jordanTeam = data.users.find((u) => u.id === 'u_ts_east')!.managerId!;

const sub = (userId: string) => ({ userId, ruleId: 'high_severity_case', frequency: 'realtime', channel: 'inbox', quietStartHour: null, quietEndHour: null, criticalBypass: false });

type TeamCall = { teamId: string; memberName: string; ids: string[] };
function channels(deliverOk: boolean, teamOk: boolean | undefined): Channels & { team: NonNullable<Channels['team']>; teamCalls: TeamCall[] } {
  const teamCalls: TeamCall[] = [];
  return {
    teamCalls,
    async deliver() { return deliverOk; },
    async team(teamId, memberName, items) { teamCalls.push({ teamId, memberName, ids: items.map((i) => i.id) }); return teamOk; },
  };
}

let database: Database;
beforeEach(async () => {
  database = await openDatabase();
  await database.db.delete(supportCases);
  await database.db.insert(supportCases).values({ id: 'case_team', snapshotId: data.snapshot.id, accountId: jordanAccount, severity: 'P1', status: 'Open', subject: 'Executive dashboard down', openedAt: new Date('2026-10-08T10:00:00Z') });
  await database.db.insert(alertSubscriptions).values(sub('u_ts_east'));
});
afterEach(async () => {
  await database.close();
});

describe('team alerts', () => {
  it("notes a delivered alert in the person's team channel, naming who got it", async () => {
    const ch = channels(true, true);
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    const [row] = await database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, 'u_ts_east'));
    expect(row?.status).toBe('delivered');
    const [jordan] = await database.db.select().from(appUsers).where(eq(appUsers.id, 'u_ts_east'));
    expect(ch.teamCalls).toEqual([{ teamId: jordanTeam, memberName: jordan!.displayName, ids: [row!.id] }]);
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

  it("posts only to that team's own Slack link, and nothing for a team without one", async () => {
    const posted: { url: string; body: string }[] = [];
    const fake = async (url: string, init: { body: string }) => { posted.push({ url, body: init.body }); return { ok: true }; };
    const item = { id: 'a1', title: 'P1 support case at X', explanation: 'why', link: 'http://localhost:3000/' } as never;
    const ch = createChannels({ slackWebhooks: {}, teamWebhooks: { [jordanTeam]: 'https://hooks.slack.com/services/T/B/team' }, fetch: fake });
    expect(await ch.team!(jordanTeam, 'Jordan Lee', [item])).toBe(true);
    expect(await ch.team!('u_mgr_other', 'Sam Rivera', [item])).toBeUndefined();
    expect(posted.map((p) => p.url)).toEqual(['https://hooks.slack.com/services/T/B/team']);
    expect(JSON.parse(posted[0]!.body).text).toContain('Team alert: sent to Jordan Lee');
  });

  it('refuses non-Slack team links, with a warning', async () => {
    const warnings: string[] = [];
    const ch = createChannels({ teamWebhooks: { [jordanTeam]: 'https://attacker.example/hook' }, fetch: async () => ({ ok: true }), warn: (m) => warnings.push(m) });
    expect(await ch.team!(jordanTeam, 'Jordan Lee', [])).toBeUndefined();
    expect(warnings).toContain(SLACK_TEAM_WEBHOOK_WARNING);
  });

  it('escapes event text in the team note', () => {
    const text = teamSlackText('Jordan <!channel>', [{ title: 'Case at <http://evil.example|x>', explanation: '*bold*' } as never]);
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<http');
    expect(text).not.toContain('*bold*');
  });
});
