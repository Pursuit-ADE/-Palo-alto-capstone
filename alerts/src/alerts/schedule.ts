// Digest schedule (PRD L3): realtime, daily, weekly or monthly. Digests go out at DIGEST_HOUR_UTC: every day,
// on Mondays, or on the 1st of the month. A subscription is due when it has not had a digest since the most
// recent slot. Times are UTC until per-user time zones exist.
export const FREQUENCIES = ['realtime', 'daily', 'weekly', 'monthly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const DIGEST_HOUR_UTC = 13;

/** Older rows used "digest" for the daily digest. */
export function normalizeFrequency(f: string): Frequency {
  if (f === 'digest') return 'daily';
  return (FREQUENCIES as readonly string[]).includes(f) ? (f as Frequency) : 'daily';
}

/** The most recent digest slot at or before `now`. */
export function lastSlot(frequency: Exclude<Frequency, 'realtime'>, now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DIGEST_HOUR_UTC));
  if (d > now) d.setUTCDate(d.getUTCDate() - 1);
  if (frequency === 'weekly') {
    const back = (d.getUTCDay() + 6) % 7; // days since Monday
    d.setUTCDate(d.getUTCDate() - back);
  }
  if (frequency === 'monthly') {
    d.setUTCDate(1);
    if (d > now) d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return d;
}

/** Whether queued alerts for this subscription may go out now. Realtime alerts only wait for quiet hours. */
export function digestDue(sub: { frequency: string; lastDigestAt: Date | null }, now: Date): boolean {
  const f = normalizeFrequency(sub.frequency);
  if (f === 'realtime') return true;
  return !sub.lastDigestAt || sub.lastDigestAt < lastSlot(f, now);
}
