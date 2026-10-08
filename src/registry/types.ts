import { z } from 'zod';

export const DIMENSIONS = ['region', 'stage', 'owner'] as const;
export const Dimension = z.enum(DIMENSIONS);
export type Dimension = z.infer<typeof Dimension>;

// Only these tables and columns can ever appear in compiled SQL.
export const ALLOWED_COLUMNS = {
  opportunities: ['amount', 'is_closed', 'close_date', 'stage', 'region_id', 'owner_user_id', 'account_id', 'snapshot_id'],
  quotas: ['amount', 'period', 'region_id', 'snapshot_id'],
} as const;
export type AllowedTable = keyof typeof ALLOWED_COLUMNS;

const Identifier = z.string().regex(/^[a-z_][a-z0-9_]*$/);

export const Source = z.object({
  table: z.enum(['opportunities', 'quotas']),
  measure: z.union([
    z.object({ fn: z.literal('sum'), column: Identifier }),
    z.object({ fn: z.literal('count') }),
  ]),
  conditions: z.array(z.object({ column: Identifier, equals: z.union([z.boolean(), z.string(), z.number()]) })),
  periodColumn: Identifier,
});
export type Source = z.infer<typeof Source>;

const Base = z.object({
  id: Identifier,
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().min(1),
  owner: z.string().min(1),
  unit: z.enum(['currency', 'count', 'ratio']),
  synonyms: z.array(z.string().min(2)).min(3),
  dimensions: z.array(Dimension),
  notes: z.string().optional(),
});

export const AggregateMetric = Base.extend({ kind: z.literal('aggregate'), source: Source });
export const RatioMetric = Base.extend({
  kind: z.literal('ratio'),
  numerator: Identifier,
  denominator: Source,
  requiresPeriod: z.boolean().default(false),
});
export const MetricDefinition = z.discriminatedUnion('kind', [AggregateMetric, RatioMetric]);
export type MetricDefinition = z.infer<typeof MetricDefinition>;
export type AggregateMetric = z.infer<typeof AggregateMetric>;
export type RatioMetric = z.infer<typeof RatioMetric>;

export const Dictionary = z.object({
  version: z.number(),
  tables: z.record(z.string(), z.object({ description: z.string(), fields: z.record(z.string(), z.string()) })),
});
export type Dictionary = z.infer<typeof Dictionary>;

export const Glossary = z.object({
  version: z.number(),
  terms: z.array(z.object({ term: z.string(), definition: z.string() })),
  periodPhrases: z.record(z.string(), z.string()),
  dimensionPhrases: z.record(z.string(), Dimension),
  ambiguousTerms: z.record(z.string(), z.string()),
});
export type Glossary = z.infer<typeof Glossary>;

// The structured intent: the only thing the AI is allowed to produce. It never contains SQL or math.
export const Intent = z
  .object({
    metric: Identifier,
    filters: z
      .object({
        regions: z.array(z.enum(['east', 'west'])).min(1).optional(),
        stages: z.array(z.string().max(40)).min(1).optional(),
        period: z.string().regex(/^FY\d{2}-Q[1-4]$/).optional(),
      })
      .strict(),
    groupBy: z.array(Dimension).max(2).default([]),
  })
  .strict();
export type Intent = z.infer<typeof Intent>;
