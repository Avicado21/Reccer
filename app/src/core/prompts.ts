// Prompts for the two LLM calls. Both ask for JSON only; both outputs are validated by
// our own code afterwards, so the prompt is a request and the validator is the rule.

import type { Answers, Question, StudentIntake } from "./types";
import { MIDDLE_MAX, MIDDLE_MIN } from "./validateQuestions";
import { firstName } from "./questionBank";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export function questionGenerationMessages(intake: StudentIntake): ChatMessage[] {
  const n = firstName(intake);
  const programs = intake.programs
    .map((p) => `- ${p.name}, ${p.school}${p.description ? `: ${p.description}` : ""}`)
    .join("\n");
  const system = `You write interview questions for a person who is writing a letter of recommendation.
The recommender answers out loud. Their answers become the letter, so the questions must not put words in their mouth.

Return ONLY a JSON object, no prose, no markdown fences:
{"questions":[{"section":"context|work|leadership|teamwork","prompt":"...","opener":"...","formMappings":["..."],"memoryJog":"...","destination":"letter|form"}]}

Rules:
- Write between ${MIDDLE_MIN} and ${MIDDLE_MAX} questions.
- Every prompt is neutral and open-ended, and ends with a question mark.
- Never praise or characterize the student. No words like best, exceptional, impressive, strong.
- Never put facts, numbers, project names, or employer names in the prompt. Put any helpful fact in memoryJog instead; the recommender sees it only if they ask.
- Ask for specific moments and concrete examples.
- opener is 2 to 5 words the recommender can start their answer with, ending in "…".
- formMappings uses only these keys: capacity, effort, group, communication, problem, field, additional.
- Do not write questions about identity, how long they have known the student, ranking, program fit, or overall rating. Those already exist.`;
  const user = `Student: ${n} (${intake.studentName}${intake.pronouns ? `, ${intake.pronouns}` : ""})
Recommender's relationship to the student: ${intake.relationship}
Programs:
${programs}

Student's fact sheet (for memoryJog only, never for prompt text):
${intake.factSheet}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

const SPELLINGS_NOTE = (intake: StudentIntake) =>
  [intake.studentName, ...intake.programs.flatMap((p) => [p.school, p.name])].join("; ");

export function assemblyMessages(intake: StudentIntake, questions: Question[], answers: Answers): ChatMessage[] {
  const answered = questions
    .filter((q) => q.destination !== "form")
    .filter((q) => answers[q.id] && answers[q.id] !== "SKIPPED")
    .map((q) => {
      const a = answers[q.id] as { text: string; followUp?: string };
      return `[${q.id}] section=${q.section} scope=${q.programScope}\nQ: ${q.prompt}\nA: ${a.text}${a.followUp ? `\nFollow-up: ${a.followUp}` : ""}`;
    })
    .join("\n\n");

  const system = `You are an editor, not an author. You turn a recommender's spoken interview answers into letter paragraphs.
The answers ARE the letter.

You MAY: remove filler, false starts, and repetition; fix grammar, punctuation, and speech-to-text errors; add at most a few connecting words per paragraph; refer to the student as "${intake.studentName}" on first mention and "${firstName(intake)}" after; cut whole sentences if the letter would run far past 600 words.
You MAY NOT: add any claim, number, name, adjective, comparison, or example the recommender did not say; strengthen or soften a judgment; replace their phrasing with yours when theirs is clear.
Correct spellings: ${SPELLINGS_NOTE(intake)}.

Return ONLY a JSON object, no prose, no markdown fences:
{"paragraphs":[{"section":"...","programScope":"all|<programId>","sentences":[{"text":"...","sources":["<question id>"]}]}],"cuts":["..."],"checks":["[CHECK: reason] ..."]}

Every sentence must list the question id(s) it came from in sources. Keep one paragraph per section, and keep program-scoped answers in their own paragraph with that programScope. If something is unclear, add a [CHECK: reason] item instead of guessing.`;
  return [
    { role: "system", content: system },
    { role: "user", content: answered },
  ];
}
