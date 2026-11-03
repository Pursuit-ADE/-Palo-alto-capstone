// The alert engine. One shared rule is evaluated per subscriber (L4): a user only gets an alert for an
// account they can see, access is checked again right before anything is sent, and the database's
// unique key (rule, user, event) guarantees each alert is created once.
import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accountTeam, accounts, alertDeliveries, alertSubscriptions, appAccounts, appUsers, contacts, engagements, supportCases } from '../db/schema';
import type { Channels } from './channels';
import { employeeStatusOf, type EmployeeDirectory } from './employee-status';
import { lowUsageEvents } from './low-usage';
import { render, type AlertRule } from './rules';
import { utcWithEastern } from './time';
import { digestDue, lastSlot, normalizeFrequency } from './schedule';

export interface AlertEvent {
  id: string;
  accountId: string;
  accountName: string;
  at: Date;
  severity: string;
  values: Record<string, string>;
}

export interface EngineOptions {
  copilotUrl?: string;
  /** Test mode only: keep the test identity on copilot links so the demo opens as the same person. */
  testIdentityInLinks?: boolean;
  /** Employee status. When set, only people it reports as active get an alert (client ask, Oct 23). Unset: check off. */
  directory?: EmployeeDirectory;
  /** Called when alerts run out of channel attempts. Default: one console.error line for the operator. */
  reportUndelivered?: (e: { userId: string; channel: string; ids: string[] }) => void;
}

/** The default operator signal for alerts that ran out of attempts: ids only, never account names or alert text. */
export function reportUndelivered(e: { userId: string; channel: string; ids: string[] }) {
  console.error(`alerts: ${e.ids.length} alert(s) undelivered after ${MAX_ATTEMPTS} attempts (user ${e.userId}, channel ${e.channel}): ${e.ids.join(', ')}`);
}

export type DeliveryStatus = 'pending' | 'sending' | 'delivered' | 'queued_digest' | 'suppressed_no_access' | 'suppressed_inactive' | 'failed' | 'undelivered';

/** A claim older than this is treated as a send that was cut off, and may be taken over. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;
/**
 * A failed alert is retried up to this many channel attempts in total, waiting 2^attempts minutes between tries. Then it
 * is marked 'undelivered' and reported to the operator, never dropped silently (evaluator F-05, #83). A directory that
 * can't answer doesn't use up attempts: the alert waits for it.
 */
export const MAX_ATTEMPTS = 5;

const when = utcWithEastern;

/** Events in [since, until] that match a rule's conditions. */
export async function matchingEvents(db: Db, rule: AlertRule, since: Date, until: Date): Promise<AlertEvent[]> {
  if (rule.event === 'support_case') {
    const rows = await db
      .select({ c: supportCases, accountName: accounts.name })
      .from(supportCases)
      .innerJoin(accounts, eq(accounts.id, supportCases.accountId))
      .where(
        and(
          gte(supportCases.openedAt, since),
          lte(supportCases.openedAt, until),
          inArray(supportCases.severity, rule.conditions.severityIn),
          inArray(supportCases.status, rule.conditions.statusIn),
        ),
      );
    return rows.map(({ c, accountName }) => ({
      id: c.id,
      accountId: c.accountId,
      accountName,
      at: c.openedAt,
      severity: c.severity,
      values: { account: accountName, severity: c.severity, subject: c.subject, when: when(c.openedAt) },
    }));
  }
  if (rule.event === 'low_usage') return lowUsageEvents(db, until);
  const rows = await db
    .select({ e: engagements, accountName: accounts.name, title: contacts.title, isCxo: contacts.isCxo })
    .from(engagements)
    .innerJoin(accounts, eq(accounts.id, engagements.accountId))
    .innerJoin(contacts, eq(contacts.id, engagements.contactId))
    .where(and(gte(engagements.occurredAt, since), lte(engagements.occurredAt, until), inArray(engagements.type, rule.conditions.typeIn)));
  return rows
    .filter((r) => !rule.conditions.cxoOnly || r.isCxo)
    .map(({ e, accountName, title }) => ({
      id: e.id,
      accountId: e.accountId,
      accountName,
      at: e.occurredAt,
      severity: 'info',
      values: { account: accountName, contactTitle: title, asset: e.asset, type: e.type.replace('_', ' '), when: when(e.occurredAt) },
    }));
}

/** A user whose sign-in account was disabled gets no new alerts and no further deliveries (offboarding). */
export async function isDisabled(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ u: appAccounts.userId })
    .from(appAccounts)
    .where(and(eq(appAccounts.userId, userId), isNotNull(appAccounts.disabledAt)));
  return rows.length > 0;
}

