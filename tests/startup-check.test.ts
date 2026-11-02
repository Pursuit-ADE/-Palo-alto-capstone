// A production server missing AUDIT_HASH_KEY or EMPLOYEE_STATUS stops at start with the name (UX review, Nov 2).
import { afterEach, expect, it, vi } from 'vitest';
import { checkConfigAtStart } from '@/server/startup-check';

afterEach(() => vi.restoreAllMocks());

it('exits with the missing settings named', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const exit = vi.fn();
  checkConfigAtStart({ NODE_ENV: 'production' }, exit);
  expect(exit).toHaveBeenCalledWith(1);
  const text = String(log.mock.calls[0]?.[0]);
  expect(text).toContain('AUDIT_HASH_KEY');
  expect(text).toContain('EMPLOYEE_STATUS');
});

it('starts when the settings are decided, and outside production', () => {
  const exit = vi.fn();
  checkConfigAtStart({ NODE_ENV: 'production', AUDIT_HASH_KEY: 'k'.repeat(32), EMPLOYEE_STATUS: 'off' }, exit);
  checkConfigAtStart({ NODE_ENV: 'development' }, exit);
  expect(exit).not.toHaveBeenCalled();
});
