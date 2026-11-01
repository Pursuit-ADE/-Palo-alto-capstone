// A queued case alert follows its case (project review, Nov 1, finding 3). The alert was written once, when the case was
// first seen, and never read the case again: a P2 that escalated to P1 stayed P2 in its digest, so a subscriber whose P1
// bypass was on waited for the digest, and a case closed before the digest was described as open. The late-arrival
// window only looks back so far, so the digest flush reads the case again too.
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Channels } from '@/alerts/channels';
import { flushDigests, runAlerts } from '@/alerts/engine';
import { loadRules } from '@/alerts/rules';
import { openDatabase, type Database } from '@/db/client';
import { alertDeliveries, alertSubscriptions, supportCases } from '@/db/schema';
import { buildSeed } from '@/db/seed';

const rules = loadRules();
const data = buildSeed();
const SINCE = new Date('2026-09-01T00:00:00Z');
const DAY = new Date('2026-10-08T15:00:00Z');
const RULE = 'high_severity_case';
const jordanAccount = data.accountTeam.find((t) => t.userId === 'u_ts_east')!.accountId;

type Message = { ids: string[]; titles: string[]; texts: string[]; isDigest: boolean };
function recorder(): Channels & { messages: Message[] } {
  const messages: Message[] = [];
  return {
    messages,
    async deliver(_channel, _userId, items, isDigest) {
      messages.push({ ids: items.map((i) => i.id), titles: items.map((i) => i.title), texts: items.map((i) => i.explanation), isDigest });
      return true;
    },
  };
}

let database: Database;
beforeEach(async () => {
  database = await openDatabase();
  await database.db.delete(supportCases);
});
afterEach(async () => {
  await database.close();
});

const addCase = (id: string, severity: string, at = new Date('2026-10-08T10:00:00Z')) =>
  database.db.insert(supportCases).values({ id, snapshotId: data.snapshot.id, accountId: jordanAccount, severity, status: 'Open', subject: 'Firewall outage at branch', openedAt: at });
const change = (id: string, patch: Partial<typeof supportCases.$inferInsert>) => database.db.update(supportCases).set(patch).where(eq(supportCases.id, id));
const subscribe = (extra: Partial<typeof alertSubscriptions.$inferInsert> = {}) =>
  database.db.insert(alertSubscriptions).values({ userId: 'u_ts_east', ruleId: RULE, frequency: 'daily', channel: 'inbox', quietStartHour: null, quietEndHour: null, criticalBypass: true, ...extra });
const delivery = async () => (await database.db.select().from(alertDeliveries).where(eq(alertDeliveries.userId, 'u_ts_east')))[0]!;

describe('a queued case that escalates to P1', () => {
  it('is promoted at once for a subscriber with the P1 bypass, and says P1', async () => {
    await addCase('case_esc', 'P2');
    await subscribe();
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(await delivery()).toMatchObject({ status: 'queued_digest', severity: 'P2' });
    await change('case_esc', { severity: 'P1' });
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(await delivery()).toMatchObject({ status: 'delivered', severity: 'P1' });
    expect((await delivery()).title).toMatch(/^P1 /);
    expect(ch.messages).toHaveLength(1);
    expect(ch.messages[0]).toMatchObject({ isDigest: false, titles: [expect.stringMatching(/^P1 /)] });
  });

  it('is promoted by the digest flush alone, which is what reaches a case older than the late-arrival window', async () => {
    await addCase('case_old', 'P2');
    // The digest was sent an hour ago, so it is not due: only the bypass can send this now.
    await subscribe({ lastDigestAt: new Date(DAY.getTime() - 3600_000) });
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    await change('case_old', { severity: 'P1' });
    await flushDigests(database.db, rules, ch, DAY);
    expect(await delivery()).toMatchObject({ status: 'delivered', severity: 'P1' });
    expect(ch.messages).toHaveLength(1);
  });

  it('is rewritten as P1 but stays in the digest for a subscriber without the bypass', async () => {
    await addCase('case_nb', 'P2');
    await subscribe({ criticalBypass: false });
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    await change('case_nb', { severity: 'P1' });
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(await delivery()).toMatchObject({ status: 'queued_digest', severity: 'P1' });
    expect((await delivery()).title).toMatch(/^P1 /);
    expect(ch.messages).toHaveLength(0);
  });

  it('is sent once, and a delivered alert is left as it was', async () => {
    await addCase('case_once', 'P2');
    await subscribe();
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    await change('case_once', { severity: 'P1' });
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    const sent = await delivery();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    await flushDigests(database.db, rules, ch, DAY);
    await change('case_once', { severity: 'P2' });
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(ch.messages).toHaveLength(1);
    expect(await delivery()).toEqual(sent);
  });
});

describe('a queued case that closes before the digest', () => {
  it('is still delivered, and its text says the case has since been closed', async () => {
    await addCase('case_closed', 'P2');
    await subscribe({ criticalBypass: false });
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    await change('case_closed', { status: 'Closed' });
    await flushDigests(database.db, rules, ch, DAY);
    expect(ch.messages).toHaveLength(1);
    expect(ch.messages[0]!.texts[0]).toMatch(/The case has since been closed\./);
    expect(await delivery()).toMatchObject({ status: 'delivered' });
  });

  it('is not promoted as urgent, even when it had escalated to P1 first', async () => {
    await addCase('case_closed_p1', 'P2');
    await subscribe({ lastDigestAt: new Date(DAY.getTime() - 3600_000) });
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    await change('case_closed_p1', { severity: 'P1', status: 'Closed' });
    await flushDigests(database.db, rules, ch, DAY);
    expect(ch.messages).toHaveLength(0);
    expect(await delivery()).toMatchObject({ status: 'queued_digest', severity: 'P1' });
  });
});

describe('the refresh respects a send that has already claimed the alert', () => {
  it('leaves an alert being sent exactly as the sender read it', async () => {
    await addCase('case_claimed', 'P2');
    await subscribe();
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    await database.db.update(alertDeliveries).set({ status: 'sending', claimedAt: DAY, claimToken: 'another-sender' }).where(and(eq(alertDeliveries.userId, 'u_ts_east')));
    await change('case_claimed', { severity: 'P1' });
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(await delivery()).toMatchObject({ status: 'sending', severity: 'P2', claimToken: 'another-sender' });
    expect(ch.messages).toHaveLength(0);
  });
});

describe('a brand new P1 case', () => {
  it('is still delivered at once for a subscriber with the P1 bypass', async () => {
    await addCase('case_new', 'P1');
    await subscribe();
    const ch = recorder();
    await runAlerts(database.db, rules, ch, SINCE, DAY);
    expect(await delivery()).toMatchObject({ status: 'delivered', severity: 'P1' });
    expect(ch.messages).toHaveLength(1);
  });
});
