import { openDatabase, type Database } from '../db/client';
import { loadRegistry, type Registry } from '../registry/load';

// One embedded database and registry per server process (in memory, re-seeded deterministically on start).
const g = globalThis as unknown as { __db?: Promise<Database>; __reg?: Registry };

export function getDatabase(): Promise<Database> {
  g.__db ??= openDatabase();
  return g.__db;
}

export function getRegistry(): Registry {
  g.__reg ??= loadRegistry();
  return g.__reg;
}
