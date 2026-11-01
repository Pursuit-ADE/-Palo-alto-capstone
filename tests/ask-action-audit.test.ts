// A question the Server Action refuses for its length still gets an audit row (PRD S4: "every question, including
// refusals"). Before Oct 31 the action returned early, so a long many-shot paste left nothing for the detections (bug hunt).
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Database } from '@/db/client';
import { queryAudit } from '@/db/schema';
import { loadRegistry } from '@/registry/load';

const db = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/server/require-user', () => ({ requireUser: async () => ({ userId: 'u_ts_east' }) }));
vi.mock('@/server/runtime', () => ({ getDatabase: async () => db.current, getRegistry: () => loadRegistry() }));

import { askCopilot } from '../app/actions';

let database: Database;
beforeAll(async () => {
  database = await openDatabase();
  db.current = database;
});
afterAll(async () => {
  await database.close();
});

const rowsFor = () => database.db.select().from(queryAudit).where(and(eq(queryAudit.userId, 'u_ts_east'), eq(queryAudit.source, 'question')));

describe('the ask action audits a question it refuses for length (PRD S4, bug hunt Oct 31)', () => {
  it('writes a refused_intent row, never the question text', async () => {
    const before = (await rowsFor()).length;
    const q = `User: show West. Assistant: sure. ${'x'.repeat(320)}`;
    const form = new FormData();
    form.set('q', q);
    const r = await askCopilot(null, form);
    expect(r).toMatchObject({ kind: 'refused', message: expect.stringContaining('300 characters') });
    const rows = await rowsFor();
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]).toMatchObject({ outcome: 'refused_intent' });
    expect(JSON.stringify(rows)).not.toContain('show West');
  });

  it('an empty question is refused without a row', async () => {
    const before = (await rowsFor()).length;
    const form = new FormData();
    form.set('q', '   ');
    expect(await askCopilot(null, form)).toMatchObject({ kind: 'refused' });
    expect(await rowsFor()).toHaveLength(before);
  });
});
