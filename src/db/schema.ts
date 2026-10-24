// Data model. Accounts, products, sales agents and opportunities come from the public-domain
// Maven Analytics "CRM Sales Opportunities" sample (a fictional company). Quotas, contacts, support
// cases, engagements and technical sellers are synthetic, because the sample has none.
// Every business table carries snapshot_id so each answer can name the data it came from.
import { pgTable, text, numeric, boolean, date, timestamp, integer, primaryKey, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';

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

// Synthetic monthly product usage for the low-usage alert (plan item 14). Not a governed metric.
// purchased_quantity is what was bought on purchase_date and is repeated on every month, so a rule can
// compare quantity_used with it without a second table. source is 'synthetic': the sample has no usage.
export const productUsage = pgTable('product_usage', {
  id: text('id').primaryKey(),
  snapshotId: text('snapshot_id').notNull().references(() => dataSnapshots.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  productId: text('product_id').notNull().references(() => products.id),
  purchaseDate: date('purchase_date').notNull(),
  purchasedQuantity: integer('purchased_quantity').notNull(),
  usageMonth: date('usage_month').notNull(),
  quantityUsed: integer('quantity_used').notNull(),
  source: text('source').notNull(),
}, (t) => [index('product_usage_account_product').on(t.accountId, t.productId)]);

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

// Demo sign-in (Week 5). An account belongs to one demo person; the person, and so the role, comes from the invite
// code used to create it, never from the form. Passwords are stored as scrypt hashes, session tokens as SHA-256
// hashes. Only the audit login can read or write these tables; the read-only login cannot.
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

export const appSessions = pgTable('app_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  username: text('username').notNull().references(() => appAccounts.username, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [index('app_sessions_expires_at').on(t.expiresAt), index('app_sessions_user_id').on(t.userId)]);

// Rate-limit hits and session-lock expiry. The audit role may read and update only this table.
// The read-only app role may not. PGlite uses the same connection, so the laptop demo still works.
export const sessionGuard = pgTable('session_guard', {
  userId: text('user_id').primaryKey(),
  hits: text('hits').notNull().default('[]'),
  flagged: text('flagged').notNull().default('[]'),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
});

// PRD S4: one row per question or dashboard query, including refusals. Append-only: the app's audit
// role may only INSERT. The raw question is never stored, only its keyed hash (HMAC-SHA-256 with AUDIT_HASH_KEY).
export const queryAudit = pgTable('query_audit', {
  id: text('id').primaryKey(),
  // Defaults to the database clock, so rows written by any app server share one time source.
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  requestId: text('request_id').notNull(),
  source: text('source').notNull(),
  userId: text('user_id').notNull(),
  role: text('role'),
  questionSha256: text('question_sha256'),
  intent: jsonb('intent'),
  metricId: text('metric_id'),
  metricVersion: integer('metric_version'),
  regions: text('regions').array(),
  ownerCount: integer('owner_count'),
  snapshotId: text('snapshot_id'),
  resultHash: text('result_hash'),
  outcome: text('outcome').notNull(),
  reason: text('reason'),
  // S3: reason codes for suspicious questions (e.g. instruction_override, role_claim). Logged, never obeyed.
  flags: text('flags').array(),
  model: text('model'),
  turn: integer('turn'),
  // Which account and session asked, so two accounts of the same demo person can be told apart. The session is
  // the first 16 characters of the stored token hash, never the token.
  username: text('username'),
  sessionId: text('session_id'),
}, (t) => [index('query_audit_at').on(t.at), index('query_audit_user_at').on(t.userId, t.at)]);
