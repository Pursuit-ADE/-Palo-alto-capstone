// Runs the golden phrasing set through the configured intent model and reports how many match.
// Deterministic by default; with INTENT_MODEL=claude in .env.local (docs/RUNBOOK.md) it evaluates Claude, which makes
// real API calls. A failed Claude call stops the run.
//   npm run eval:golden
// Claude isn't deterministic, so each phrase runs 10 times with Claude (once otherwise) and the report gives
// pass^k: the share of phrases right on all k runs. RUNS=n overrides the count.
import golden from '../registry/golden/phrases.json';
import { loadRegistry } from '../src/registry/load';
import { goldenMatch, type PhraseRuns, summarize } from '../src/semantic/golden-score';
import { selectModel } from '../src/semantic/model';

const registry = loadRegistry();
const model = selectModel();
const runs = Number(process.env.RUNS) || (model.name === 'deterministic' ? 1 : 10);
const results: PhraseRuns[] = [];
for (const c of golden.cases) {
  const entry: PhraseRuns = { phrase: c.phrase, correct: [], replies: [] };
  for (let run = 0; run < runs; run++) {
    const r = await model.propose(c.phrase, registry, golden.asOfDate);
    entry.correct.push(goldenMatch(c.expect, r, registry));
    entry.replies.push(JSON.stringify(r.kind === 'intent' ? r.intent : r.kind));
  }
  results.push(entry);
}

const s = summarize(results);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`Model: ${model.name}`);
console.log(`Golden set: ${s.phrases} phrases x ${s.runs} run(s)`);
console.log(`  pass^1 (share of runs right): ${pct(s.passRate)}`);
if (s.runs > 1) console.log(`  pass^${s.runs} (phrases right on every run): ${pct(s.passHatK[s.runs]!)}`);
console.log(`  same reply on every run: ${s.stable}/${s.phrases}`);
if (s.runs === 1) console.log(`Golden set: ${s.phrases - s.failing.length}/${s.phrases} match`);
for (const f of s.failing) console.log(`  ✗ "${f.phrase}": right on ${f.correct}/${s.runs} run(s)`);
process.exit(s.failing.length ? 1 : 0);
