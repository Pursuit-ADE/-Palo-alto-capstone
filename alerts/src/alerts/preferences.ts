// L3: each user edits their own subscriptions. Only rules meant for the user's current role can be
// subscribed to, and every field is validated. Alerts already queued keep the channel they were created with.
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { alertSubscriptions, appUsers } from '../db/schema';
import { destinationsFor } from './channels';
import type { AlertRule } from './rules';
import { FREQUENCIES } from './schedule';

type Destinations = (userId: string) => { slack: boolean; email: boolean };

/**
 * Refuses a channel the person has no destination for, so the choice fails on the page, where they can see it, instead
 * of retrying five times with nothing sent and ending as "undelivered" (#104 review). The inbox always works.
 */
function checkChannel(channel: string, has: { slack: boolean; email: boolean }) {
  const needsSlack = channel === 'slack' || channel === 'slack_email';
  const needsEmail = channel === 'email' || channel === 'slack_email';
  if (needsSlack && !has.slack) throw new PreferenceError('Slack isn’t set up for you yet, so choose another channel. An admin adds your own Slack link.');
  if (needsEmail && !has.email) throw new PreferenceError('Email isn’t set up for you yet, so choose another channel. An admin adds your address and the mail service.');
}

const Hour = z.union([z.literal(''), z.coerce.number().int().min(0).max(23)]);

export const PreferenceInput = z
  .object({
    ruleId: z.string().max(64),
    subscribed: z.boolean(),
    frequency: z.enum(FREQUENCIES),
    quietStartHour: Hour,
    quietEndHour: Hour,
    criticalBypass: z.boolean(),
    channel: z.enum(['inbox', 'slack', 'email', 'slack_email']),
  })
  .strict();
export type PreferenceInput = z.infer<typeof PreferenceInput>;

export class PreferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreferenceError';
  }
}

export async function savePreference(db: Db, rules: Map<string, AlertRule>, userId: string, raw: unknown, destinations: Destinations = (id) => destinationsFor(id)) {
  const parsed = PreferenceInput.safeParse(raw);
  if (!parsed.success) throw new PreferenceError('Those settings are not valid.');
  const p = parsed.data;
  const where = and(eq(alertSubscriptions.userId, userId), eq(alertSubscriptions.ruleId, p.ruleId));
  // Unsubscribing only removes the person's own row, so it's always allowed, even from a rule their role no
  // longer covers (otherwise a stale subscription could never be removed).
  if (!p.subscribed) {
    await db.delete(alertSubscriptions).where(where);
    return;
  }
  const rule = rules.get(p.ruleId);
  const [user] = await db.select({ role: appUsers.role }).from(appUsers).where(eq(appUsers.id, userId));
  if (!rule || !user || !(rule.audience as string[]).includes(user.role)) throw new PreferenceError('That alert is not available for your role.');
  // Quiet hours need both ends. Half a window is refused rather than silently stored as no quiet hours.
  if ((p.quietStartHour === '') !== (p.quietEndHour === '')) throw new PreferenceError('Choose both a start and an end for quiet hours, or neither.');
  const quiet = p.quietStartHour === '' || p.quietEndHour === '' ? { quietStartHour: null, quietEndHour: null } : { quietStartHour: p.quietStartHour, quietEndHour: p.quietEndHour };
  checkChannel(p.channel, destinations(userId));
  const values = { frequency: p.frequency, channel: p.channel, criticalBypass: p.criticalBypass, ...quiet };
  await db
    .insert(alertSubscriptions)
    .values({ userId, ruleId: p.ruleId, ...values })
    .onConflictDoUpdate({ target: [alertSubscriptions.userId, alertSubscriptions.ruleId], set: values });
}
