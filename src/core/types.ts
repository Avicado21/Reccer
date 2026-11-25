// Reccer core domain types.
// SDK-free on purpose: these run in the browser, in the worker, and in tests.

export type Section =
  | "opening"
  | "context"
  | "work"
  | "leadership"
  | "teamwork"
  | "comparison"
  | "fit"
  | "close";

/** Order in which sections become letter paragraphs. */
export const SECTION_ORDER: Section[] = [
  "opening",
  "context",
  "work",
  "leadership",
  "teamwork",
  "comparison",
  "fit",
  "close",
];

export interface Question {
  id: string;
  section: Section;
  /** Neutral, open-ended question. Never contains claims about the student. */
  prompt: string;
  /** Suggested first words, so the spoken answer is letter-ready. */
  opener: string;
  /** "all" or a Program.id. Fit questions are scoped to one program. */
  programScope: "all" | string;
  /** Keys into a program's recommender form, e.g. "effort". */
  formMappings: string[];
  /** Student-supplied facts, shown only when the recommender taps "facts". */
  memoryJog?: string;
  /** fixed = hard-coded by Reccer; generated = LLM call 1; default = static fallback bank. */
  source: "fixed" | "generated" | "default";
  /** Destination: letter paragraph, form only, or both. */
  destination: "letter" | "form" | "both";
}

export interface FormQuestion {
  key: string; // e.g. "effort"
  label: string; // the school's wording
}

export interface Program {
  id: string;
  school: string; // "Carnegie Mellon University, Heinz College"
  name: string; // "M.S. in AI Systems Management"
  dueDate: string; // ISO date, "2026-12-15"
  submission: "portal-form" | "upload" | "both";
  /** What the program is about, in the student's words. Used only for question generation. */
  description?: string;
  /** Optional recommender form (CMU-style). */
  formQuestions?: FormQuestion[];
  /** Optional overall rating choices, e.g. ["Strongly recommend", ...]. */
  ratingOptions?: string[];
}

export interface StudentIntake {
  studentName: string; // "Jordan Rivera"
  preferredName?: string; // "Jordan"
  pronouns?: string;
  recommenderName: string;
  recommenderEmail: string;
  relationship: string; // "my supervisor at Harbor Labs"
  /** Free text: resume highlights, projects, numbers. Becomes memoryJog only. */
  factSheet: string;
  programs: Program[];
}

export type AnswerValue = { text: string; followUp?: string } | "SKIPPED";

export type Answers = Record<string, AnswerValue>;

/** LLM call 2 output, after validation. */
export interface AssembledSentence {
  text: string;
  sources: string[]; // question ids this sentence came from
}
export interface AssembledParagraph {
  section: Section;
  programScope: "all" | string;
  sentences: AssembledSentence[];
}
export interface Assembly {
  paragraphs: AssembledParagraph[];
  cuts: string[]; // sentences the model dropped for length
  checks: string[]; // [CHECK: ...] items the model raised
  mode: "llm" | "deterministic";
}

export type FlagKind =
  | "number"
  | "proper-noun"
  | "comparison"
  | "unknown-source"
  | "heavy-rewrite"
  | "unused-answer";

export interface Flag {
  kind: FlagKind;
  /** Index path into the assembly, or null for answer-level flags. */
  paragraph: number | null;
  sentence: number | null;
  token?: string;
  questionId?: string;
  message: string;
}

export interface Letter {
  programId: string;
  title: string;
  paragraphs: AssembledSentence[][];
  wordCount: number;
}
