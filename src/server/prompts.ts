// Questions the alerts app can open the copilot with. An alert links to /?prompt=<rule id>; the copilot looks
// the id up here, so a link can only ever pre-fill one of these fixed questions, never arbitrary text.
export const ALERT_PROMPTS: Record<string, string> = {
  high_severity_case: 'What is our open pipeline?',
  cxo_engagement: 'how many open deals?',
};

export function promptFor(id: string | undefined): string {
  return id && Object.hasOwn(ALERT_PROMPTS, id) ? ALERT_PROMPTS[id]! : '';
}
