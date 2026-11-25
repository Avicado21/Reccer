// The claim check enforces "AI assisted, not AI generated" in code, not in a prompt.
// For every sentence, anything risky (numbers, names, ranking/praise words) must appear in
// the answers that sentence cites. It also flags heavy rewrites and answers the draft never used.
// This is plain string logic, deliberately not another LLM call.

import type { AssembledSentence, Answers, Assembly, Flag, Question, StudentIntake } from "./types";
import { comparisonWords, contentWords, numbers, properNouns, stem } from "./text";

export const HEAVY_REWRITE_THRESHOLD = 0.4;

function sourceText(ids: string[], answers: Answers): string {
  return ids
    .map((id) => answers[id])
    .filter((a): a is { text: string; followUp?: string } => !!a && a !== "SKIPPED")
    .map((a) => `${a.text} ${a.followUp ?? ""}`)
    .join(" ");
}

/** Words Reccer itself is allowed to introduce: names, schools, programs, and the template line. */
function allowedVocab(intake: StudentIntake): Set<string> {
  const v = new Set<string>();
  const add = (s?: string) => (s ?? "").toLowerCase().split(/[^a-z0-9'’\-]+/).filter(Boolean).forEach((t) => v.add(t));
  add(intake.studentName);
  add(intake.preferredName);
  intake.programs.forEach((p) => { add(p.school); add(p.name); });
  add("recommend recommending master science program admissions committee");
  return v;
}

type Where = Pick<Flag, "sentenceId" | "paragraph" | "sentence">;
interface Ctx { ids: Set<string>; allowed: Set<string>; answers: Answers }

const contextOf = (intake: StudentIntake, questions: Question[], answers: Answers): Ctx => ({
  ids: new Set([...questions.map((q) => q.id), "TEMPLATE"]),
  allowed: allowedVocab(intake),
  answers,
});

/**
 * The per-sentence rules. `edited` means the recommender wrote `text` themselves: the same
 * rules run, but heavy-rewrite is skipped (rewriting is the point) and the wording is addressed
 * to them as an advisory note.
 */
function checkSentence(ctx: Ctx, at: Where, sources: string[], text: string, edited: boolean): Flag[] {
  const flags: Flag[] = [];
  const push = (f: Omit<Flag, keyof Where>) => flags.push({ ...at, ...f, ...(edited ? { advisory: true } : {}) });

  const unknown = sources.filter((id) => !ctx.ids.has(id));
  if (!edited && (!sources.length || unknown.length)) {
    push({ kind: "unknown-source", message: sources.length ? `cites unknown question ${unknown.join(", ")}` : "cites no question" });
  }

  const src = sourceText(sources, ctx.answers);
  const srcLower = src.toLowerCase();
  const srcNums = new Set(numbers(src));
  const srcRanks = new Set(comparisonWords(src));
  const yours = edited ? "your edit adds" : "";

  for (const n of new Set(numbers(text))) {
    if (!srcNums.has(n)) {
      push({ kind: "number", token: n, message: edited ? `${yours} the number "${n}", which is not in your original answer; keep it if it is right` : `number "${n}" is not in the cited answer` });
    }
  }
  for (const t of new Set(properNouns(text))) {
    const lower = t.toLowerCase();
    if (!srcLower.includes(lower) && !ctx.allowed.has(lower)) {
      push({ kind: "proper-noun", token: t, message: edited ? `${yours} "${t}", which is not in your original answer; check the spelling and that you meant it` : `"${t}" is not in the cited answer` });
    }
  }
  for (const c of comparisonWords(text)) {
    if (!srcRanks.has(c)) {
      push({ kind: "comparison", token: c, message: edited ? `${yours} "${c}", a ranking or praise word you did not use in the interview; keep it only if you mean it` : `"${c}" ranks or praises, and the recommender did not say it` });
    }
  }
  if (!edited) {
    const srcWords = new Set(contentWords(src).map(stem));
    const cw = contentWords(text).filter((w) => !ctx.allowed.has(w));
    if (cw.length >= 5) {
      const novel = cw.filter((w) => !srcWords.has(stem(w)));
      const ratio = novel.length / cw.length;
      if (ratio > HEAVY_REWRITE_THRESHOLD) {
        push({ kind: "heavy-rewrite", message: `${Math.round(ratio * 100)}% of the wording is new; compare with the original answer` });
      }
    }
  }
  return flags;
}

export function claimCheck(intake: StudentIntake, questions: Question[], answers: Answers, assembly: Assembly): Flag[] {
  const ctx = contextOf(intake, questions, answers);
  const flags: Flag[] = [];
  const used = new Set<string>();

  assembly.paragraphs.forEach((p, pi) => {
    p.sentences.forEach((s, si) => {
      if (s.sources.includes("TEMPLATE")) return;
      s.sources.forEach((id) => used.add(id));
      flags.push(...checkSentence(ctx, { sentenceId: s.id, paragraph: pi, sentence: si }, s.sources, s.text, false));
    });
  });

  for (const q of questions) {
    if (q.destination === "form") continue;
    const a = answers[q.id];
    if (a && a !== "SKIPPED" && !used.has(q.id) && assembly.mode === "llm") {
      flags.push({ sentenceId: null, paragraph: null, sentence: null, kind: "unused-answer", questionId: q.id, message: `the answer to ${q.id} is not in the draft (cut for length?)` });
    }
  }
  return flags;
}

/**
 * Re-runs the claim check on a sentence the recommender edited, against the answers the original
 * sentence cited. Every result is advisory: the recommender's own words stand either way.
 */
export function adviseOnEdit(
  intake: StudentIntake, questions: Question[], answers: Answers,
  original: AssembledSentence, at: { paragraph: number; sentence: number }, editedText: string,
): Flag[] {
  return checkSentence(contextOf(intake, questions, answers), { sentenceId: original.id, ...at }, original.sources, editedText, true);
}
