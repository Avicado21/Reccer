// Turns answers into letters.
//   validateAssembly:      checks LLM call 2 output against the question set.
//   deterministicAssembly: no-LLM fallback. Each answer, filler stripped, in section order.
//   buildLetters:          one letter per program, from an Assembly.
//   buildFormAnswers:      a program's recommender-form answers from mapped questions.

import type {
  Answers, Assembly, AssembledParagraph, AssembledSentence, Letter, Program, Question, Section, StudentIntake,
} from "./types";
import { SECTION_ORDER } from "./types";
import { countWords, stripFiller } from "./text";

function answerText(a: Answers[string] | undefined): string | null {
  if (!a || a === "SKIPPED") return null;
  return [a.text, a.followUp].filter(Boolean).join(" ");
}

export function validateAssembly(raw: unknown, questions: Question[]): { ok: boolean; assembly: Assembly | null; errors: string[] } {
  const errors: string[] = [];
  const r = raw as { paragraphs?: unknown; cuts?: unknown; checks?: unknown };
  if (!Array.isArray(r?.paragraphs)) return { ok: false, assembly: null, errors: ["missing paragraphs array"] };
  const ids = new Set(questions.map((q) => q.id));
  const paragraphs: AssembledParagraph[] = [];
  r.paragraphs.forEach((p: any, i: number) => {
    if (!SECTION_ORDER.includes(p?.section)) return errors.push(`paragraph ${i + 1}: bad section`);
    if (!Array.isArray(p.sentences)) return errors.push(`paragraph ${i + 1}: missing sentences`);
    const sentences: AssembledSentence[] = p.sentences
      .filter((s: any) => typeof s?.text === "string" && s.text.trim())
      .map((s: any) => ({
        text: s.text.trim(),
        sources: Array.isArray(s.sources) ? s.sources.filter((x: unknown) => typeof x === "string") : [],
      }));
    if (!sentences.length) return;
    const scope = typeof p.programScope === "string" ? p.programScope : "all";
    paragraphs.push({ section: p.section, programScope: scope, sentences });
  });
  // Unknown source ids are not fatal here; claimCheck flags them per sentence.
  void ids;
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  paragraphs.sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section));
  const ok = paragraphs.length > 0;
  if (!ok) errors.push("no usable paragraphs");
  return { ok, assembly: ok ? { paragraphs, cuts: strs(r.cuts), checks: strs(r.checks), mode: "llm" } : null, errors };
}

/** Fallback when LLM call 2 fails or is over budget. Faithful by construction. */
export function deterministicAssembly(questions: Question[], answers: Answers): Assembly {
  const groups = new Map<string, AssembledParagraph>();
  for (const q of questions) {
    if (q.destination === "form") continue;
    const t = answerText(answers[q.id]);
    if (!t) continue;
    const key = `${q.section}|${q.programScope}`;
    if (!groups.has(key)) groups.set(key, { section: q.section, programScope: q.programScope, sentences: [] });
    groups.get(key)!.sentences.push({ text: stripFiller(t), sources: [q.id] });
  }
  const paragraphs = [...groups.values()].sort(
    (a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section),
  );
  return { paragraphs, cuts: [], checks: [], mode: "deterministic" };
}

/** Sections that merge into one paragraph, mirroring the original template. */
const PARAGRAPH_GROUPS: Section[][] = [["opening"], ["context", "work"], ["leadership"], ["teamwork"], ["comparison"], ["fit"], ["close"]];

export function buildLetters(intake: StudentIntake, assembly: Assembly): Letter[] {
  return intake.programs.map((program) => {
    const usable = assembly.paragraphs.filter((p) => p.programScope === "all" || p.programScope === program.id);
    const paragraphs: AssembledSentence[][] = [];
    for (const group of PARAGRAPH_GROUPS) {
      const sentences = usable.filter((p) => group.includes(p.section)).flatMap((p) => p.sentences);
      if (!sentences.length) continue;
      if (group[0] === "opening") {
        // The one fixed line Reccer adds: which program the letter is for.
        const line: AssembledSentence = {
          text: `I recommend ${intake.studentName} for the ${program.name} at ${program.school}.`,
          sources: ["TEMPLATE"],
        };
        sentences.splice(Math.min(1, sentences.length), 0, line);
      }
      paragraphs.push(sentences);
    }
    const wordCount = paragraphs.flat().reduce((n, s) => n + countWords(s.text), 0);
    return { programId: program.id, title: `${program.school}, ${program.name}`, paragraphs, wordCount };
  });
}

export function buildFormAnswers(program: Program, questions: Question[], answers: Answers): { label: string; answer: string }[] {
  if (!program.formQuestions?.length) return [];
  return program.formQuestions.map((fq) => {
    const parts = questions
      .filter((q) => q.formMappings.includes(fq.key))
      .filter((q) => q.programScope === "all" || q.programScope === program.id)
      .map((q) => answerText(answers[q.id]))
      .filter((t): t is string => !!t)
      // A rating is reported exactly as chosen; everything else gets filler removed.
      .map((t) => (fq.key === "rating" ? t.trim() : stripFiller(t)));
    return { label: fq.label, answer: parts.join(" ") || "(no answer; left blank)" };
  });
}
