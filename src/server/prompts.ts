// Questions the alerts app can open the copilot with. An alert links to /?prompt=<rule id>&account=<account id>; the
// copilot looks the rule id up here and the account name up in its own accounts table, so a link can only ever pre-fill
// one of these fixed questions, never arbitrary text.
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts } from '../db/schema';

export const ALERT_PROMPTS: Record<string, string> = {
  high_severity_case: 'What is our open pipeline?',
  cxo_engagement: 'how many open deals?',
  // The copilot has no usage metric, so this opens the account team's open pipeline, as for a support case.
  low_usage: 'What is our open pipeline?',
};

// The same questions about the alert's own account, so the link is about this alert (UX review Nov 2, BH r2 3). The
// answer is still scoped to the asker. "account" is said outright: without it the reader asks back about "Gekko & Co",
// one of the 85 names (tests/alert-prompts.test.ts asks every rule about every account).
const ACCOUNT_PROMPTS: Record<string, (account: string) => string> = {
  high_severity_case: (a) => `open pipeline for account ${a}`,
  cxo_engagement: (a) => `open opportunities for account ${a}`,
  low_usage: (a) => `open pipeline for account ${a}`,
};

export function promptFor(id: string | undefined): string {
  return id && Object.hasOwn(ALERT_PROMPTS, id) ? ALERT_PROMPTS[id]! : '';
}

/** An account id as both apps build it: "acc_" and the name in lower case, with runs of other characters as "_". */
export function isAlertAccount(id: unknown): id is string {
  return typeof id === 'string' && /^acc_[a-z0-9_]{1,80}$/.test(id);
}

/**
 * The query string that carries an alert's question through sign-in, e.g. "?prompt=cxo_engagement&account=acc_acme",
 * or "" when the prompt isn't a known rule id. An account that fails isAlertAccount is dropped, so nothing else passes.
 */
export function alertQuery(params: { prompt?: string; account?: string }): string {
  if (!promptFor(params.prompt)) return '';
  const q = new URLSearchParams({ prompt: params.prompt! });
  if (isAlertAccount(params.account)) q.set('account', params.account);
  return `?${q}`;
}

/** The question to pre-fill: about the account when it exists, otherwise the rule's own question. */
export async function alertQuestion(db: Db, prompt: string | undefined, account: string | undefined): Promise<string> {
  const plain = promptFor(prompt);
  if (!plain || !isAlertAccount(account)) return plain;
  const [row] = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, account)).limit(1);
  return row ? ACCOUNT_PROMPTS[prompt!]!(row.name) : plain;
}
