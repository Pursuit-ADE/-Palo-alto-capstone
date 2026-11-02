// Alert times show Eastern beside UTC, following daylight saving, and the snapshot date reads like the copilot's (UX review Nov 2).
import { describe, expect, it } from 'vitest';
import { easternHour, snapshotDay, utcWithEastern } from '@/alerts/time';

describe('alert times', () => {
  it('puts the Eastern time, with its date, beside the UTC time', () => {
    expect(utcWithEastern(new Date('2026-09-22T07:00:00Z'))).toBe('2026-09-22 07:00 UTC (Sep 22, 3:00 AM ET)');
    // Late evening Eastern is already the next day in UTC.
    expect(utcWithEastern(new Date('2026-09-23T02:00:00Z'))).toBe('2026-09-23 02:00 UTC (Sep 22, 10:00 PM ET)');
  });

  it('follows daylight saving for quiet hours', () => {
    expect(easternHour(22, new Date('2026-10-08T12:00:00Z'))).toBe('6 PM');
    expect(easternHour(22, new Date('2026-11-09T12:00:00Z'))).toBe('5 PM');
    expect(easternHour(7, new Date('2026-11-09T12:00:00Z'))).toBe('2 AM');
  });

  it('writes the snapshot date as the copilot does', () => {
    expect(snapshotDay('2026-10-08')).toBe('Oct 8, 2026');
  });
});
