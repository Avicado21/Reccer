// Small, dependency-free text helpers used by the validators and the claim check.

/** Words that rank or intensify. If one appears in a letter, the recommender must have said it. */
export const COMPARISON_WORDS = [
  "best", "top", "most", "finest", "greatest", "strongest", "brightest", "smartest",
  "exceptional", "outstanding", "extraordinary", "remarkable", "unparalleled", "unmatched",
  "brilliant", "impressive", "superb", "stellar", "elite", "rare", "unique", "unprecedented",
  "incredible", "amazing", "exemplary", "excellent", "phenomenal", "gifted", "talented",
  "better", "stronger", "higher", "first", "only",
];

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

export function comparisonWords(s: string): string[] {
  const w = new Set(words(s));
  return COMPARISON_WORDS.filter((c) => w.has(c));
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
