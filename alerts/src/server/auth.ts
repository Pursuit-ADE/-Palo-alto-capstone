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
import { and, desc, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { weakPasswordReason } from './passwords';
import { appAccounts, appSessions } from '../db/schema';
import { demoUsers } from '../db/seed';
import { employeeStatusOf, type EmployeeDirectory } from '../alerts/employee-status';

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

/**
 * The date after which invite codes stop working, from DEMO_INVITE_EXPIRES (an ISO date such as 2026-11-10).
 * Unset means no expiry. An unreadable value turns sign-up off rather than leaving codes open forever.
 */
export function inviteExpiry(raw = process.env.DEMO_INVITE_EXPIRES): Date | null | 'invalid' {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

export async function signUp(db: Db, input: { username: string; password: string; invite: string }, secret = process.env.DEMO_INVITE_SECRET, now = new Date(), expiry = inviteExpiry(), directory?: EmployeeDirectory) {
  if (!secret || expiry === 'invalid') throw new AuthError('Sign-up is turned off here.', 'signup_off');
  if (expiry && now > expiry) throw new AuthError('Invite codes for this demo have expired.', 'invite_expired');
  const username = input.username.trim().toLowerCase();
  if (!USERNAME.test(username)) throw new AuthError('Use 3 to 32 lowercase letters, numbers, dots, dashes or underscores for the username.', 'bad_username');
  if (input.password.length < MIN_PASSWORD || input.password.length > 128) throw new AuthError(`Use a password of at least ${MIN_PASSWORD} characters.`, 'bad_password_length');
  const weak = weakPasswordReason(input.password, username);
  if (weak) throw new AuthError(weak, 'weak_password');
  const userId = userForInvite(input.invite, secret);
  if (!userId) throw new AuthError('That invite code is not valid.', 'bad_invite');
  // Checked before the account exists, so someone who has left doesn't spend the invite on an account they can't use
  // (PR #89 review). Same message as a bad code: the form doesn't say why.
  if ((await employeeStatusOf(directory, userId)) !== 'active') throw new AuthError('That invite code is not valid.', 'employee_inactive');
  // An invite code works once: each demo person has at most one account in this app (a unique index enforces it,
  // so two sign-ups at the same moment can't both win). A leaked code can't create more accounts.
  const inserted = await db
    .insert(appAccounts)
    .values({ username, userId, passwordHash: await hashPassword(input.password), createdAt: now })
    .onConflictDoNothing()
    .returning({ username: appAccounts.username });
  if (inserted.length === 0) {
    const [used] = await db.select({ username: appAccounts.username }).from(appAccounts).where(eq(appAccounts.userId, userId));
    if (used) throw new AuthError('That invite code has already been used. Ask for a new one.', 'invite_used');
    throw new AuthError('That username is taken.', 'username_taken');
  }
  return { username, userId };
}

/** How many sessions one account may have at once; logging in again drops the oldest beyond this. */
export const MAX_SESSIONS = 5;

/**
 * Checks the password and starts a session. Returns the raw token for the cookie; only its hash is stored.
 * Each log-in also deletes every expired session, and this account's oldest sessions beyond MAX_SESSIONS.
 */
export async function logIn(db: Db, usernameRaw: string, password: string, now = new Date(), directory?: EmployeeDirectory) {
  const username = usernameRaw.trim().toLowerCase();
  const [account] = USERNAME.test(username) ? await db.select().from(appAccounts).where(eq(appAccounts.username, username)) : [];
  const ok = await verifyPassword(password, account?.passwordHash ?? DUMMY_HASH);
  // A disabled account gets the same message as a wrong password.
  if (!account || !ok) throw new AuthError('The username or password is not right.', 'bad_credentials');
  if (account.disabledAt) throw new AuthError('The username or password is not right.', 'account_disabled');
  // Someone who has left the company can't sign in to read old alerts, and isn't told why (PR #55 review).
  if ((await employeeStatusOf(directory, account.userId)) !== 'active') throw new AuthError('The username or password is not right.', 'employee_inactive');
  const token = randomBytes(32).toString('base64url');
  await db.delete(appSessions).where(lt(appSessions.expiresAt, now));
  await db.insert(appSessions).values({
    tokenHash: tokenHash(token),
    username,
    userId: account.userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_HOURS * 3_600_000),
  });
  const extra = await db
    .select({ tokenHash: appSessions.tokenHash })
    .from(appSessions)
    .where(eq(appSessions.username, username))
    .orderBy(desc(appSessions.createdAt))
    .offset(MAX_SESSIONS);
  if (extra.length) await db.delete(appSessions).where(inArray(appSessions.tokenHash, extra.map((s) => s.tokenHash)));
  return { token, userId: account.userId, username, sessionId: tokenHash(token).slice(0, 16) };
}

export interface SessionInfo {
  userId: string;
  username: string;
  /** The first 16 characters of the stored token hash: enough to tell sessions apart in the audit log. */
  sessionId: string;
}

/**
 * The account behind a session token, if the session exists, hasn't expired, its account isn't disabled and (when a
 * directory is set) the person is an active employee. "Unknown" counts as not signed in: nothing is read on a guess.
 */
export async function sessionInfo(db: Db, token: string | undefined, now = new Date(), directory?: EmployeeDirectory): Promise<SessionInfo | undefined> {
  if (!token || token.length > 100) return undefined;
  const hash = tokenHash(token);
  const [s] = await db
    .select({ userId: appSessions.userId, username: appSessions.username })
    .from(appSessions)
    .innerJoin(appAccounts, eq(appAccounts.username, appSessions.username))
    .where(and(eq(appSessions.tokenHash, hash), gt(appSessions.expiresAt, now), isNull(appAccounts.disabledAt)));
  if (!s || (await employeeStatusOf(directory, s.userId)) !== 'active') return undefined;
  return { ...s, sessionId: hash.slice(0, 16) };
}

/** The user id a session token belongs to, if it exists, has not expired and its account is active. */
export async function sessionUser(db: Db, token: string | undefined, now = new Date(), directory?: EmployeeDirectory): Promise<string | undefined> {
  return (await sessionInfo(db, token, now, directory))?.userId;
}

export async function logOut(db: Db, token: string | undefined) {
  if (token) await db.delete(appSessions).where(eq(appSessions.tokenHash, tokenHash(token)));
}

/** Signs an account out everywhere. Returns how many sessions were ended. */
export async function revokeSessions(db: Db, username: string): Promise<number> {
  const gone = await db.delete(appSessions).where(eq(appSessions.username, username.trim().toLowerCase())).returning({ t: appSessions.tokenHash });
  return gone.length;
}

/** Disables (or re-enables) an account. Disabling also ends all its sessions. Needs a login that may update accounts. */
export async function setAccountDisabled(db: Db, username: string, disabled: boolean, now = new Date()): Promise<boolean> {
  const name = username.trim().toLowerCase();
  const changed = await db
    .update(appAccounts)
    .set({ disabledAt: disabled ? now : null })
    .where(eq(appAccounts.username, name))
    .returning({ username: appAccounts.username });
  if (disabled) await revokeSessions(db, name);
  return changed.length > 0;
}
