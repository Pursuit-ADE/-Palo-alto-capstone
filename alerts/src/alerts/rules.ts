// The alert rule catalog: versioned JSON files in rules/, separate from the metric registry because
// alerts fire on events (cases, engagements), not on analytics metrics. Changes go through pull requests.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const Identifier = z.string().regex(/^[a-z_][a-z0-9_]*$/);
// Each event type fills its own placeholders, so a template can only use values that event provides.
const PLACEHOLDERS = {
  support_case: ['account', 'severity', 'subject', 'when'],
  engagement: ['account', 'contactTitle', 'asset', 'type', 'when'],
  low_usage: ['account', 'product', 'used', 'purchased', 'percent', 'purchasedOn', 'month', 'source'],
} as const;
type Placeholder = (typeof PLACEHOLDERS)[keyof typeof PLACEHOLDERS][number];

const templateFor = (event: keyof typeof PLACEHOLDERS) =>
  z
    .string()
    .min(1)
    .refine((t) => [...t.matchAll(/\{(\w+)\}/g)].every((m) => (PLACEHOLDERS[event] as readonly string[]).includes(m[1]!)), {
      message: `Template uses a placeholder that ${event} events do not provide`,
    });

const Base = z.object({
  id: Identifier,
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().min(1),
  owner: z.string().min(1),
  audience: z.array(z.enum(['technical_seller', 'sales_rep', 'sales_manager'])).min(1),
  criticalSeverities: z.array(z.enum(['P1', 'P2', 'P3', 'P4'])),
});

export const AlertRule = z.discriminatedUnion('event', [
  Base.extend({
    event: z.literal('support_case'),
    title: templateFor('support_case'),
    explain: templateFor('support_case'),
    conditions: z.object({ severityIn: z.array(z.enum(['P1', 'P2', 'P3', 'P4'])).min(1), statusIn: z.array(z.enum(['Open', 'Closed'])).min(1) }).strict(),
  }).strict(),
  Base.extend({
    event: z.literal('engagement'),
    title: templateFor('engagement'),
    explain: templateFor('engagement'),
    conditions: z.object({ cxoOnly: z.boolean(), typeIn: z.array(z.enum(['whitepaper_download', 'campaign_response'])).min(1) }).strict(),
  }).strict(),
  // No conditions of its own: the 20% line and the six months are fixed in db/product-usage.ts, shared with the seed.
  Base.extend({
    event: z.literal('low_usage'),
    title: templateFor('low_usage'),
    explain: templateFor('low_usage'),
    conditions: z.object({}).strict(),
  }).strict(),
]);
export type AlertRule = z.infer<typeof AlertRule>;

export function loadRules(dir: string = path.join(process.cwd(), 'rules')): Map<string, AlertRule> {
  const rules = new Map<string, AlertRule>();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const r = AlertRule.parse(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    if (rules.has(r.id)) throw new Error(`Duplicate rule id ${r.id}`);
    rules.set(r.id, r);
  }
  return rules;
}

/** Fills a template with fixed placeholders only; values are plain text, never evaluated. */
export function render(template: string, values: Partial<Record<Placeholder, string>>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k as keyof typeof values] ?? '');
}
