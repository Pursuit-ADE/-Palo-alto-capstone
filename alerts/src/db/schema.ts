// Data model shared with the copilot (same public CRM sample and synthetic event tables), plus alert tables.
// Maven Analytics "CRM Sales Opportunities" sample (a fictional company). Quotas, contacts, support
// cases, engagements and technical sellers are synthetic, because the sample has none.
// Every business table carries snapshot_id so each answer can name the data it came from.
import { pgTable, text, numeric, boolean, date, timestamp, integer, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';

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

// L3: each user subscribes to the rules they want and picks frequency, quiet hours and channel.
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
  },
  (t) => [uniqueIndex('alert_dedupe').on(t.ruleId, t.userId, t.eventId)],
);
