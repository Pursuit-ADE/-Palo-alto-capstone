// The alert summary tiles, as one list: the Numbers view's tiles and the Graphs view's chart both read it, so they
// can never disagree. Only counts: held, blocked or failed alerts are never shown, as before.
export interface AlertKpi {
  key: 'delivered' | 'waiting' | 'not_sent';
  label: string;
  value: number;
  note: string;
  detail?: string;
}

export function alertKpis(counts: Record<string, number>): AlertKpi[] {
  const count = (s: string) => counts[s] ?? 0;
  const removed = count('suppressed_no_access') + count('suppressed_inactive');
  const failed = count('failed');
  return [
    { key: 'delivered', label: 'Delivered', value: count('delivered'), note: 'sent to your inbox' },
    { key: 'waiting', label: 'Waiting for digest', value: count('queued_digest'), note: 'held by your digest or quiet-hours setting; shown once delivered' },
    { key: 'not_sent', label: 'Not sent', value: removed + failed, note: 'access removed or channel unavailable', detail: `${removed} access removed · ${failed} channel unavailable` },
  ];
}
