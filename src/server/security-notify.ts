// Tells the security team when a question is flagged as an attack, by posting to a Slack channel's incoming
// webhook (SECURITY_SLACK_WEBHOOK_URL). Off when the variable is unset. The message carries the reason codes,
// the outcome, who asked and the audit row's id, never the question text: the audit log keeps only a keyed
// fingerprint of it, and a Slack channel should not hold more than the audit log does.
const SLACK_WEBHOOK = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/;
// One message per person per minute, counted from the last post Slack accepted, so a burst of attempts doesn't
// flood the channel and a failed post doesn't silence the next one. A lock always posts. The memory is per process.
const lastSent = new Map<string, number>();

export interface SecurityEvent {
  auditId: string;
  at: Date;
  userId: string;
  role?: string | null;
  outcome: string;
  flags: string[];
}

export function securityMessage(e: SecurityEvent): string {
  const who = e.role ? `${e.userId} (${e.role})` : e.userId;
  const headline = e.outcome === 'refused_locked' ? 'Copilot session locked after repeated flagged questions' : 'Flagged question on the copilot';
  return [
    `:rotating_light: ${headline}`,
    `Who: ${who}`,
    `Flags: ${e.flags.length ? e.flags.join(', ') : 'none'}`,
    `Outcome: ${e.outcome}`,
    `Audit row: ${e.auditId} at ${e.at.toISOString()}`,
    'The question text is not sent. Find it by this audit row in query_audit.',
  ].join('\n');
}

/** Posts the event if a webhook is configured and this person wasn't reported in the last minute. Never throws. */
export async function notifySecurity(
  e: SecurityEvent,
  env: Record<string, string | undefined> = process.env,
  post: typeof fetch = fetch,
  now = Date.now(),
): Promise<boolean> {
  const url = env.SECURITY_SLACK_WEBHOOK_URL;
  if (!url || !SLACK_WEBHOOK.test(url)) return false;
  const locked = e.outcome === 'refused_locked';
  if (!locked && now - (lastSent.get(e.userId) ?? -Infinity) < 60_000) return false;
  try {
    const res = await post(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: securityMessage(e) }),
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) lastSent.set(e.userId, now);
    return res.ok;
  } catch {
    return false;
  }
}
