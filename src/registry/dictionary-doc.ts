// Renders docs/DATA-DICTIONARY.md from the registry, so the handover page can't drift from the definitions the
// app uses. Run `npm run docs:dictionary` after changing registry/; a test fails if the page is out of date.
import type { Registry } from './load';

export function dictionaryMarkdown(reg: Registry): string {
  const out: string[] = [];
  out.push('# Data dictionary');
  out.push('');
  out.push('Generated from `registry/` by `npm run docs:dictionary`. Do not edit by hand: change the registry and run the command.');
  out.push('');
  out.push('## Governed metrics');
  out.push('');
  out.push('| Metric | Definition | Breakdowns | Version | Owner |');
  out.push('|---|---|---|---|---|');
  for (const m of [...reg.metrics.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    out.push(`| ${m.name} (\`${m.id}\`) | ${m.description} | ${m.dimensions.join(', ')} | v${m.version} | ${m.owner} |`);
  }
  out.push('');
  out.push('## Business rules');
  out.push('');
  out.push('| Rule | What it means | Applied in |');
  out.push('|---|---|---|');
  for (const r of reg.glossary.businessRules) out.push(`| ${r.id} | ${r.rule} | \`${r.appliesIn}\` |`);
  out.push('');
  out.push('## Glossary');
  out.push('');
  for (const t of reg.glossary.terms) out.push(`- **${t.term}:** ${t.definition}`);
  out.push('');
  out.push('## Tables');
  for (const [table, def] of Object.entries(reg.dictionary.tables).sort(([a], [b]) => a.localeCompare(b))) {
    out.push('');
    out.push(`### \`${table}\``);
    out.push('');
    out.push(def.description);
    out.push('');
    out.push('| Field | Meaning |');
    out.push('|---|---|');
    for (const [field, meaning] of Object.entries(def.fields)) out.push(`| \`${field}\` | ${meaning} |`);
  }
  out.push('');
  return out.join('\n');
}
