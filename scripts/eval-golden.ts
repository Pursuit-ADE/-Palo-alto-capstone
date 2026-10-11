// Runs the golden phrasing set through the configured intent model and reports how many match.
// Deterministic by default; with INTENT_MODEL=claude it evaluates Claude (this makes real API calls).
//   npm run eval:golden
import golden from '../registry/golden/phrases.json';
import { loadRegistry } from '../src/registry/load';
import { validateIntent } from '../src/semantic/compile';
import { selectModel } from '../src/semantic/model';

const registry = loadRegistry();
const model = selectModel();
let pass = 0;
const failures: string[] = [];
for (const c of golden.cases) {
  const r = await model.propose(c.phrase, registry, golden.asOfDate);
  let ok: boolean;
  if ('clarify' in c.expect) ok = r.kind === 'clarify';
  else if ('unsupported' in c.expect) ok = r.kind === 'unsupported' || r.kind === 'clarify';
  else {
    ok = r.kind === 'intent' && JSON.stringify(validateIntent(r.intent, registry).intent) === JSON.stringify(validateIntent(c.expect, registry).intent);
  }
  if (ok) pass++;
  else failures.push(`  ✗ "${c.phrase}" → ${JSON.stringify(r)}`);
}
console.log(`Model: ${model.name}`);
console.log(`Golden set: ${pass}/${golden.cases.length} match`);
if (failures.length) console.log(failures.join('\n'));
process.exit(failures.length ? 1 : 0);
