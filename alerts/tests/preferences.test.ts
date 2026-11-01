import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { alertSubscriptions } from '@/db/schema';
import { PreferenceError, savePreference } from '@/alerts/preferences';
import { loadRules } from '@/alerts/rules';
import { destinationsFor } from '@/alerts/channels';

const rules = loadRules();
let database: Database;
beforeEach(async () => {
  database = await openDatabase();
});
afterEach(async () => {
  await database.close();
});

const base = { ruleId: 'high_severity_case', subscribed: true, frequency: 'weekly', quietStartHour: 22, quietEndHour: 7, criticalBypass: true, channel: 'inbox' };
const subOf = async (userId: string, ruleId: string) =>
  (await database.db.select().from(alertSubscriptions).where(and(eq(alertSubscriptions.userId, userId), eq(alertSubscriptions.ruleId, ruleId))))[0];

describe('preferences (L3)', () => {
  it('lets a user subscribe, change settings and unsubscribe', async () => {
    await savePreference(database.db, rules, 'u_ts_east', base);
    expect(await subOf('u_ts_east', 'high_severity_case')).toMatchObject({ frequency: 'weekly', quietStartHour: 22, quietEndHour: 7, criticalBypass: true });
    await savePreference(database.db, rules, 'u_ts_east', { ...base, frequency: 'monthly', quietStartHour: '', quietEndHour: '' });
    expect(await subOf('u_ts_east', 'high_severity_case')).toMatchObject({ frequency: 'monthly', quietStartHour: null, quietEndHour: null });
    await savePreference(database.db, rules, 'u_ts_east', { ...base, subscribed: false });
    expect(await subOf('u_ts_east', 'high_severity_case')).toBeUndefined();
  });

  it('refuses a rule that is not meant for the user role', async () => {
    await expect(savePreference(database.db, rules, 'u_darcel_schlecht', base)).rejects.toBeInstanceOf(PreferenceError);
    await expect(savePreference(database.db, rules, 'u_ts_east', { ...base, ruleId: 'cxo_engagement' })).rejects.toBeInstanceOf(PreferenceError);
  });

  it('lets a user pick email as the channel', async () => {
    await savePreference(database.db, rules, 'u_ts_east', { ...base, channel: 'email' }, () => ({ slack: false, email: true }));
    expect(await subOf('u_ts_east', 'high_severity_case')).toMatchObject({ channel: 'email' });
  });

  it('refuses Slack, email or both when that person has no destination for it, and always allows the inbox (#104 review)', async () => {
    const none = () => ({ slack: false, email: false });
    const slackOnly = () => ({ slack: true, email: false });
    for (const channel of ['slack', 'email', 'slack_email']) {
      await expect(savePreference(database.db, rules, 'u_ts_east', { ...base, channel }, none)).rejects.toBeInstanceOf(PreferenceError);
    }
    await expect(savePreference(database.db, rules, 'u_ts_east', { ...base, channel: 'slack_email' }, slackOnly)).rejects.toThrow('Email isn’t set up');
    expect(await subOf('u_ts_east', 'high_severity_case')).toBeUndefined();
    await savePreference(database.db, rules, 'u_ts_east', { ...base, channel: 'slack' }, slackOnly);
    await savePreference(database.db, rules, 'u_ts_east', { ...base, channel: 'inbox' }, none);
    expect(await subOf('u_ts_east', 'high_severity_case')).toMatchObject({ channel: 'inbox' });
  });

  it('reads destinations from the same settings as delivery', () => {
    const env = {
      SLACK_USER_WEBHOOKS: '{"u_ts_east":"https://hooks.slack.com/services/T0/B0/x","u_ts_west":"https://attacker.example/hook"}',
      EMAIL_USER_ADDRESSES: '{"u_ts_east":"jordan@example.test"}',
      EMAIL_WEBHOOK_URL: 'https://mail.example/send',
      EMAIL_WEBHOOK_HOSTS: 'mail.example',
    };
    expect(destinationsFor('u_ts_east', env)).toEqual({ slack: true, email: true });
    // A link that isn't hooks.slack.com doesn't count, and an address without an allowed mail service can't be reached.
    expect(destinationsFor('u_ts_west', env)).toEqual({ slack: false, email: false });
    expect(destinationsFor('u_ts_east', { ...env, EMAIL_WEBHOOK_HOSTS: '' })).toEqual({ slack: true, email: false });
  });

  it('refuses invalid values and unknown fields', async () => {
    for (const bad of [
      { ...base, frequency: 'hourly' },
      { ...base, quietStartHour: 24 },
      { ...base, channel: 'sms' },
      { ...base, ruleId: 'x'.repeat(100) },
      { ...base, userId: 'u_analyst' },
      { ...base, quietStartHour: 22, quietEndHour: '' }, // half a quiet window
      { ...base, quietStartHour: '', quietEndHour: 7 },
    ]) {
      await expect(savePreference(database.db, rules, 'u_ts_east', bad)).rejects.toBeInstanceOf(PreferenceError);
    }
  });
});
