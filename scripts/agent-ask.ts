// Asks one question through the governed tool agent (preview, off by default; docs/AGENT-DESIGN.md). Not part of the
// app: the copilot's ask box still uses the one-step reader. Makes real Claude calls (ANTHROPIC_API_KEY, read from
// .env.local if there is one). Uses the embedded demo database unless DATABASE_URL and the other logins are set.
//   npm run agent:ask -- --user u_analyst "compare pipeline coverage in East and West this quarter"
import Anthropic from '@anthropic-ai/sdk';
import { openDatabase } from '../src/db/client';
import { loadRegistry } from '../src/registry/load';
import { runGovernedAgent } from '../src/agent/governed-agent';

const args = process.argv.slice(2);
const at = args.indexOf('--user');
const userId = at >= 0 ? args[at + 1] : undefined;
const question = args.filter((_, i) => i !== at && i !== at + 1).join(' ').trim();
if (!userId || !question) {
  console.error('Usage: npm run agent:ask -- --user <demo user id> "<question>"');
  process.exit(2);
}

const database = await openDatabase();
try {
  const reply = await runGovernedAgent(database, loadRegistry(), userId, question, { client: new Anthropic({ timeout: 30_000, maxRetries: 0 }) });
  for (const [i, s] of reply.steps.entries()) console.log(`${i + 1}. [${s.tool}] ${s.label}\n   ${s.answer ? s.answer.narrative : `Not answered: ${s.refused}`}`);
  if (reply.comparison) console.log(`\n${reply.comparison}`);
  if (reply.clarify) console.log(`\nAsked: ${reply.clarify}`);
  console.log(`\nStopped: ${reply.stopped} (${reply.steps.length} governed quer${reply.steps.length === 1 ? 'y' : 'ies'}, each scoped and audited)`);
} catch (e) {
  console.error(`Refused: ${e instanceof Error ? e.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  await database.close();
}
