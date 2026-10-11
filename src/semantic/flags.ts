// Suspicious-prompt detection (PRD S3). Flags are reason codes written to the audit log as security events.
// They never change what a user can see: scope comes from the database whatever the question says.
const RULES: [code: string, pattern: RegExp][] = [
  ['instruction_override', /\b(ignore|disregard|forget)\b.{0,40}\b(instructions?|rules?|prompt|previous)\b|\bsystem prompt\b|\byou are now\b|\bjailbreak\b|\bdeveloper mode\b/i],
  ['role_claim', /\b(i am|i'm|im)\b.{0,20}\b(ceo|cfo|cto|admin|administrator|analyst|manager|vp|director|owner)\b|\bmy (new )?role is\b|\b(act|pretend) as\b|\b(grant|give) me (access|permission)/i],
  ['sql_or_code', /\b(select\s+.+\s+from|drop\s+table|union\s+select|insert\s+into|delete\s+from|update\s+\w+\s+set)\b|;\s*--|<script/i],
  ['link', /\bhttps?:\/\/|\bwww\.\S+/i],
  ['pressure', /\b(get fired|lose my job|urgent|emergency|i beg|please please|life or death)\b/i],
  ['scope_widening', /\b(all regions|every region|everyone'?s|all teams|whole company|company[- ]wide|other (reps|teams|regions))\b/i],
];

export function flagQuestion(question: string): string[] {
  return RULES.filter(([, re]) => re.test(question)).map(([code]) => code);
}
