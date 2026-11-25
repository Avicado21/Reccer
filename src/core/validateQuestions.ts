// Validates LLM call 1 (question generation) output.
// Hand-written instead of Zod so core stays dependency-free and testable offline.
// In the app, a Zod schema can wrap this, but this function stays the authority on
// the leading-question rules.

import type { Question, Section, StudentIntake } from "./types";
import { comparisonWords, properNouns } from "./text";

const MIDDLE_SECTIONS: Section[] = ["context", "work", "leadership", "teamwork"];
const FORM_KEYS = new Set(["capacity", "effort", "group", "communication", "problem", "field", "additional"]);

export const MIDDLE_MIN = 8;
export const MIDDLE_MAX = 13;

export interface ValidationResult {
  ok: boolean;
  questions: Question[];
  errors: string[];
}

/** Names the question text may mention: the student, schools, programs. */
function allowedNames(intake: StudentIntake): Set<string> {
  const allowed = new Set<string>();
  const add = (s: string | undefined) =>
    (s ?? "").split(/[^A-Za-z'’\-]+/).filter(Boolean).forEach((t) => allowed.add(t.toLowerCase()));
  add(intake.studentName);
  add(intake.preferredName);
  for (const p of intake.programs) {
    add(p.school);
    add(p.name);
  }
  return allowed;
}

/** Leading-question check. Returns reasons the prompt is not neutral, or [] if it is. */
export function leadingReasons(prompt: string, intake: StudentIntake): string[] {
  const reasons: string[] = [];
  const cmp = comparisonWords(prompt);
  if (cmp.length) reasons.push(`uses ranking or praise words: ${cmp.join(", ")}`);
  if (/\d/.test(prompt)) reasons.push("contains a number (facts belong in memoryJog)");
  const allowed = allowedNames(intake);
  const fact = intake.factSheet.toLowerCase();
  const leaked = properNouns(prompt).filter(
    (t) => !allowed.has(t.toLowerCase()) && fact.includes(t.toLowerCase()),
  );
  if (leaked.length) reasons.push(`names something from the fact sheet: ${[...new Set(leaked)].join(", ")}`);
  if (!/\?\s*(Only.*)?$/.test(prompt.trim())) reasons.push("is not phrased as a question");
  return reasons;
}

/** Parse model text into JSON, tolerating ```json fences. */
export function parseModelJson(text: string): unknown {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in model output");
  return JSON.parse(clean.slice(start, end + 1));
}

export function validateGeneratedQuestions(raw: unknown, intake: StudentIntake): ValidationResult {
  const errors: string[] = [];
  const list = (raw as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) return { ok: false, questions: [], errors: ["missing questions array"] };

  const out: Question[] = [];
  list.forEach((item, i) => {
    const r = item as Record<string, unknown>;
    const where = `question ${i + 1}`;
    if (typeof r.prompt !== "string" || r.prompt.length < 10) return errors.push(`${where}: missing prompt`);
    if (typeof r.opener !== "string") return errors.push(`${where}: missing opener`);
    if (!MIDDLE_SECTIONS.includes(r.section as Section))
      return errors.push(`${where}: section must be one of ${MIDDLE_SECTIONS.join(", ")}`);
    const lead = leadingReasons(r.prompt, intake);
    if (lead.length) return errors.push(`${where} is leading: ${lead.join("; ")}`);
    const formMappings = Array.isArray(r.formMappings)
      ? (r.formMappings as unknown[]).filter((k): k is string => typeof k === "string" && FORM_KEYS.has(k))
      : [];
    out.push({
      id: `G${out.length + 1}`, // ids are ours, never the model's
      section: r.section as Section,
      prompt: r.prompt.trim(),
      opener: r.opener.trim(),
      programScope: "all", // the model never scopes; fit questions are fixed per program
      formMappings,
      memoryJog: typeof r.memoryJog === "string" && r.memoryJog.trim() ? r.memoryJog.trim() : undefined,
      source: "generated",
      destination: r.destination === "form" ? "form" : "letter",
    });
  });

  if (out.length < MIDDLE_MIN) errors.push(`only ${out.length} valid questions; need at least ${MIDDLE_MIN}`);
  if (out.length > MIDDLE_MAX) out.length = MIDDLE_MAX;
  // Order by section so paragraphs read in sequence.
  out.sort((a, b) => MIDDLE_SECTIONS.indexOf(a.section) - MIDDLE_SECTIONS.indexOf(b.section));
  out.forEach((q, i) => (q.id = `G${i + 1}`));

  return { ok: errors.length === 0 || out.length >= MIDDLE_MIN, questions: out, errors };
}