/** Account access comes from the account-team mapping in the database, read fresh every time. */
export async function canSeeAccount(db: Db, userId: string, accountId: string): Promise<boolean> {
  const rows = await db
    .select({ u: accountTeam.userId })
    .from(accountTeam)
    .where(and(eq(accountTeam.userId, userId), eq(accountTeam.accountId, accountId)));
  return rows.length > 0;
}

/**
 * Whether an alert may be created for this person now: the account isn't disabled, the employee directory (when one is
 * set) says active, and they can see the account. "Unknown" skips creation; the late-arrival window finds the event again.
 */
async function canAlert(db: Db, opts: EngineOptions, userId: string, accountId: string): Promise<boolean> {
  if (await isDisabled(db, userId)) return false;
  if ((await employeeStatusOf(opts.directory, userId)) !== 'active') return false;
  return canSeeAccount(db, userId, accountId);
}

export function inQuietHours(sub: { quietStartHour: number | null; quietEndHour: number | null }, now: Date): boolean {
  const { quietStartHour: s, quietEndHour: e } = sub;
  if (s === null || e === null || s === e) return false;
  const h = now.getUTCHours();
  return s < e ? h >= s && h < e : h >= s || h < e;
}

/**
 * Evaluates every rule against events in [since, now] and routes the resulting alerts.
 * Returns the ids of the alerts created in this run.
 */
export async function runAlerts(db: Db, rules: Map<string, AlertRule>, channels: Channels, since: Date, now: Date, opts: EngineOptions = {}) {
  const created: string[] = [];
  const copilotUrl = opts.copilotUrl ?? process.env.COPILOT_URL ?? 'http://localhost:3000';
  for (const rule of rules.values()) {
    const subs = await db
      .select({ s: alertSubscriptions, role: appUsers.role })
      .from(alertSubscriptions)
      .innerJoin(appUsers, eq(appUsers.id, alertSubscriptions.userId))
      .where(eq(alertSubscriptions.ruleId, rule.id));
    const audience = subs.filter((x) => (rule.audience as string[]).includes(x.role));
    if (audience.length === 0) continue;
    const events = await matchingEvents(db, rule, since, now);
    for (const ev of events) {
      for (const { s: sub } of audience) {
        if (!(await canAlert(db, opts, sub.userId, ev.accountId))) continue;
        const id = `alert_${rule.id}_${sub.userId}_${ev.id}`;
        const inserted = await db
          .insert(alertDeliveries)
          .values({
            id,
            ruleId: rule.id,
            ruleVersion: rule.version,
            userId: sub.userId,
            eventId: ev.id,
            accountId: ev.accountId,
            severity: ev.severity,
            title: render(rule.title, ev.values),
            explanation: `${render(rule.explain, ev.values)} Rule: ${rule.id} v${rule.version}.`,
            // The link names a fixed prompt (the rule id) and the account id, which the copilot maps to a known question
            // about that account (src/server/prompts.ts), so the link is about this alert (UX review Nov 2, BH r2 3).
            // Identity comes from the copilot's own sign-in; only in test mode is the test identity carried along.
            link: `${copilotUrl}/?prompt=${encodeURIComponent(rule.id)}&account=${encodeURIComponent(ev.accountId)}${opts.testIdentityInLinks ? `&user=${encodeURIComponent(sub.userId)}` : ''}`,
            status: 'pending',
            channel: sub.channel,
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: alertDeliveries.id });
        if (inserted.length > 0) created.push(id);
        else {
          // Already created for this rule, user and event. Only a send that never finished is tried again;
          // delivered, queued and suppressed alerts are left as they are.
          const [existing] = await db.select({ status: alertDeliveries.status }).from(alertDeliveries).where(eq(alertDeliveries.id, id));
          // Rediscovering an event only finishes routing an alert that was never claimed. Failed and in-flight
          // alerts belong to the flush (retry limits, backoff, active claims) and are never reset here.
          if (!existing || existing.status !== 'pending') continue;
        }
        const critical = (rule.criticalSeverities as string[]).includes(ev.severity);
        const sendNow = (normalizeFrequency(sub.frequency) === 'realtime' && !inQuietHours(sub, now)) || (critical && sub.criticalBypass);
        if (sendNow) await send(db, rules, channels, [id], now, undefined, opts);
        else await db.update(alertDeliveries).set({ status: 'queued_digest' }).where(and(eq(alertDeliveries.id, id), eq(alertDeliveries.status, 'pending')));
      }
    }
  }
  await refreshQueuedCases(db, rules, channels, now, opts);
  return created;
}

