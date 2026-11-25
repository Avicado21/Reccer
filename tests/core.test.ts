import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildQuestionSet, defaultMiddle, validateGeneratedQuestions, leadingReasons, parseModelJson,
  deterministicAssembly, validateAssembly, buildLetters, buildFormAnswers, claimCheck,
  stripFiller, inviteEmail, completionEmail, newInviteToken, hashToken, letterToPlainText,
} from "../app/src/core/index";
import { intake, answers, cheatingAssembly, generatedQuestions } from "../fixtures/demo";

const questions = buildQuestionSet(intake, defaultMiddle(intake));

test("default question set lands in the 17–20 range with fixed questions first and last", () => {
  assert.ok(questions.length >= 17 && questions.length <= 22, `got ${questions.length}`);
  assert.equal(questions[0].id, "F1");
  assert.equal(questions.at(-1)!.id, "F7");
  assert.equal(questions.filter((q) => q.section === "fit").length, intake.programs.length);
  assert.equal(new Set(questions.map((q) => q.id)).size, questions.length, "ids are unique");
});

test("leading-question check rejects praise, numbers, and fact-sheet names", () => {
  const r = leadingReasons("How did Jordan's exceptional work on TideWatch cut outage detection to 15 minutes?", intake);
  assert.ok(r.some((x) => x.includes("exceptional")));
  assert.ok(r.some((x) => x.includes("number")));
  assert.ok(r.some((x) => x.includes("TideWatch")));
  assert.deepEqual(leadingReasons("What did Jordan personally build or own?", intake), []);
});

test("generated questions: leading one dropped, ids reassigned, model cannot scope", () => {
  const v = validateGeneratedQuestions(generatedQuestions, intake);
  assert.equal(v.questions.length, 9);
  assert.ok(v.errors.some((e) => e.includes("leading")));
  assert.ok(v.ok, "enough valid questions survive");
  assert.deepEqual(v.questions.map((q) => q.id).slice(0, 2), ["G1", "G2"]);
  assert.ok(v.questions.every((q) => q.programScope === "all" && q.source === "generated"));
});

test("generated questions: too few valid ones means fall back to the default bank", () => {
  const v = validateGeneratedQuestions({ questions: generatedQuestions.questions.slice(0, 4) }, intake);
  assert.equal(v.ok, false);
});

test("parseModelJson tolerates markdown fences and preamble", () => {
  assert.deepEqual(parseModelJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseModelJson("no json here"));
});

test("stripFiller removes verbal tics without changing meaning", () => {
  assert.equal(stripFiller("um, I think the the work was, you know, solid"), "I think the work was solid.");
});

test("deterministic assembly is faithful and passes the claim check", () => {
  const a = deterministicAssembly(questions, answers);
  const flags = claimCheck(intake, questions, answers, a);
  assert.deepEqual(flags.filter((f) => f.kind !== "heavy-rewrite"), []);
  // D6 was skipped; form-only answers (D11, F6, F7) stay out of the letter.
  const cited = a.paragraphs.flatMap((p) => p.sentences.flatMap((s) => s.sources));
  for (const id of ["D6", "D11", "F6", "F7"]) assert.ok(!cited.includes(id), id);
});

test("claim check catches invented ranking, number, and name", () => {
  const v = validateAssembly(cheatingAssembly, questions);
  assert.ok(v.ok);
  const flags = claimCheck(intake, questions, answers, v.assembly!);
  const kinds = flags.map((f) => `${f.kind}:${f.token ?? f.questionId}`);
  assert.ok(kinds.includes("comparison:best"), kinds.join(" "));
  assert.ok(kinds.includes("number:40"), kinds.join(" "));
  assert.ok(kinds.includes("proper-noun:Mayor"), kinds.join(" "));
  assert.ok(kinds.includes("proper-noun:Bayport"), kinds.join(" "));
  assert.ok(flags.some((f) => f.kind === "unused-answer" && f.questionId === "D4"), "unused answers listed");
});

test("claim check allows a ranking the recommender actually said", () => {
  const ok = { paragraphs: [{ section: "comparison", programScope: "all", sentences: [
    { text: "Of the roughly 15 interns I have supervised, Jordan is in the top three.", sources: ["F4"] }] }], cuts: [], checks: [] };
  const flags = claimCheck(intake, questions, answers, validateAssembly(ok, questions).assembly!);
  assert.deepEqual(flags.filter((f) => f.paragraph !== null), []);
});

test("one letter per program, each with only its own fit paragraph", () => {
  const letters = buildLetters(intake, deterministicAssembly(questions, answers));
  assert.equal(letters.length, 2);
  const [lake, north] = letters.map((l) => letterToPlainText(l, "November 25, 2026", { name: "Priya Nair", titleLine: "Principal Engineer, Harbor Labs", email: "priya.nair@example.com" }));
  assert.ok(lake.includes("M.S. in Applied AI at Lakeshore University"));
  assert.ok(lake.includes("independent project") && !lake.includes("governance"));
  assert.ok(north.includes("governance") && !north.includes("independent project"));
});

test("form answers map correctly; rating is exact", () => {
  const north = intake.programs[1];
  const f = buildFormAnswers(north, questions, answers);
  assert.equal(f.find((x) => x.label === "Overall recommendation")!.answer, "Strongly recommend");
  assert.ok(f.find((x) => x.label.startsWith("Describe"))!.answer.includes("incident notes"));
  assert.deepEqual(buildFormAnswers(intake.programs[0], questions, answers), []);
});

test("invite email lists programs by due date and promises confidentiality; completion email has no content", async () => {
  const e = inviteEmail(intake, "https://reccer.app.space/r/abc", questions.length);
  assert.ok(e.text.indexOf("Northgate") < e.text.indexOf("Lakeshore"), "earliest deadline first");
  assert.ok(e.text.includes("cannot see your answers"));
  const c = completionEmail(intake);
  assert.ok(!c.text.includes("TideWatch"));
  const t = newInviteToken();
  assert.equal(t.length, 64);
  assert.notEqual(await hashToken(t), t);
});
