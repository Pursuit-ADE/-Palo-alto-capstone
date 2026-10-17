// Suspicious-prompt detection (PRD S3). Flags are reason codes written to the audit log as security events.
// Scope comes from the database whatever the question says. A link or an instruction to ignore the rules
// refuses the question. The other flags only record the attempt.
// Patterns target red-team phrasing, so ordinary questions ("urgent", an analyst asking about all regions)
// are not recorded as attacks.

// Common and commonly abused top-level domains. English two-letter words (to, by, in, is, it, ...) are left out so
// a missing space after a full stop ("pipeline.by region") isn't read as a link.
const TLDS = 'com|net|org|io|ai|co|dev|app|xyz|info|biz|example|test|ru|cn|me|ly|gl|link|site|online|top|de|uk|fr|nl|eu|ca|au|jp|kr|br|tk|ml|ga|cf|gq|pw|cc|tv|ws|su|sh|gg|zip|mov|club|shop|store|live|icu|cloud|tech|page|vip|work|pro';
// The top-level domain must be all lowercase or all uppercase: "quarter.Top deals" and "N.America/EMEA" are a
// missing space and a region name, not links.
const TLD = `(?:[a-z]{2,}|[A-Z]{2,})`;
const LINK = new RegExp(
  [
    String.raw`\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/`,
    String.raw`\b[wW]{3}\.\S+`,
    String.raw`\b[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.${TLD}\/\S*`,
    String.raw`\b[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.(?:${TLDS}|${TLDS.toUpperCase()})\b`,
  ].join('|'),
);

const RULES: [code: string, pattern: RegExp][] = [
  // "Disregard everything above" names no rule, so the second form catches "everything/anything/all ... above",
  // and the third "disregard the above" at the end of a sentence (not "ignore the above-average deals").
  // "previous" counts unless a time period follows it, so "should I ignore the previous quarter?" is not an attack.
  ['instruction_override', /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instructions?|rules?|prompt|previous(?!\s+(quarters?|years?|months?|weeks?|periods?|fiscal|fy|q[1-4])\b)|guardrails?|restrictions?|polic(y|ies))\b|\b(ignore|disregard|forget)\s+(everything|anything|all|what(?:'s| is| was)?)\b.{0,20}\b(above|before|prior|earlier|said|told)\b|\b(ignore|disregard|forget)\s+(all\s+(of\s+)?)?(the\s+|that\s+|this\s+)?(above|preceding|foregoing)\s*([.!,;:]|$|and\b|then\b|instead\b)|\bsystem prompt\b|\byou are now\b|\bjailbreak\b|\bdeveloper mode\b|\bnew instructions\b/i],
  ['role_claim', /\b(i am|i'm|im)\b.{0,20}\b(ceo|cfo|cto|admin|administrator|analyst|manager|vp|director|owner)\b|\bmy (new )?role is\b|\b(act|pretend) as\b|\b(grant|give) me (access|permission)/i],
  ['sql_or_code', /\b(select\s+.+\s+from|drop\s+table|union\s+select|insert\s+into|delete\s+from|update\s+\w+\s+set)\b|;\s*--|<script/i],
  // A scheme, "www.", or a bare domain with a path or a common top-level domain ("evil.example/q3", "evil.com").
  ['link', LINK],
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

// Cyrillic and Greek letters that look like Latin ones ("іgnore" with a Cyrillic і). NFKC leaves these alone.
const HOMOGLYPHS: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ї: 'i', ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd', ԛ: 'q', ԝ: 'w', ӏ: 'l',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', І: 'I', Ј: 'J', Ѕ: 'S',
  α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', γ: 'y',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  ɡ: 'g', ɩ: 'i', '。': '.', '｡': '.', '︒': '.',
};
const HOMOGLYPH = new RegExp(`[${Object.keys(HOMOGLYPHS).join('')}]`, 'gu');
const INVISIBLE = /[\p{Cf}\u00AD\u034F\u115F\u1160\u17B4\u17B5\u3164\uFFA0]/gu;

function fold(text: string, invisibleAs: '' | ' '): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE, invisibleAs)
    .replace(HOMOGLYPH, (c) => HOMOGLYPHS[c] ?? c)
    // Accents and other combining marks ("iǵnore") are dropped.
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The text the patterns are checked against. Full-width and compatibility forms are folded to plain letters
 * (NFKC), Cyrillic and Greek look-alikes are mapped to Latin, accents are dropped, invisible characters (zero-width
 * spaces and joiners, soft hyphens, direction marks) are removed, and runs of spaces are collapsed. Only used for
 * detection; the question itself is never changed.
 */
export function normalizeForFlags(text: string): string {
  return fold(text, '');
}

/** The same text with common digit and symbol swaps turned back into letters, word by word. */
function unLeet(text: string): string {
  // Only inside words that also contain letters, so "FY27-Q1" or "$500k" don't become different words.
  return text.replace(/\S+/g, (w) => (/[a-z]/i.test(w) && /[0-9@$!|]/.test(w) ? w.replace(/[013457@$!|]/g, (c) => LEET[c] ?? c) : w));
}

/** Letters split apart to dodge word matching put back together: "i g n o r e", "ig-nore", "i.g.n.o.r.e". */
function joinSplitLetters(text: string): string {
  return text
    .replace(/\b[a-z](?:[ ._*-][a-z]\b){2,}/gi, (run) => run.replace(/[ ._*-]/g, ''))
    .replace(/([a-z])[-_*]+(?=[a-z])/gi, '$1');
}

/** "evil . com/x": spaces around a dot between two words, for the link check only. */
function joinSpacedDots(text: string): string {
  return text.replace(/(\w)\s+\.\s+(?=\w)/g, '$1.');
}

/**
 * Reason codes for a question. "scope_widening" is only raised for someone whose scope is narrower than the
 * whole company, so an analyst asking about all regions is not flagged.
 */
export function flagQuestion(question: string, canSeeEverything = false): string[] {
  // Invisible characters are tried both removed ("ig\u200Bnore") and as spaces ("Ignore\u200Ball\u200Bprevious").
  const cleaned = [fold(question, ''), fold(question, ' ')];
  const variants = cleaned.flatMap((c) => [c, unLeet(c), joinSplitLetters(c), joinSplitLetters(unLeet(c))]);
  const linkVariants = cleaned.flatMap((c) => [c, joinSpacedDots(c)]);
  const hit = (re: RegExp, texts = variants) => texts.some((v) => re.test(v));
  const flags = RULES.filter(([code, re]) => (code === 'link' ? hit(re, linkVariants) : code === 'sql_or_code' ? hit(re, cleaned) : hit(re))).map(([code]) => code);
  if (!canSeeEverything && hit(WIDENING)) flags.push('scope_widening');
  return flags;
}
