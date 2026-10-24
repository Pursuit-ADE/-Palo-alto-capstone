// Data model shared with the copilot (same public CRM sample and synthetic event tables), plus alert tables.
// Maven Analytics "CRM Sales Opportunities" sample (a fictional company). Quotas, contacts, support
// cases, engagements and technical sellers are synthetic, because the sample has none.
// Every business table carries snapshot_id so each answer can name the data it came from.
import { pgTable, text, numeric, boolean, date, timestamp, integer, primaryKey, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const dataSnapshots = pgTable('data_snapshots', {
  id: text('id').primaryKey(),
  seed: text('seed').notNull(),
  asOfDate: date('as_of_date').notNull(),
  loadedAt: timestamp('loaded_at', { withTimezone: true }).notNull(),
  notes: text('notes'),
});

export const regions = pgTable('regions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});

// Roles: sales_rep, sales_manager, technical_seller, analyst. manager_id links a rep (or the
// technical seller supporting that team) to their sales manager.
export const appUsers = pgTable('app_users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  role: text('role').notNull(),
  regionId: text('region_id').references(() => regions.id),
  managerId: text('manager_id'),
  source: text('source').notNull(),
});

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  snapshotId: text('snapshot_id').notNull().references(() => dataSnapshots.id),
  name: text('name').notNull(),
  sector: text('sector').notNull(),
  yearEstablished: integer('year_established'),
  revenueMusd: numeric('revenue_musd', { precision: 12, scale: 2 }),
  employees: integer('employees'),
  hqCountry: text('hq_country'),
  parentAccount: text('parent_account'),
});

// Account-access mapping: who works on which account (agents who sold to it, and their team's technical seller).
export const accountTeam = pgTable(
  'account_team',
  {
    accountId: text('account_id').notNull().references(() => accounts.id),
    userId: text('user_id').notNull().references(() => appUsers.id),
    teamRole: text('team_role').notNull(),
    snapshotId: text('snapshot_id').notNull().references(() => dataSnapshots.id),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.userId] })],
);

export const products = pgTable('products', {
  id: text('id').primaryKey(),
  series: text('series').notNull(),
  listPrice: numeric('list_price', { precision: 12, scale: 2 }).notNull(),
});

