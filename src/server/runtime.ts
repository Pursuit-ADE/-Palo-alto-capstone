import { openDatabase, type Database } from '../db/client';
import { loadRegistry, type Registry } from '../registry/load';
import { createEmployeeDirectory, type EmployeeDirectory } from './employee-status';

// One embedded database and registry per server process (in memory, re-seeded deterministically on start).
const g = globalThis as unknown as { __db?: () => Promise<Database>; __reg?: Registry; __dir?: { directory: EmployeeDirectory | undefined } };

/**
 * Runs `init` once and shares the result. If it fails (say the database was briefly unreachable), the failure
 * is not cached: the next call tries again instead of returning the same error until a restart.
 */
export function onceWithRetry<T>(init: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= init().catch((e: unknown) => {
      pending = undefined;
      throw e;
    });
    return pending;
  };
}

export function getDatabase(): Promise<Database> {
  g.__db ??= onceWithRetry(() => openDatabase());
  return g.__db();
}

export function getRegistry(): Registry {
  g.__reg ??= loadRegistry();
  return g.__reg;
}

/** One employee directory per process, read from EMPLOYEE_STATUS: sign-in and every session read ask the same one. */
export function getEmployeeDirectory(): EmployeeDirectory | undefined {
  g.__dir ??= { directory: createEmployeeDirectory() };
  return g.__dir.directory;
}
