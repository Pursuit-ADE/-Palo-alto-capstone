// Demo sign-in for the alerts app (Week 5), the same scheme as the copilot's src/server/auth.ts. The client allows a create-an-account option for the demo; a real rollout uses
// Active Directory and SSO. What matters for security is where the user id comes from: a verified server-side
// session, never a form field, URL or alert link.
//
// - Sign-up needs an invite code. Each code belongs to one demo person, so the role comes from the invite,
//   not from anything the person types. Codes are derived from DEMO_INVITE_SECRET; without it, sign-up is off.
// - Passwords are stored as scrypt hashes with a per-account salt.
// - A session is a random token in an httpOnly cookie; the database stores only its SHA-256 hash.
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { weakPasswordReason } from './passwords';
import { appAccounts, appSessions } from '../db/schema';
import { demoUsers } from '../db/seed';

// The alerts app's demo people (Maven only). The invite codes are the same as the copilot's for the same secret.
let demoIds: string[] | undefined;
export function activeDemoIds(): string[] {
  demoIds ??= demoUsers().map((u) => u.id);
  return demoIds;
}

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_HOURS = 8;
export const MIN_PASSWORD = 12;

export class AuthError extends Error {
  /** A short reason code for the audit log; the message is what the person sees. */
  readonly code: string;
  constructor(message: string, code = 'invalid') {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, saltB64, keyB64] = stored.split('$');
  if (kind !== 'scrypt' || !n || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, { ...SCRYPT, N: Number(n) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** The invite code for one demo person, e.g. "7F3A-91C2-04BE". */
export function inviteCode(userId: string, secret: string): string {
  const hex = createHmac('sha256', secret).update(`invite:${userId}`).digest('hex').slice(0, 12).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

/** The demo person an invite code belongs to, or undefined. */
export function userForInvite(code: string, secret: string | undefined, ids: readonly string[] = activeDemoIds()): string | undefined {
  if (!secret) return undefined;
  const given = Buffer.from(code.trim().toUpperCase());
  for (const id of ids) {
    const want = Buffer.from(inviteCode(id, secret));
    if (given.length === want.length && timingSafeEqual(given, want)) return id;
  }
  return undefined;
}

const USERNAME = /^[a-z0-9._-]{3,32}$/;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
// Checked when the username doesn't exist, so a wrong username takes as long as a wrong password.
const DUMMY_HASH = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export async function signUp(db: Db, input: { username: string; password: string; invite: string }, secret = process.env.DEMO_INVITE_SECRET, now = new Date()) {
  if (!secret) throw new AuthError('Sign-up is turned off here.', 'signup_off');
  const username = input.username.trim().toLowerCase();
  if (!USERNAME.test(username)) throw new AuthError('Use 3 to 32 lowercase letters, numbers, dots, dashes or underscores for the username.', 'bad_username');
  if (input.password.length < MIN_PASSWORD || input.password.length > 128) throw new AuthError(`Use a password of at least ${MIN_PASSWORD} characters.`, 'bad_password_length');
  const weak = weakPasswordReason(input.password, username);
  if (weak) throw new AuthError(weak, 'weak_password');
  const userId = userForInvite(input.invite, secret);
  if (!userId) throw new AuthError('That invite code is not valid.', 'bad_invite');
  const inserted = await db
    .insert(appAccounts)
    .values({ username, userId, passwordHash: await hashPassword(input.password), createdAt: now })
    .onConflictDoNothing()
    .returning({ username: appAccounts.username });
  if (inserted.length === 0) throw new AuthError('That username is taken.', 'username_taken');
  return { username, userId };
}

/** Checks the password and starts a session. Returns the raw token for the cookie; only its hash is stored. */
export async function logIn(db: Db, usernameRaw: string, password: string, now = new Date()) {
  const username = usernameRaw.trim().toLowerCase();
  const [account] = USERNAME.test(username) ? await db.select().from(appAccounts).where(eq(appAccounts.username, username)) : [];
  const ok = await verifyPassword(password, account?.passwordHash ?? DUMMY_HASH);
  if (!account || !ok) throw new AuthError('The username or password is not right.', 'bad_credentials');
  const token = randomBytes(32).toString('base64url');
  await db.insert(appSessions).values({
    tokenHash: tokenHash(token),
    username,
    userId: account.userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_HOURS * 3_600_000),
  });
  return { token, userId: account.userId };
}

/** The user id a session token belongs to, if it exists and has not expired. */
export async function sessionUser(db: Db, token: string | undefined, now = new Date()): Promise<string | undefined> {
  if (!token || token.length > 100) return undefined;
  const [s] = await db
    .select({ userId: appSessions.userId })
    .from(appSessions)
    .where(and(eq(appSessions.tokenHash, tokenHash(token)), gt(appSessions.expiresAt, now)));
  return s?.userId;
}

export async function logOut(db: Db, token: string | undefined) {
  if (token) await db.delete(appSessions).where(eq(appSessions.tokenHash, tokenHash(token)));
}