export const contacts = pgTable('contacts', {
  id: text('id').primaryKey(),
  snapshotId: text('snapshot_id').notNull().references(() => dataSnapshots.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  fullName: text('full_name').notNull(),
  title: text('title').notNull(),
  isCxo: boolean('is_cxo').notNull(),
});

export const opportunities = pgTable('opportunities', {
  id: text('id').primaryKey(),
  snapshotId: text('snapshot_id').notNull().references(() => dataSnapshots.id),
  accountId: text('account_id').references(() => accounts.id),
  regionId: text('region_id').notNull().references(() => regions.id),
  ownerUserId: text('owner_user_id').notNull().references(() => appUsers.id),
  productId: text('product_id').notNull().references(() => products.id),
  stage: text('stage').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  amountIsEstimate: boolean('amount_is_estimate').notNull(),
  engageDate: date('engage_date'),
  closeDate: date('close_date').notNull(),
  closeDateIsEstimate: boolean('close_date_is_estimate').notNull(),
  isClosed: boolean('is_closed').notNull(),
  isWon: boolean('is_won').notNull(),
});

// Synthetic quotas per sales rep and fiscal quarter: pipeline coverage = open pipeline / quota.
export const quotas = pgTable('quotas', {
  id: text('id').primaryKey(),
  snapshotId: text('snapshot_id').notNull().references(() => dataSnapshots.id),
  userId: text('user_id').notNull().references(() => appUsers.id),
  regionId: text('region_id').notNull().references(() => regions.id),
  period: text('period').notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
});

// Event tables for alerts (Week 4). Events, not analytics metrics.
export const supportCases = pgTable('support_cases', {
  id: text('id').primaryKey(),
  snapshotId: text('snapshot_id').notNull().references(() => dataSnapshots.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  severity: text('severity').notNull(),
  status: text('status').notNull(),
  subject: text('subject').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
});

export const engagements = pgTable('engagements', {
  id: text('id').primaryKey(),
  snapshotId: text('snapshot_id').notNull().references(() => dataSnapshots.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  contactId: text('contact_id').notNull().references(() => contacts.id),
  type: text('type').notNull(),
  asset: text('asset').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
});

// ---- Alerts (PRD Part 2) ----

// L3: each user subscribes to the rules they want and picks frequency (realtime, daily, weekly, monthly),
// quiet hours and channel.
// Quiet hours are whole hours in UTC; start > end means the window crosses midnight.
export const alertSubscriptions = pgTable(
  'alert_subscriptions',
  {
    userId: text('user_id').notNull().references(() => appUsers.id),
    ruleId: text('rule_id').notNull(),
    frequency: text('frequency').notNull(),
    channel: text('channel').notNull(),
    quietStartHour: integer('quiet_start_hour'),
    quietEndHour: integer('quiet_end_hour'),
    criticalBypass: boolean('critical_bypass').notNull(),
    // When this subscription last received a digest; the next one is due in the following daily, weekly or
    // monthly slot (see digestDue in src/alerts/schedule.ts).
    lastDigestAt: timestamp('last_digest_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.ruleId] })],
);

// Every alert the engine created for one user, and what happened to it. The unique key is the dedupe guarantee.
export const alertDeliveries = pgTable(
  'alert_deliveries',
  {
    id: text('id').primaryKey(),
    ruleId: text('rule_id').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    userId: text('user_id').notNull().references(() => appUsers.id),
    eventId: text('event_id').notNull(),
    accountId: text('account_id').notNull().references(() => accounts.id),
    severity: text('severity').notNull(),
    title: text('title').notNull(),
    explanation: text('explanation').notNull(),
    link: text('link').notNull(),
    status: text('status').notNull(),
    channel: text('channel').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    digestId: text('digest_id'),
    // Set when a sender claims the alert (status 'sending'), so two senders never deliver the same alert,
    // and a send cut off by a crash can be reclaimed once the claim is stale.
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimToken: text('claim_token'),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [uniqueIndex('alert_dedupe').on(t.ruleId, t.userId, t.eventId), index('alert_deliveries_user_status').on(t.userId, t.status)],
);

// How far the scheduler has evaluated events, so each run only looks at new events and a restart resumes.
export const alertCursor = pgTable('alert_cursor', {
  id: text('id').primaryKey(),
  evaluatedUntil: timestamp('evaluated_until', { withTimezone: true }).notNull(),
});

// Demo sign-in (Week 5). An account belongs to one demo person; the person, and so the role, comes from the invite
// code used to create it, never from the form. Passwords are stored as scrypt hashes, session tokens as SHA-256
// hashes. Shared invite codes with the copilot (same DEMO_INVITE_SECRET); separate accounts and sessions.
export const appAccounts = pgTable('app_accounts', {
  username: text('username').primaryKey(),
  userId: text('user_id').notNull().references(() => appUsers.id),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  // Set by `npm run accounts -- disable <username>`. A disabled account can't log in and its sessions stop working.
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
}, (t) => [
  // One account per demo person in each app: an invite code can be used once, so a leaked code can't mint more accounts.
  uniqueIndex('app_accounts_user_id_unique').on(t.userId),
]);

// Sign-in attempts in the last minute, for the brute-force limits (per username and per address). Shared by every
// process on the same database; rows older than a minute are deleted as new attempts arrive.
export const loginAttempts = pgTable('login_attempts', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull(),
}, (t) => [index('login_attempts_key_at').on(t.key, t.at)]);

export const appSessions = pgTable('app_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  username: text('username').notNull().references(() => appAccounts.username, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [index('app_sessions_expires_at').on(t.expiresAt), index('app_sessions_user_id').on(t.userId)]);
