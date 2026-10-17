'use server';

import { revalidatePath } from 'next/cache';
import { demoUsers } from '@/db/seed';
import { PreferenceError, savePreference } from '@/alerts/preferences';
import { testIdentitiesEnabled } from '@/server/identity';
import { getAlertsRuntime } from '@/server/runtime';

export type SaveResult = { ok: boolean; message: string } | null;

const DEMO_IDS = new Set(demoUsers().map((u) => u.id));

/** Saves one subscription for the signed-in (test) user. With real sign-in, the user id comes from the session. */
export async function saveSubscription(_prev: SaveResult, formData: FormData): Promise<SaveResult> {
  const userId = formData.get('user');
  if (!testIdentitiesEnabled() || typeof userId !== 'string' || !DEMO_IDS.has(userId)) {
    return { ok: false, message: 'Sign-in is not set up yet.' };
  }
  const { database, rules } = await getAlertsRuntime();
  try {
    await savePreference(database.db, rules, userId, {
      ruleId: String(formData.get('ruleId') ?? ''),
      subscribed: formData.get('subscribed') === 'on',
      frequency: String(formData.get('frequency') ?? ''),
      quietStartHour: String(formData.get('quietStartHour') ?? ''),
      quietEndHour: String(formData.get('quietEndHour') ?? ''),
      criticalBypass: formData.get('criticalBypass') === 'on',
      channel: String(formData.get('channel') ?? ''),
    });
  } catch (e) {
    if (e instanceof PreferenceError) return { ok: false, message: e.message };
    return { ok: false, message: 'Could not save. Please try again.' };
  }
  revalidatePath('/');
  return { ok: true, message: 'Saved.' };
}