const UNCLAIMED = ['pending', 'queued_digest'];

/**
 * A queued case alert describes its case as it was when the alert was created, because the unique key keeps the first
 * row. A case can escalate or close before the digest goes out, and the late-arrival window only looks back so far, so
 * this reads each unclaimed case alert's case again, on every evaluation and every flush (project review, Nov 1).
 * - The severity, title and text follow the case. The update keeps the status guard, so an alert a sender has claimed is
 *   never overwritten, and a delivered alert is never touched.
 * - A case that has newly become critical goes out at once to a subscriber whose P1 bypass is on, through quiet hours and
 *   digests, as a new P1 case does. send() still claims it atomically and re-checks access.
 * - A case that has since closed stays queued and its text says so: it is not dropped silently, and it is not promoted.
 */
async function refreshQueuedCases(db: Db, rules: Map<string, AlertRule>, channels: Channels, now: Date, opts: EngineOptions) {
  const caseRuleIds = [...rules.values()].filter((r) => r.event === 'support_case').map((r) => r.id);
  if (caseRuleIds.length === 0) return;
  const rows = await db
    .select({ d: alertDeliveries, c: supportCases, accountName: accounts.name, s: alertSubscriptions })
    .from(alertDeliveries)
    .innerJoin(supportCases, eq(supportCases.id, alertDeliveries.eventId))
    .innerJoin(accounts, eq(accounts.id, supportCases.accountId))
    .leftJoin(alertSubscriptions, and(eq(alertSubscriptions.userId, alertDeliveries.userId), eq(alertSubscriptions.ruleId, alertDeliveries.ruleId)))
    .where(and(inArray(alertDeliveries.status, UNCLAIMED), inArray(alertDeliveries.ruleId, caseRuleIds)));
  const promote: string[] = [];
  for (const { d, c, accountName, s } of rows) {
    const rule = rules.get(d.ruleId);
    if (rule?.event !== 'support_case') continue;
    const closed = !(rule.conditions.statusIn as string[]).includes(c.status);
    const values = { account: accountName, severity: c.severity, subject: c.subject, when: when(c.openedAt) };
    const fresh = {
      severity: c.severity,
      title: render(rule.title, values),
      explanation: `${render(rule.explain, values)} Rule: ${rule.id} v${d.ruleVersion}.${closed ? ' The case has since been closed.' : ''}`,
    };
    if (fresh.severity !== d.severity || fresh.title !== d.title || fresh.explanation !== d.explanation) {
      await db.update(alertDeliveries).set(fresh).where(and(eq(alertDeliveries.id, d.id), inArray(alertDeliveries.status, UNCLAIMED)));
    }
    const escalated = c.severity !== d.severity && (rule.criticalSeverities as string[]).includes(c.severity);
    if (escalated && !closed && s?.criticalBypass) promote.push(d.id);
  }
  await send(db, rules, channels, promote, now, undefined, opts);
}

/**
 * Whether this alert may still go to this user right now: the user still exists, is not disabled, has a role in the rule's
 * audience, is still subscribed to the rule, and can still see the account. Read fresh from the database.
 */
export async function stillEligible(db: Db, rules: Map<string, AlertRule>, row: { userId: string; ruleId: string; accountId: string }): Promise<boolean> {
  const rule = rules.get(row.ruleId);
  if (!rule) return false;
  const [user] = await db.select({ role: appUsers.role }).from(appUsers).where(eq(appUsers.id, row.userId));
  if (!user || !(rule.audience as string[]).includes(user.role)) return false;
  if (await isDisabled(db, row.userId)) return false;
  const [sub] = await db
    .select({ u: alertSubscriptions.userId })
    .from(alertSubscriptions)
    .where(and(eq(alertSubscriptions.userId, row.userId), eq(alertSubscriptions.ruleId, row.ruleId)));
  if (!sub) return false;
  return canSeeAccount(db, row.userId, row.accountId);
}

const VERDICT_STATUS = { retry: 'failed', inactive: 'suppressed_inactive', no_access: 'suppressed_no_access' } as const;

/** What to do with one claimed alert just before sending: send it, retry it later, or drop it for a stated reason. */
async function sendVerdict(
  db: Db,
  rules: Map<string, AlertRule>,
  row: { userId: string; ruleId: string; accountId: string },
  directory: EmployeeDirectory | undefined,
): Promise<'send' | keyof typeof VERDICT_STATUS> {
  const employee = await employeeStatusOf(directory, row.userId);
  if (employee === 'inactive') return 'inactive';
  if (employee === 'unknown') return 'retry';
  return (await stillEligible(db, rules, row)) ? 'send' : 'no_access';
}

