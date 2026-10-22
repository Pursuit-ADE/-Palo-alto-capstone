import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { openDatabase, type Database } from '@/db/client';
import { alertSubscriptions } from '@/db/schema';
import { PreferenceError, savePreference } from '@/alerts/preferences';
import { loadRules } from '@/alerts/rules';

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
    await savePreference(database.db, rules, 'u_ts_east', { ...base, channel: 'email' });
    expect(await subOf('u_ts_east', 'high_severity_case')).toMatchObject({ channel: 'email' });
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
