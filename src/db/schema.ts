// Synthetic CRM-style data model. No real Palo Alto Networks data is ever loaded.
// Every business table carries snapshot_id so each answer can name the data it came from.
import { pgTable, text, numeric, boolean, date, timestamp, primaryKey } from 'drizzle-orm/pg-core';

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

// Mock identities. Roles: technical_seller, account_owner, regional_manager, analyst.
export const appUsers = pgTable('app_users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  role: text('role').notNull(),
  regionId: text('region_id').references(() => regions.id),
});

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  snapshotId: text('snapshot_id').notNull().references(() => dataSnapshots.id),
  name: text('name').notNull(),
  industry: text('industry').notNull(),
  regionId: text('region_id').notNull().references(() => regions.id),
  ownerUserId: text('owner_user_id').notNull().references(() => appUsers.id),
  technicalSellerUserId: text('technical_seller_user_id').references(() => appUsers.id),
});

// Account-access mapping: who may see which account, and in what capacity.
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
  accountId: text('account_id').notNull().references(() => accounts.id),
  regionId: text('region_id').notNull().references(() => regions.id),
  ownerUserId: text('owner_user_id').notNull().references(() => appUsers.id),
  name: text('name').notNull(),
  stage: text('stage').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  closeDate: date('close_date').notNull(),
  isClosed: boolean('is_closed').notNull(),
  isWon: boolean('is_won').notNull(),
});

// Synthetic quotas: needed because pipeline coverage = open pipeline / quota.
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
