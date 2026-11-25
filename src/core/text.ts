// Small, dependency-free text helpers used by the validators and the claim check.

/**
 * Words that rank or praise in every use. If one appears in a letter, the recommender must have said it.
 * Words that rank only in some uses (first, only, most, top, higher, better, ...) are in
 * CONTEXTUAL_COMPARISONS below and flag only in a ranking phrase.
 */
export const COMPARISON_WORDS = [
  "best", "finest", "greatest", "strongest", "brightest", "smartest",
  "exceptional", "outstanding", "extraordinary", "remarkable", "unparalleled", "unmatched",
  "brilliant", "impressive", "superb", "stellar", "elite", "rare", "unique", "unprecedented",
  "incredible", "amazing", "exemplary", "excellent", "phenomenal", "gifted", "talented",
  "first-rate", "first-class", "world-class", "top-notch", "top-tier",
];

/** People and cohorts a ranking compares the student against. */
const PEERS =
  "students?|interns?|engineers?|employees?|hires?|candidates?|applicants?|people|persons?|performers?|" +
  "members?|analysts?|researchers?|scientists?|developers?|colleagues?|peers|classmates?|mentees?|" +
  "trainees?|scholars?|staff|class|cohort|group|team|department|section|program|year|batch";
const NUMBERISH = "\\d+%?|one|two|three|four|five|six|seven|eight|nine|ten|twenty|few|handful|percent|tier";
const THAN_WHOM = `(?:any|anyone|anybody|all|every|everyone|most|others|the rest|${PEERS})`;
const GAP = "(?:[a-z'’\\-]+\\s+){0,2}"; // up to two words in between: "the only other intern"

/**
 * Words that rank only in some phrases. Each pattern matches the ranking use, so
 * "the first time", "only two weeks", "most mornings", "top of the page", "higher-priority"
 * and "better tests" do not flag, while "first in her class", "the only intern", "the most
 * capable engineer", "top three", and "better than any intern" do. Plain regexes, no model.
 */
export const CONTEXTUAL_COMPARISONS: Record<string, RegExp[]> = {
  first: [
    /\b(?:ranked|ranks|ranking|placed|places|finished|came|graduated|stood)\s+first\b(?!\s+(?:time|day|week|month|year|project|job|task)\b)/,
    new RegExp(`\\bfirst\\s+(?:in|among|of|out of)\\s+(?:the\\s+|my\\s+|her\\s+|his\\s+|their\\s+|our\\s+|all\\s+)?${GAP}(?:${PEERS})\\b`),
  ],
  only: [
    new RegExp(`\\b(?:the|my|our)\\s+only\\s+${GAP}(?:${PEERS}|person|one)\\b`),
    new RegExp(`\\bonly\\s+(?:${PEERS}|person|one)\\s+(?:who|that|to|i|in|on|ever)\\b`),
  ],
  most: [
    new RegExp(`\\bmost\\s+[a-z'’\\-]+\\s+${GAP}(?:${PEERS}|person)\\b`),
    /\bmost\s+[a-z'’\-]+\s+(?:[a-z'’\-]+\s+){0,3}(?:i(?:'ve| have)?\s+ever|ever)\b/,
  ],
  top: [
    new RegExp(`\\btop\\s+(?:${NUMBERISH})\\b`),
    new RegExp(`\\btop\\s+(?:${PEERS}|person|performer|talent)\\b`),
    new RegExp(`\\b(?:at|near)\\s+the\\s+top\\s+of\\s+(?:the\\s+|my\\s+|her\\s+|his\\s+|their\\s+|our\\s+|all\\s+)?${GAP}(?:${PEERS}|list|rankings?)\\b`),
  ],
  higher: [new RegExp(`\\b(?:higher|ranked higher|rated higher)\\s+than\\s+${GAP}${THAN_WHOM}\\b`)],
  better: [new RegExp(`\\bbetter\\s+than\\s+${GAP}${THAN_WHOM}\\b`)],
  stronger: [new RegExp(`\\bstronger\\s+than\\s+${GAP}${THAN_WHOM}\\b`)],
};

export const STOPWORDS = new Set(
  ("a an and are as at be been but by for from had has have he her his i if in into is it its " +
    "me my of on or our she so that the their them they this to was we were what when which who " +
    "will with you your also very really just about there than then because would could should " +
    "can did does do not no yes all any some more one two also being over after before").split(" "),
);

const FILLERS = [
  // ", you know, " mid-sentence: keep one comma if a new clause follows, else close the gap.
  /,\s*(you know|i mean|like|um+|uh+)\s*,\s*(?=(i|i'm|we|they|he|she|it|there|so|and|but)\b)/gi,
  /,\s*(you know|i mean|like|um+|uh+)\s*,\s*/gi,

  /\b(um+|uh+|erm|hmm+)\b[,.]?\s*/gi,
  /\byou know,?\s*/gi,
  /\bi mean,?\s*/gi,
  /\b(sort of|kind of)\s+(?=\w)/gi,
  /\blike,\s*/gi,
];

export function stripFiller(s: string): string {
  let out = s;
  FILLERS.forEach((re, i) => {
    out = out.replace(re, i === 0 ? ", " : i === 1 ? " " : "");
  });
  out = out.replace(/\b(\w+)\s+\1\b/gi, "$1"); // "the the"
  out = out.replace(/\s+([,.!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  if (out && !/[.!?]$/.test(out)) out += ".";
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function words(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9][a-z0-9'’\-]*/g) ?? [];
}

/** Numbers normalized: "3,000" -> "3000", "0.717" stays, "50%" -> "50". Word numbers too. */
const WORD_NUMS: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8",
  nine: "9", ten: "10", eleven: "11", twelve: "12", twenty: "20", thirty: "30", forty: "40",
  fifty: "50", hundred: "100", dozen: "12",
};
export function numbers(s: string): string[] {
  const digits = (s.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "").replace(/^0+(?=\d)/, ""));
  const spelled = words(s).filter((w) => w in WORD_NUMS).map((w) => WORD_NUMS[w]);
  return [...digits, ...spelled];
}

/** Capitalized tokens that are not sentence-initial. Rough proper-noun detector. */
export function properNouns(s: string): string[] {
  const out: string[] = [];
  const sentences = s.split(/(?<=[.!?])\s+/);
  for (const sent of sentences) {
    const toks = sent.match(/[A-Za-z][A-Za-z'’\-]*/g) ?? [];
    toks.forEach((t, i) => {
      if (i === 0) return;
      if (t === "I") return;
      if (/^[A-Z]/.test(t)) out.push(t);
    });
  }
  return out;
}

/** Ranking or praise words used in a ranking sense, in a stable order. */
export function comparisonWords(s: string): string[] {
  const w = new Set(words(s));
  const lower = s.toLowerCase().replace(/\s+/g, " ");
  return [
    ...COMPARISON_WORDS.filter((c) => w.has(c)),
    ...Object.keys(CONTEXTUAL_COMPARISONS).filter((c) => CONTEXTUAL_COMPARISONS[c].some((re) => re.test(lower))),
  ];
}

export function contentWords(s: string): string[] {
  return words(s).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/** Loose stem so "presented" matches "presenting", "teams" matches "team". */
export function stem(w: string): string {
  return w.replace(/(ing|ed|es|s|ly)$/, "");
}

export function countWords(s: string): number {
  return (s.match(/\S+/g) ?? []).length;
}