/**
 * Sends alerts as one message per user and channel.
 * - Each alert is first claimed atomically with a unique token (status 'sending'), so two senders never both
 *   deliver it. Every later update requires that same token, so a sender whose claim was taken over can't
 *   overwrite the newer sender's result.
 * - Eligibility (role, subscription, account access, employee status) is re-checked for each group immediately before its
 *   channel call; anything no longer allowed is suppressed instead of sent.
 * - Failed alerts are retried with backoff (2^attempts minutes) up to MAX_ATTEMPTS.
 * Delivery is at-least-once: if a process dies after the channel accepted a message but before it was marked
 * delivered, a later run may send it again once the claim is stale.
 */
export async function send(db: Db, rules: Map<string, AlertRule>, channels: Channels, ids: string[], now: Date, digestId?: string, opts: EngineOptions = {}) {
  if (ids.length === 0) return;
  const token = randomUUID();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
  const claimed = await db
    .update(alertDeliveries)
    .set({ status: 'sending', claimedAt: now, claimToken: token, attempts: sql`${alertDeliveries.attempts} + 1` })
    .where(
      and(
        inArray(alertDeliveries.id, ids),
        or(
          inArray(alertDeliveries.status, ['pending', 'queued_digest']),
          and(
            eq(alertDeliveries.status, 'failed'),
            lt(alertDeliveries.attempts, MAX_ATTEMPTS),
            sql`${alertDeliveries.claimedAt} <= ${nowIso}::timestamptz - (interval '1 minute' * power(2, ${alertDeliveries.attempts}))`,
          ),
          and(eq(alertDeliveries.status, 'sending'), lt(alertDeliveries.claimedAt, staleBefore)),
        ),
      ),
    )
    .returning();
  const mine = (rowIds: string[]) =>
    and(inArray(alertDeliveries.id, rowIds), eq(alertDeliveries.status, 'sending'), eq(alertDeliveries.claimToken, token));

  const byUserChannel = new Map<string, typeof claimed>();
  for (const r of claimed) {
    const k = `${r.userId}|${r.channel}`;
    byUserChannel.set(k, [...(byUserChannel.get(k) ?? []), r]);
  }
  for (const [k, group] of byUserChannel) {
    const [userId, channel] = k.split('|') as [string, string];
    const items: typeof claimed = [];
    for (const r of group) {
      const verdict = await sendVerdict(db, rules, r, opts.directory);
      if (verdict === 'send') items.push(r);
      // A directory that could not answer is retried without using up an attempt, so a long outage delays the alert
      // instead of dropping it (evaluator F-05); "left the company" is final.
      else if (verdict === 'retry') await db.update(alertDeliveries).set({ status: 'failed', attempts: sql`${alertDeliveries.attempts} - 1` }).where(mine([r.id]));
      else await db.update(alertDeliveries).set({ status: VERDICT_STATUS[verdict] }).where(mine([r.id]));
    }
    if (items.length === 0) continue;
    const ok = await channels.deliver(channel, userId, items, digestId !== undefined);
    if (ok) {
      await db.update(alertDeliveries).set({ status: 'delivered', deliveredAt: now, digestId: digestId ?? null }).where(mine(items.map((i) => i.id)));
      await noteTeam(db, channels, userId, items);
      continue;
    }
    const spent = items.filter((i) => i.attempts >= MAX_ATTEMPTS).map((i) => i.id);
    const retry = items.filter((i) => i.attempts < MAX_ATTEMPTS).map((i) => i.id);
    if (retry.length) await db.update(alertDeliveries).set({ status: 'failed' }).where(mine(retry));
    if (spent.length) {
      // Report only the rows this sender actually marked: a sender whose claim was taken over changes nothing here,
      // and must not report alerts the newer sender may still deliver (PR #90 review).
      const marked = await db.update(alertDeliveries).set({ status: 'undelivered' }).where(mine(spent)).returning({ id: alertDeliveries.id });
      // The operator's signal (evaluator F-05). Ids only: no account names or alert text in the log.
      if (marked.length) (opts.reportUndelivered ?? reportUndelivered)({ userId, channel, ids: marked.map((m) => m.id) });
    }
  }
}

/**
 * After a person's alert is delivered, a short note to their team's Slack channel, if the team has one (team alerts,
 * local Nov 3). Best effort: the person's own delivery already counts, so a failed note is logged (ids only) and not retried.
 */
