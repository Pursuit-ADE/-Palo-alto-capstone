// Follow-ups to the Oct 17 security review (#20) for the alerts app's sign-in limit. The limit itself is shared
// through the database (src/server/login-limit.ts, tests/login-limit.test.ts); this checks the address it counts.
import { describe, expect, it } from 'vitest';
import { addressLimit, clientAddress, SHARED_ADDRESS } from '@/server/client-address';

describe('client address', () => {
  it('ignores a caller-written X-Forwarded-For without a trusted proxy', () => {
    expect(clientAddress(new Headers({ 'x-forwarded-for': '6.6.6.6' }), {})).toBe(SHARED_ADDRESS);
    expect(clientAddress(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), { TRUSTED_PROXY_HOPS: '1' })).toBe('203.0.113.9');
  });

  it('gives the shared bucket a larger allowance than one address', () => {
    expect(addressLimit(SHARED_ADDRESS)).toBeGreaterThan(addressLimit('203.0.113.9'));
  });
});
