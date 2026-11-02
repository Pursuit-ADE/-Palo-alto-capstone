// How the alerts app writes times. Rules, digests and quiet hours run on UTC, so UTC stays first; Eastern time sits
// beside it because the team and the client read Eastern (UX review Nov 2, OPT 5). Eastern follows daylight saving.
const EASTERN = 'America/New_York';
const easternStamp = new Intl.DateTimeFormat('en-US', { timeZone: EASTERN, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const easternHourOnly = new Intl.DateTimeFormat('en-US', { timeZone: EASTERN, hour: 'numeric' });

/** "2026-09-22 07:00 UTC (Sep 22, 3:00 AM ET)". The date is repeated because an evening in Eastern is the next day in UTC. */
export function utcWithEastern(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC (${easternStamp.format(d)} ET)`;
}

/** The Eastern clock hour of a UTC hour on the given day, e.g. 22 gives "6 PM" in summer and "5 PM" in winter. */
export function easternHour(utcHour: number, on: Date): string {
  const d = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate(), utcHour));
  return easternHourOnly.format(d);
}

/** A snapshot date the way the copilot writes it ("Oct 8, 2026"), so both apps show the same data date. */
export function snapshotDay(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
