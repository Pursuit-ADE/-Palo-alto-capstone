import { QUOTA_PERIODS } from '../db/seed';

export function findPeriod(period: string) {
  return QUOTA_PERIODS.find((p) => p.period === period);
}

/** Resolves "current" / "next" (relative to the snapshot as-of date) or an explicit label like FY27-Q2. */
export function resolvePeriod(value: string, asOfDate: string): string | undefined {
  const idx = QUOTA_PERIODS.findIndex((p) => p.start <= asOfDate && asOfDate <= p.end);
  if (value === 'current') return QUOTA_PERIODS[idx]?.period;
  if (value === 'next') return idx >= 0 ? QUOTA_PERIODS[idx + 1]?.period : undefined;
  return findPeriod(value)?.period;
}
