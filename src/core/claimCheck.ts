// The claim check enforces "AI assisted, not AI generated" in code, not in a prompt.
// For every sentence, anything risky (numbers, names, ranking/praise words) must appear in
// the answers that sentence cites. It also flags heavy rewrites and answers the draft never used.
// This is plain string logic, deliberately not another LLM call.

import type { Answers, Assembly, Flag, Question, StudentIntake } from "./types";
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

export function claimCheck(intake: StudentIntake, questions: Question[], answers: Answers, assembly: Assembly): Flag[] {
  const flags: Flag[] = [];
  const ids = new Set([...questions.map((q) => q.id), "TEMPLATE"]);
  const allowed = allowedVocab(intake);
  const used = new Set<string>();

  assembly.paragraphs.forEach((p, pi) => {
    p.sentences.forEach((s, si) => {
      const at = { paragraph: pi, sentence: si };
      if (s.sources.includes("TEMPLATE")) return;
      s.sources.forEach((id) => used.add(id));

      const unknown = s.sources.filter((id) => !ids.has(id));
      if (!s.sources.length || unknown.length) {
        flags.push({ ...at, kind: "unknown-source", message: s.sources.length ? `cites unknown question ${unknown.join(", ")}` : "cites no question" });
      }

      const src = sourceText(s.sources, answers);
      const srcLower = src.toLowerCase();
      const srcNums = new Set(numbers(src));
      const srcWords = new Set(contentWords(src).map(stem));

      for (const n of numbers(s.text)) {
        if (!srcNums.has(n)) flags.push({ ...at, kind: "number", token: n, message: `number "${n}" is not in the cited answer` });
      }
      for (const t of new Set(properNouns(s.text))) {
        const lower = t.toLowerCase();
        if (!srcLower.includes(lower) && !allowed.has(lower)) {
          flags.push({ ...at, kind: "proper-noun", token: t, message: `"${t}" is not in the cited answer` });
        }
      }
      for (const c of comparisonWords(s.text)) {
        if (!new RegExp(`\\b${c}\\b`, "i").test(src)) {
          flags.push({ ...at, kind: "comparison", token: c, message: `"${c}" ranks or praises, and the recommender did not say it` });
        }
      }
      const cw = contentWords(s.text).filter((w) => !allowed.has(w));
      if (cw.length >= 5) {
        const novel = cw.filter((w) => !srcWords.has(stem(w)));
        const ratio = novel.length / cw.length;
        if (ratio > HEAVY_REWRITE_THRESHOLD) {
          flags.push({ ...at, kind: "heavy-rewrite", message: `${Math.round(ratio * 100)}% of the wording is new; compare with the original answer` });
        }
      }
    });
  });

  for (const q of questions) {
    if (q.destination === "form") continue;
    const a = answers[q.id];
    if (a && a !== "SKIPPED" && !used.has(q.id) && assembly.mode === "llm") {
      flags.push({ paragraph: null, sentence: null, kind: "unused-answer", questionId: q.id, message: `the answer to ${q.id} is not in the draft (cut for length?)` });
    }
  }
  return flags;
}
