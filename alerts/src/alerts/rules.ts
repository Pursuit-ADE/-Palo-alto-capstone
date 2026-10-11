// The alert rule catalog: versioned JSON files in rules/, separate from the metric registry because
// alerts fire on events (cases, engagements), not on analytics metrics. Changes go through pull requests.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const Identifier = z.string().regex(/^[a-z_][a-z0-9_]*$/);
const PLACEHOLDERS = ['account', 'severity', 'subject', 'when', 'contactTitle', 'asset', 'type'] as const;
const Template = z
  .string()
  .min(1)
  .refine((t) => [...t.matchAll(/\{(\w+)\}/g)].every((m) => (PLACEHOLDERS as readonly string[]).includes(m[1]!)), 'Unknown placeholder in template');

const Base = z.object({
  id: Identifier,
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().min(1),
  owner: z.string().min(1),
  audience: z.array(z.enum(['technical_seller', 'sales_rep', 'sales_manager'])).min(1),
  criticalSeverities: z.array(z.enum(['P1', 'P2', 'P3', 'P4'])),
  title: Template,
  explain: Template,
  copilotQuestion: z.string().min(1).max(120),
});

export const AlertRule = z.discriminatedUnion('event', [
  Base.extend({
    event: z.literal('support_case'),
    conditions: z.object({ severityIn: z.array(z.enum(['P1', 'P2', 'P3', 'P4'])).min(1), statusIn: z.array(z.string()).min(1) }).strict(),
  }).strict(),
  Base.extend({
    event: z.literal('engagement'),
    conditions: z.object({ cxoOnly: z.boolean(), typeIn: z.array(z.enum(['whitepaper_download', 'campaign_response'])).min(1) }).strict(),
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
export function render(template: string, values: Partial<Record<(typeof PLACEHOLDERS)[number], string>>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k as keyof typeof values] ?? '');
}
