// The alert engine. One shared rule is evaluated per subscriber (L4): a user only gets an alert for an
// account they can see, access is checked again right before anything is sent, and the database's
// unique key (rule, user, event) guarantees each alert is created once.
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accountTeam, accounts, alertDeliveries, alertSubscriptions, appUsers, contacts, engagements, supportCases } from '../db/schema';
import type { Channels } from './channels';
import { render, type AlertRule } from './rules';

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
}

export type DeliveryStatus = 'pending' | 'delivered' | 'queued_digest' | 'suppressed_no_access' | 'failed';

function when(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

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

/** Account access comes from the account-team mapping in the database, read fresh every time. */
export async function canSeeAccount(db: Db, userId: string, accountId: string): Promise<boolean> {
  const rows = await db
    .select({ u: accountTeam.userId })
    .from(accountTeam)
    .where(and(eq(accountTeam.userId, userId), eq(accountTeam.accountId, accountId)));
  return rows.length > 0;
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
        if (!(await canSeeAccount(db, sub.userId, ev.accountId))) continue;
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
            link: `${copilotUrl}/?user=${encodeURIComponent(sub.userId)}&q=${encodeURIComponent(rule.copilotQuestion)}`,
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
          if (!existing || (existing.status !== 'pending' && existing.status !== 'failed')) continue;
        }
        const critical = (rule.criticalSeverities as string[]).includes(ev.severity);
        const sendNow = (sub.frequency === 'realtime' && !inQuietHours(sub, now)) || (critical && sub.criticalBypass);
        if (sendNow) await send(db, channels, [id], now);
        else await db.update(alertDeliveries).set({ status: 'queued_digest' }).where(eq(alertDeliveries.id, id));
      }
    }
  }
  return created;
}

/** Sends alerts as one message per user, re-checking access for each alert immediately before delivery. */
export async function send(db: Db, channels: Channels, ids: string[], now: Date, digestId?: string) {
  if (ids.length === 0) return;
  const rows = await db.select().from(alertDeliveries).where(inArray(alertDeliveries.id, ids));
  const allowed: typeof rows = [];
  for (const r of rows) {
    if (await canSeeAccount(db, r.userId, r.accountId)) allowed.push(r);
    else await db.update(alertDeliveries).set({ status: 'suppressed_no_access' }).where(eq(alertDeliveries.id, r.id));
  }
  const byUserChannel = new Map<string, typeof rows>();
  for (const r of allowed) {
    const k = `${r.userId}|${r.channel}`;
    byUserChannel.set(k, [...(byUserChannel.get(k) ?? []), r]);
  }
  for (const [k, items] of byUserChannel) {
    const [userId, channel] = k.split('|') as [string, string];
    const ok = await channels.deliver(channel, userId, items, digestId !== undefined);
    await db
      .update(alertDeliveries)
      .set(ok ? { status: 'delivered', deliveredAt: now, digestId: digestId ?? null } : { status: 'failed' })
      .where(inArray(alertDeliveries.id, items.map((i) => i.id)));
  }
}

/** Delivers queued digest alerts for every user who is not in quiet hours. */
export async function flushDigests(db: Db, channels: Channels, now: Date) {
  const queued = await db
    .select({ d: alertDeliveries, s: alertSubscriptions })
    .from(alertDeliveries)
    .innerJoin(alertSubscriptions, and(eq(alertSubscriptions.userId, alertDeliveries.userId), eq(alertSubscriptions.ruleId, alertDeliveries.ruleId)))
    .where(eq(alertDeliveries.status, 'queued_digest'));
  const due = queued.filter((q) => !inQuietHours(q.s, now));
  const byUser = new Map<string, string[]>();
  for (const q of due) byUser.set(q.d.userId, [...(byUser.get(q.d.userId) ?? []), q.d.id]);
  for (const [userId, ids] of byUser) await send(db, channels, ids, now, `digest_${userId}_${now.toISOString().slice(0, 13)}`);
}

/** The in-app inbox: only alerts that were actually delivered. Nothing held, blocked or failed is readable. */
export async function inbox(db: Db, userId: string) {
  const rank: Record<string, number> = { P1: 0, P2: 1, info: 2 };
  const rows = await db
    .select()
    .from(alertDeliveries)
    .where(and(eq(alertDeliveries.userId, userId), eq(alertDeliveries.status, 'delivered')));
  return rows.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.title.localeCompare(b.title));
}

/** Counts per status, without any alert content. */
export async function statusCounts(db: Db, userId: string): Promise<Record<string, number>> {
  const rows = await db.select({ status: alertDeliveries.status }).from(alertDeliveries).where(eq(alertDeliveries.userId, userId));
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}
