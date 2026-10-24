// The alert summary (alerts/app/alert-kpis.ts): the Numbers tiles and the Graphs chart read the same list.
import { describe, expect, it } from 'vitest';
import { alertKpis } from '../app/alert-kpis';

describe('alert summary', () => {
  it('counts delivered, waiting and not sent the way the tiles always have', () => {
    const k = alertKpis({ delivered: 4, queued_digest: 2, suppressed_no_access: 1, failed: 3, pending: 9, sending: 5 });
    expect(k.map((x) => [x.label, x.value])).toEqual([
      ['Delivered', 4],
      ['Waiting for digest', 2],
      ['Not sent', 4],
    ]);
    expect(k[2]!.detail).toBe('1 access removed · 3 channel unavailable');
  });

  it('counts someone who left the company as not sent, with the access removed (PR #55)', () => {
    const k = alertKpis({ suppressed_no_access: 1, suppressed_inactive: 2, failed: 1 });
    expect(k[2]!.value).toBe(4);
    expect(k[2]!.detail).toBe('3 access removed · 1 channel unavailable');
  });

  it('missing statuses count as 0', () => {
    expect(alertKpis({}).map((x) => x.value)).toEqual([0, 0, 0]);
  });
});
