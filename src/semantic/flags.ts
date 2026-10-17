// Suspicious-prompt detection (PRD S3). Flags are reason codes written to the audit log as security events.
// Scope comes from the database whatever the question says. A link or an instruction to ignore the rules
// refuses the question. The other flags only record the attempt.
// Patterns target red-team phrasing, so ordinary questions ("urgent", an analyst asking about all regions)
// are not recorded as attacks.
const RULES: [code: string, pattern: RegExp][] = [
  // "Disregard everything above" names no rule, so the second form catches "everything/anything/all ... above".
  ['instruction_override', /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instructions?|rules?|prompt|previous|guardrails?|restrictions?|polic(y|ies))\b|\b(ignore|disregard|forget)\s+(everything|anything|all|what(?:'s| is| was)?)\b.{0,20}\b(above|before|prior|earlier|said|told)\b|\bsystem prompt\b|\byou are now\b|\bjailbreak\b|\bdeveloper mode\b|\bnew instructions\b/i],
  ['role_claim', /\b(i am|i'm|im)\b.{0,20}\b(ceo|cfo|cto|admin|administrator|analyst|manager|vp|director|owner)\b|\bmy (new )?role is\b|\b(act|pretend) as\b|\b(grant|give) me (access|permission)/i],
  ['sql_or_code', /\b(select\s+.+\s+from|drop\s+table|union\s+select|insert\s+into|delete\s+from|update\s+\w+\s+set)\b|;\s*--|<script/i],
  // A scheme, "www.", or a bare domain with a path or a common top-level domain ("evil.example/q3", "evil.com").
  ['link', /\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.\S+|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}\/\S*|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|ai|co|dev|app|xyz|info|biz|example|test|ru|cn|me|ly|gl|link|site|online|top)\b/i],
  // Pressure in the red-team sense: threats to the asker's job, not words like "urgent".
  ['pressure', /\b(get fired|getting fired|lose my job|losing my job|i beg you|life or death)\b/i],
  // Softer persuasion: claiming others already have access, or asking for an exception. Logged only, so a run
  // of these attempts shows up in the audit log; scope still comes from the database.
  ['social_proof', /\b(everyone|everybody|all of us|the rest of (my|the) team|my (whole )?team|other (reps|sellers))\b.{0,30}\b(can see|can access|has access|have access|already (see|sees|has|have|got))\b/i],
  ['flattery', /\bjust this once\b|\bas a (special )?favou?r\b|\bdo me a favou?r\b|\bbetween (you and me|us)\b|\byou'?re (so|really|the most) (helpful|smart|kind|great)\b|\bi(?:'ll| will) owe you\b|\bno one will know\b/i],
];

const WIDENING = /\b(all regions|every region|everyone'?s|all teams|whole company|company[- ]wide|other (reps|teams|regions))\b/i;

// Digits and symbols commonly swapped for letters ("1gnore", "@dmin", "$ystem").
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '|': 'i' };

/**
 * The text the patterns are checked against. Full-width and other look-alike forms are folded to plain letters
 * (NFKC), invisible characters (zero-width spaces and joiners, soft hyphens, direction marks) are removed, and
 * runs of spaces are collapsed. Only used for detection; the question itself is never changed.
 */
export function normalizeForFlags(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\p{Cf}­͏ᅟᅠ឴឵ㅤﾠ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The same text with common digit and symbol swaps turned back into letters, word by word. */
function unLeet(text: string): string {
  // Only inside words that also contain letters, so "FY27-Q1" or "$500k" don't become different words.
  return text.replace(/\S+/g, (w) => (/[a-z]/i.test(w) && /[0-9@$!|]/.test(w) ? w.replace(/[013457@$!|]/g, (c) => LEET[c] ?? c) : w));
}

/**
 * Reason codes for a question. "scope_widening" is only raised for someone whose scope is narrower than the
 * whole company, so an analyst asking about all regions is not flagged.
 */
export function flagQuestion(question: string, canSeeEverything = false): string[] {
  const clean = normalizeForFlags(question);
  const variants = [clean, unLeet(clean)];
  const hit = (re: RegExp) => variants.some((v) => re.test(v));
  const flags = RULES.filter(([code, re]) => (code === 'link' || code === 'sql_or_code' ? re.test(clean) : hit(re))).map(([code]) => code);
  if (!canSeeEverything && hit(WIDENING)) flags.push('scope_widening');
  return flags;
}
