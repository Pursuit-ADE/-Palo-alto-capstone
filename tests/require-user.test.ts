// The user id comes only from the session cookie (system rule 3, audit Q3). With a session, a user id sent in the
// form is ignored, even when test identities are on. Before Oct 31 no test called requireUser() itself (bug hunt).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: undefined as { userId: string; username?: string; sessionId?: string } | undefined }));
const identities = vi.hoisted(() => ({ on: false }));
vi.mock('@/server/session', () => ({ currentSession: async () => session.current }));
vi.mock('@/server/identity', () => ({ testIdentitiesEnabled: () => identities.on }));

import { requireUser } from '@/server/require-user';

beforeEach(() => {
  session.current = undefined;
  identities.on = false;
});

describe('requireUser (system rule 3)', () => {
  it('a signed-in user stays themselves whatever id the form sends', async () => {
    session.current = { userId: 'u_ts_east', username: 'jordan', sessionId: 's1' };
    expect(await requireUser('u_analyst')).toEqual(session.current);
    identities.on = true;
    expect(await requireUser('u_analyst', 'u_analyst')).toEqual(session.current);
  });

  it('nobody signed in and test identities off: no user, whatever the form sends', async () => {
    expect(await requireUser('u_analyst', 'u_analyst')).toBeUndefined();
  });

  it('test identities on: only a known demo id is accepted', async () => {
    identities.on = true;
    expect(await requireUser('u_analyst')).toEqual({ userId: 'u_analyst' });
    expect(await requireUser('u_not_a_demo_user')).toBeUndefined();
  });
});
