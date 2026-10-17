// Follow-ups to the Oct 17 security review (#20) for the alerts app's per-process sign-in limit.
import { describe, expect, it } from 'vitest';
import { AttemptLimiter } from '@/server/attempt-limiter';
import { clientAddress, SHARED_ADDRESS } from '@/server/client-address';

describe('sign-in attempt limiter', () => {
  it('allows up to the limit in a minute, then again once the minute has passed', () => {
    const l = new AttemptLimiter();
    for (let i = 0; i < 10; i++) expect(l.allow('login:ana', 10, 1000 + i)).toBe(true);
    expect(l.allow('login:ana', 10, 2000)).toBe(false);
    expect(l.allow('login:ana', 10, 62_000)).toBe(true);
  });

  it('does not grow without bound under made-up keys', () => {
    const l = new AttemptLimiter(60_000, 100);
    for (let i = 0; i < 5000; i++) l.allow(`login:fake-${i}`, 10, i);
    expect(l.size).toBeLessThanOrEqual(100);
  });

  it('evicts expired keys first, so a live address count survives a full map', () => {
    const l = new AttemptLimiter(60_000, 50);
    for (let i = 0; i < 49; i++) l.allow(`login:old-${i}`, 10, i);
    for (let i = 0; i < 30; i++) l.allow('ip:shared', 30, 70_000 + i);
    expect(l.size).toBe(50);
    l.allow('login:new', 10, 70_100);
    expect(l.size).toBe(2);
    expect(l.allow('ip:shared', 30, 70_200)).toBe(false);
  });
});

describe('client address', () => {
  it('ignores a caller-written X-Forwarded-For without a trusted proxy', () => {
    expect(clientAddress(new Headers({ 'x-forwarded-for': '6.6.6.6' }), {})).toBe(SHARED_ADDRESS);
    expect(clientAddress(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), { TRUSTED_PROXY_HOPS: '1' })).toBe('203.0.113.9');
  });
});
