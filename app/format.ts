export function format(value: unknown, unit: string): string {
  if (typeof value !== 'number') return String(value ?? '');
  if (unit === 'currency') return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  if (unit === 'ratio') return `${value.toFixed(2)}x`;
  return value.toLocaleString('en-US');
}

export function cell(k: string, v: unknown, unit: string): string {
  if (k === 'value') return format(v, unit);
  if (k === 'numerator' || k === 'denominator') return format(v, 'currency');
  if (k === 'region') return String(v).replace(/^./, (c) => c.toUpperCase());
  return String(v);
}

const day = (iso: string, withYear: boolean) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });

/** "Oct 14, 2026", or "Aug 1 to Oct 31, 2026" for a range. Dates are calendar dates, so they're read as UTC. */
export function dateRange(start: string, end?: string): string {
  if (!end) return day(start, true);
  return `${day(start, start.slice(0, 4) !== end.slice(0, 4))} to ${day(end, true)}`;
}

/** A load time in UTC, so every viewer sees the same value. */
export function timestamp(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })} UTC`;
}
