export function format(value: unknown, unit: string): string {
  if (value === null || value === undefined) return unit === 'ratio' ? 'n/a' : '—';
  if (typeof value !== 'number') return String(value);
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
