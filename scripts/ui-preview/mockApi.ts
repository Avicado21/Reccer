import { buildQuestionSet, defaultMiddle, deterministicAssembly, validateAssembly, claimCheck, buildLetters, buildFormAnswers } from "../../src/core/index";
import { intake, answers, cheatingAssembly } from "../../fixtures/demo";
const qs = buildQuestionSet(intake, defaultMiddle(intake));
const det = deterministicAssembly(qs, answers);
const cheat = validateAssembly(cheatingAssembly, qs).assembly!;
const mixed = { ...det, mode: "llm" as const, paragraphs: [cheat.paragraphs[0], ...det.paragraphs.slice(1)] };
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });
export const api: any = {
  getInterview: () => ok({ studentName: "Jordan Rivera", programs: intake.programs, questions: qs, answers: {}, finished: false }),
  saveAnswer: () => ok({ saved: true }),
  getDraft: () => ok({ assembly: mixed, flags: claimCheck(intake, qs, answers, mixed).filter(f=>f.kind!=="unused-answer"), advisories: [], edits: {}, notes: [], answers, questions: qs,
    letters: buildLetters(intake, mixed), forms: intake.programs.map(p => ({ programId: p.id, title: `${p.school}, ${p.name}`, answers: buildFormAnswers(p, qs, answers) })) }),
};
export type Draft = any; export type Interview = any;
