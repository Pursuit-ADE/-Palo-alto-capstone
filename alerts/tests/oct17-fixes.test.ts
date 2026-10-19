// Oct 17 audit fixes in the alerts app: Slack formatting from CRM text (F8), and unsubscribing from a rule the
// person's role no longer covers.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { alertSubscriptions } from '@/db/schema';
import { slackEscape, slackText } from '@/alerts/channels';
import { savePreference } from '@/alerts/preferences';
import { loadRules } from '@/alerts/rules';

let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

describe('Slack formatting from CRM text (F8)', () => {
  it('turns * _ ~ ` into look-alikes, so a case subject cannot change the formatting', () => {
    const subject = 'URGENT* reset your password at _now_ ~ignore~ `code`';
    const escaped = slackEscape(subject);
    expect(escaped).not.toMatch(/[*_~`]/);
    expect(escaped).toContain('URGENT∗');
    const text = slackText([{ title: `High-severity case: ${subject}`, explanation: subject, link: 'https://copilot.local/?q=x' } as never], false);
    // Only our own bold markers remain: one pair around the title.
    expect(text.match(/\*/g)).toHaveLength(2);
  });
});

describe('unsubscribing', () => {
  it('works even for a rule the role no longer covers', async () => {
    // A sales rep left with a technical-seller rule (for example after a role change).
    await database.db.insert(alertSubscriptions).values({ userId: 'u_darcel_schlecht', ruleId: 'high_severity_case', frequency: 'weekly', channel: 'inbox', criticalBypass: true });
    await savePreference(database.db, loadRules(), 'u_darcel_schlecht', {
      ruleId: 'high_severity_case', subscribed: false, frequency: 'weekly', quietStartHour: '', quietEndHour: '', criticalBypass: true, channel: 'inbox',
    });
    const left = await database.db.select().from(alertSubscriptions).where(and(eq(alertSubscriptions.userId, 'u_darcel_schlecht'), eq(alertSubscriptions.ruleId, 'high_severity_case')));
    expect(left).toHaveLength(0);
  });
});