async function noteTeam(db: Db, channels: Channels, userId: string, items: (typeof alertDeliveries.$inferSelect)[]) {
  if (!channels.team) return;
  const [user] = await db.select({ name: appUsers.displayName, managerId: appUsers.managerId }).from(appUsers).where(eq(appUsers.id, userId));
  if (!user?.managerId) return;
  const ok = await channels.team(user.managerId, user.name, items).catch(() => false);
  if (ok === false) console.warn(`Team alert not posted for team ${user.managerId}: ${items.map((i) => i.id).join(', ')}`);
}

/**
 * Delivers queued digests, retries failed alerts whose backoff has passed, and takes over stale sends, for
 * every user who is not in quiet hours. Runs independently of the events, so a failed alert is never stranded.
 */
export async function flushDigests(db: Db, rules: Map<string, AlertRule>, channels: Channels, now: Date, opts: EngineOptions = {}) {
  // First, so a digest describes its cases as they are now and a newly critical case is not held for the slot.
  await refreshQueuedCases(db, rules, channels, now, opts);
  const due = await db
    .select({ d: alertDeliveries, s: alertSubscriptions })
    .from(alertDeliveries)
    .leftJoin(alertSubscriptions, and(eq(alertSubscriptions.userId, alertDeliveries.userId), eq(alertSubscriptions.ruleId, alertDeliveries.ruleId)))
    .where(inArray(alertDeliveries.status, ['queued_digest', 'failed', 'sending']));
  const byUser = new Map<string, string[]>();
  const digestSubs = new Map<string, { userId: string; ruleId: string }>();
  for (const q of due) {
    // Quiet hours hold digests and retries, except a critical alert whose subscriber turned on the bypass.
    const critical = (rules.get(q.d.ruleId)?.criticalSeverities as string[] | undefined)?.includes(q.d.severity) ?? false;
    if (q.s && inQuietHours(q.s, now) && !(critical && q.s.criticalBypass)) continue;
    // A queued digest waits for its daily, weekly or monthly slot. Retries of failed sends don't wait for it.
    if (q.d.status === 'queued_digest' && q.s && !digestDue(q.s, now)) continue;
    const frequency = q.s ? normalizeFrequency(q.s.frequency) : 'realtime';
    // After the first digest, a digest carries only what was queued before its slot: an alert created after
    // the slot waits for the next one, even when the slot itself had nothing to send. (A new subscriber's
    // first digest goes out with whatever is already queued.)
    if (q.d.status === 'queued_digest' && frequency !== 'realtime' && q.s?.lastDigestAt && q.d.createdAt > lastSlot(frequency, now)) continue;
    if (q.d.status === 'queued_digest' && q.s && frequency !== 'realtime') {
      digestSubs.set(`${q.s.userId}|${q.s.ruleId}`, { userId: q.s.userId, ruleId: q.s.ruleId });
    }
    byUser.set(q.d.userId, [...(byUser.get(q.d.userId) ?? []), q.d.id]);
  }
  for (const [userId, ids] of byUser) await send(db, rules, channels, ids, now, `digest_${userId}_${now.toISOString().slice(0, 13)}`, opts);
  // The digest slot is used, whatever happened to individual alerts; failures retry on their own backoff.
  for (const { userId, ruleId } of digestSubs.values()) {
    await db
      .update(alertSubscriptions)
      .set({ lastDigestAt: now })
      .where(and(eq(alertSubscriptions.userId, userId), eq(alertSubscriptions.ruleId, ruleId)));
  }
}

/** The in-app inbox: only alerts that were actually delivered. Nothing held, blocked or failed is readable. */
export async function inbox(db: Db, userId: string) {
  const rank: Record<string, number> = { P1: 0, P2: 1, info: 2 };
  // Follows current access: an alert about an account the user can no longer see leaves the inbox.
  // (A Slack message already sent can't be recalled.) Policy to confirm with the client.
  const rows = (
    await db
      .select({ d: alertDeliveries })
      .from(alertDeliveries)
      .innerJoin(accountTeam, and(eq(accountTeam.userId, alertDeliveries.userId), eq(accountTeam.accountId, alertDeliveries.accountId)))
      .where(and(eq(alertDeliveries.userId, userId), eq(alertDeliveries.status, 'delivered')))
  ).map((r) => r.d);
  return rows.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.title.localeCompare(b.title));
}

/** Counts per status, without any alert content. */
export async function statusCounts(db: Db, userId: string): Promise<Record<string, number>> {
  const rows = await db.select({ status: alertDeliveries.status }).from(alertDeliveries).where(eq(alertDeliveries.userId, userId));
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}
