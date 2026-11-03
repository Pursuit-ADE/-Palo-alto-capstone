// EMBEDDED_DB_DIR keeps the laptop database on disk so accounts survive a restart (demo run-through, Nov 2). Tests
// never use it, so a developer's setting can't leak into a run.
import { describe, expect, it } from 'vitest';
import { embeddedDir } from '@/db/client';

describe('embedded database folder', () => {
  it('uses EMBEDDED_DB_DIR when set, memory when not, and always memory under test', () => {
    expect(embeddedDir({ EMBEDDED_DB_DIR: '.pglite' })).toBe('.pglite');
    expect(embeddedDir({})).toBeUndefined();
    expect(embeddedDir({ EMBEDDED_DB_DIR: '' })).toBeUndefined();
    expect(embeddedDir({ EMBEDDED_DB_DIR: '.pglite', VITEST: 'true' })).toBeUndefined();
  });
});
