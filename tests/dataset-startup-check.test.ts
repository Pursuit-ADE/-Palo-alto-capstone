// The checks a server runs at start without the owner login: read what the database holds, compare it with the
// dataset the server was started for, and never write (project review, Nov 1, finding 5). Setup is where an empty
// database is loaded; a server that finds nothing says so instead of loading or running against nothing.
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatasetMismatch, openDatabase, verifyDataset, type Database } from '@/db/client';
import type { Db } from '@/db/client';

const NORTHSTAR = path.join(process.cwd(), 'data', 'northstar-crm');

let database: Database;
beforeAll(async () => {
  database = await openDatabase();
});
afterAll(async () => {
  await database.close();
});

describe('verifyDataset', () => {
  it('accepts the dataset the database holds', async () => {
    await expect(verifyDataset(database.db)).resolves.toBeUndefined();
  });

  it('refuses a database that holds another dataset, and names both', async () => {
    const error = await verifyDataset(database.db, 'northstar-v1', { dataDir: NORTHSTAR }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatasetMismatch);
    expect((error as Error).message).toMatch(/already holds snap_.*started for snap_northstar-v1/);
  });

  it('says an empty database has not been set up, and does not try to load it', async () => {
    // A stand-in that can only read: any attempt to insert would throw a TypeError instead of the message below.
    const readsOnly = { select: () => ({ from: async () => [] }) } as unknown as Db;
    await expect(verifyDataset(readsOnly)).rejects.toThrow(/holds no dataset yet.*db:setup/);
  });

  it('writes nothing', async () => {
    const before = await database.db.query.dataSnapshots.findMany();
    await verifyDataset(database.db);
    expect(await database.db.query.dataSnapshots.findMany()).toEqual(before);
  });
});
