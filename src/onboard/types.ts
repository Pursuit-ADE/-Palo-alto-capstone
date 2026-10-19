import { z } from 'zod';

// Every column the seed loader reads. Optional values may be blank, but the column must exist.
export const REQUIRED_CRM_FILES = {
  accounts: ['account', 'sector', 'year_established', 'revenue', 'employees', 'office_location', 'subsidiary_of'],
  products: ['product', 'series', 'sales_price'],
  sales_teams: ['sales_agent', 'manager', 'regional_office'],
  sales_pipeline: ['opportunity_id', 'sales_agent', 'product', 'account', 'deal_stage', 'engage_date', 'close_date', 'close_value'],
} as const;

export const GOVERNED_METRIC_IDS = ['open_pipeline', 'pipeline_coverage', 'open_opportunity_count'] as const;

export const FileProfile = z.object({
  file: z.string(),
  rows: z.number().int().nonnegative(),
  columns: z.array(z.string()),
});
export type FileProfile = z.infer<typeof FileProfile>;

export const DatasetProfile = z.object({
  datasetDir: z.string(),
  files: z.array(FileProfile),
  missingFiles: z.array(z.string()),
  missingColumns: z.record(z.string(), z.array(z.string())),
  /** Value problems the loader would fail on: blanks, bad numbers or dates, broken references, missing regions. */
  problems: z.array(z.string()).default([]),
  mavenShaped: z.boolean(),
});
export type DatasetProfile = z.infer<typeof DatasetProfile>;

export const ProposedMetric = z.object({
  id: z.string(),
  reason: z.string(),
});
export type ProposedMetric = z.infer<typeof ProposedMetric>;

export const OnboardProposal = z.object({
  status: z.literal('pending'),
  profile: DatasetProfile,
  proposedMetrics: z.array(ProposedMetric),
  blockers: z.array(z.string()),
});
export type OnboardProposal = z.infer<typeof OnboardProposal>;

export const OnboardConfirmation = z.object({
  status: z.literal('confirmed'),
  datasetDir: z.string(),
  seed: z.string().min(1),
  confirmedMetricIds: z.array(z.string()).min(1),
  confirmedBy: z.string().min(1),
  confirmedAt: z.string(),
  notes: z.string().optional(),
});
export type OnboardConfirmation = z.infer<typeof OnboardConfirmation>;
