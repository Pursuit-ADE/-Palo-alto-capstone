'use server';

import { revalidatePath } from 'next/cache';
import { PreferenceError, savePreference } from '@/alerts/preferences';
import { requireUser } from '@/server/require-user';
import { getAlertsRuntime } from '@/server/runtime';

export type SaveResult = { ok: boolean; message: string } | null;

/** Saves one subscription for the signed-in person. The form's user field is used only for local testing. */
export async function saveSubscription(_prev: SaveResult, formData: FormData): Promise<SaveResult> {
  const userId = (await requireUser(formData.get('user')))?.userId;
  if (!userId) return { ok: false, message: 'Please log in to change your alerts.' };
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
