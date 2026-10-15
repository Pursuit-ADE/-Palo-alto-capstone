// Suspicious-prompt detection (PRD S3). Flags are reason codes written to the audit log as security events.
// They never change what a user can see: scope comes from the database whatever the question says.
// Patterns target red-team phrasing, so ordinary questions ("urgent", an analyst asking about all regions)
// are not recorded as attacks.
const RULES: [code: string, pattern: RegExp][] = [
  ['instruction_override', /\b(ignore|disregard|forget)\b.{0,40}\b(instructions?|rules?|prompt|previous)\b|\bsystem prompt\b|\byou are now\b|\bjailbreak\b|\bdeveloper mode\b/i],
  ['role_claim', /\b(i am|i'm|im)\b.{0,20}\b(ceo|cfo|cto|admin|administrator|analyst|manager|vp|director|owner)\b|\bmy (new )?role is\b|\b(act|pretend) as\b|\b(grant|give) me (access|permission)/i],
  ['sql_or_code', /\b(select\s+.+\s+from|drop\s+table|union\s+select|insert\s+into|delete\s+from|update\s+\w+\s+set)\b|;\s*--|<script/i],
  ['link', /\bhttps?:\/\/|\bwww\.\S+/i],
  // Pressure in the red-team sense: threats to the asker's job, not words like "urgent".
  ['pressure', /\b(get fired|getting fired|lose my job|losing my job|i beg you|life or death)\b/i],
  // Softer persuasion: claiming others already have access, or asking for an exception. Logged only, so a run
  // of these attempts shows up in the audit log; scope still comes from the database.
  ['social_proof', /\b(everyone|everybody|all of us|the rest of (my|the) team|my (whole )?team|other (reps|sellers))\b.{0,30}\b(can see|can access|has access|have access|already (see|sees|has|have|got))\b/i],
  ['flattery', /\bjust this once\b|\bas a (special )?favou?r\b|\bdo me a favou?r\b|\bbetween (you and me|us)\b|\byou'?re (so|really|the most) (helpful|smart|kind|great)\b|\bno one will know\b/i],
];

const WIDENING = /\b(all regions|every region|everyone'?s|all teams|whole company|company[- ]wide|other (reps|teams|regions))\b/i;

/**
 * Reason codes for a question. "scope_widening" is only raised for someone whose scope is narrower than the
 * whole company, so an analyst asking about all regions is not flagged.
 */
export function flagQuestion(question: string, canSeeEverything = false): string[] {
  const flags = RULES.filter(([, re]) => re.test(question)).map(([code]) => code);
  if (!canSeeEverything && WIDENING.test(question)) flags.push('scope_widening');
  return flags;
}
