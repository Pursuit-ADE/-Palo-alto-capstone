// A production alerts server missing a setting stops at start with its name, instead of saying "Ready" (UX review Nov 2).
import { afterEach, expect, it, vi } from 'vitest';
import { register } from '../instrumentation';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('stops a production server at start when EMPLOYEE_STATUS is missing, naming it', async () => {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('EMPLOYEE_STATUS', '');
  vi.stubEnv('ALERTS_SCHEDULER', '');
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await register();
  expect(exit).toHaveBeenCalledWith(1);
  expect(String(error.mock.calls[0]?.[0])).toContain('EMPLOYEE_STATUS');
});

it('starts when the settings are decided', async () => {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('EMPLOYEE_STATUS', 'off');
  vi.stubEnv('ALERTS_SCHEDULER', '');
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  await register();
  expect(exit).not.toHaveBeenCalled();
});
