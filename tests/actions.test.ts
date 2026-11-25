import { test } from "node:test";
import assert from "node:assert/strict";
import * as A from "../app/src/actions/logic";
import { intake, answers as fixtureAnswers, generatedQuestions } from "../fixtures/demo";
import { makeWorld } from "./memoryRuntime";

const tokenFrom = (text: string) => /token=([0-9a-f]{64})/.exec(text)![1];

async function invitedWorld(llm?: (m: import("../app/src/core/index").ChatMessage[]) => string | null) {
  const w = makeWorld({ llm });
  const student = w.as("u_student", "jordan@example.com");
  const { requestId } = await A.createRequest(student, structuredClone(intake));
  await A.generateQuestions(student, { requestId });
  await A.sendInvite(student, { requestId });
  const token = tokenFrom(w.outbox[0].text);
  return { w, student, requestId, token };
}

test("anonymous callers are refused everywhere", async () => {
  const w = makeWorld();
  await assert.rejects(A.createRequest(w.as(null), structuredClone(intake)), { code: "unauthenticated" });
  await assert.rejects(A.listMyRequests(w.as(null)), { code: "unauthenticated" });
  await assert.rejects(A.claimInvite(w.as(null), { token: "x" }), { code: "unauthenticated" });
});

test("intake validation returns plain, actionable errors", async () => {
  const w = makeWorld();
  const bad = { ...structuredClone(intake), recommenderEmail: "nope", programs: [] };
  await assert.rejects(A.createRequest(w.as("u1"), bad), (e: A.ActionError) => e.code === "invalid" && e.message.includes("valid email") && e.message.includes("at least one program"));
});

test("LLM failure falls back to the default bank; generation is capped", async () => {
  const w = makeWorld(); // llm disabled
  const s = w.as("u_student");
  const { requestId } = await A.createRequest(s, structuredClone(intake));
  for (let i = 0; i < 4; i++) {
    const r = await A.generateQuestions(s, { requestId });
    assert.equal(r.source, "default");
  }
  assert.equal(w.llmCalls.length, 3, "capped at MAX_GENERATIONS");
});

test("valid generated questions are used and leading ones are dropped", async () => {
  const w = makeWorld({ llm: () => JSON.stringify(generatedQuestions) });
  const s = w.as("u_student");
  const { requestId } = await A.createRequest(s, structuredClone(intake));
  const r = await A.generateQuestions(s, { requestId });
  assert.equal(r.source, "generated");
  assert.ok(!r.questions.some((q) => /exceptional/.test(q.prompt)));
  assert.ok(r.notes.some((n) => n.includes("leading")));
});

test("student can remove non-fixed questions before inviting, not after", async () => {
  const w = makeWorld();
  const s = w.as("u_student");
  const { requestId } = await A.createRequest(s, structuredClone(intake));
  await A.generateQuestions(s, { requestId });
  await assert.rejects(A.removeQuestion(s, { requestId, questionId: "F4" }), { code: "forbidden" });
  await A.removeQuestion(s, { requestId, questionId: "D6" });
  await A.sendInvite(s, { requestId });
  await assert.rejects(A.removeQuestion(s, { requestId, questionId: "D7" }), { code: "conflict" });
  await assert.rejects(A.generateQuestions(s, { requestId }), { code: "conflict" });
});

test("invite: token never returned to the student, stored only as a hash", async () => {
  const w = makeWorld();
  const s = w.as("u_student");
  const { requestId } = await A.createRequest(s, structuredClone(intake));
  await A.generateQuestions(s, { requestId });
  const res = await A.sendInvite(s, { requestId });
  assert.deepEqual(Object.keys(res), ["sentTo"]);
  const token = tokenFrom(w.outbox[0].text);
  const stored = [...w.tables.invites.values()][0];
  assert.notEqual(stored.tokenHash, token);
  assert.ok(!JSON.stringify([...w.tables.invites.values()]).includes(token));
  assert.equal(w.outbox[0].to, intake.recommenderEmail);
});

test("the student cannot claim their own invite or read the interview", async () => {
  const { student, requestId, token } = await invitedWorld();
  await assert.rejects(A.claimInvite(student, { token }), { code: "forbidden" });
  await assert.rejects(A.getInterview(student, { requestId }), { code: "forbidden" });
});

test("a second account cannot claim an already-claimed invite; re-claim by the same account is fine", async () => {
  const { w, requestId, token } = await invitedWorld();
  const rec = w.as("u_rec", "priya.nair@example.com");
  assert.deepEqual(await A.claimInvite(rec, { token }), { requestId });
  assert.deepEqual(await A.claimInvite(rec, { token }), { requestId });
  await assert.rejects(A.claimInvite(w.as("u_other"), { token }), { code: "conflict" });
  await assert.rejects(A.getInterview(w.as("u_other"), { requestId }), { code: "forbidden" });
});

test("expired and bogus tokens are refused", async () => {
  const { w, token } = await invitedWorld();
  const later = { ...w.as("u_rec"), now: () => new Date("2027-02-01T00:00:00Z") };
  await assert.rejects(A.claimInvite(later, { token }), { code: "invalid" });
  await assert.rejects(A.claimInvite(w.as("u_rec"), { token: "0".repeat(64) }), { code: "not_found" });
});

test("full path: answers, finish, draft; student gets a content-free email and status only", async () => {
  const { w, student, requestId, token } = await invitedWorld();
  const rec = w.as("u_rec", "priya.nair@example.com");
  await A.claimInvite(rec, { token });
  const interview = await A.getInterview(rec, { requestId });
  for (const q of interview.questions) {
    const a = fixtureAnswers[q.id];
    if (!a) continue;
    await A.saveAnswer(rec, a === "SKIPPED" ? { requestId, questionId: q.id, skipped: true } : { requestId, questionId: q.id, text: a.text });
  }
  await assert.rejects(A.saveAnswer(rec, { requestId, questionId: "NOPE", text: "x" }), { code: "not_found" });
  await assert.rejects(A.saveAnswer(student, { requestId, questionId: "F1", text: "I am the student pretending" }), { code: "forbidden" });

  const fin = await A.finishInterview(rec, { requestId });
  assert.equal(fin.mode, "deterministic"); // llm disabled
  assert.equal(fin.flagCount, 0);

  const done = w.outbox.at(-1)!;
  assert.equal(done.to, "jordan@example.com");
  assert.ok(!done.text.includes("TideWatch") && !done.text.includes("patience"));

  await assert.rejects(A.getDraft(student, { requestId }), { code: "forbidden" });
  const mine = await A.listMyRequests(student);
  assert.equal(mine[0].status, "finished");
  assert.ok(!JSON.stringify(mine).includes("TideWatch"), "status view leaks no content");

  const d = await A.getDraft(rec, { requestId });
  assert.equal(d.letters.length, 2);
  assert.equal(d.forms.find((f) => f.programId === "northgate-aip")!.answers.at(-1)!.answer, "Strongly recommend");
});

test("LLM assembly that invents claims gets flagged; a recommender edit clears that sentence's flags", async () => {
  const cheat = (m: { content: string }[]) =>
    m[0].content.includes("editor, not an author")
      ? JSON.stringify({ paragraphs: [{ section: "opening", programScope: "all", sentences: [
          { text: "I am Priya Nair, a principal engineer at Harbor Labs.", sources: ["F1"] },
          { text: "Jordan Rivera is the best intern I have ever had.", sources: ["F3"] }] }], cuts: [], checks: [] })
      : null;
  const { w, requestId, token } = await invitedWorld(cheat as never);
  const rec = w.as("u_rec");
  await A.claimInvite(rec, { token });
  await A.saveAnswer(rec, { requestId, questionId: "F1", text: "I am Priya Nair, a principal engineer at Harbor Labs." });
  await A.saveAnswer(rec, { requestId, questionId: "F3", text: "I am recommending Jordan because they check their own work." });
  const fin = await A.finishInterview(rec, { requestId });
  assert.equal(fin.mode, "llm");
  let d = await A.getDraft(rec, { requestId });
  assert.ok(d.flags.some((f) => f.kind === "comparison" && f.token === "best"));
  await A.saveEdit(rec, { requestId, paragraph: 0, sentence: 1, text: "I am recommending Jordan because they check their own work." });
  d = await A.getDraft(rec, { requestId });
  assert.ok(!d.flags.some((f) => f.paragraph === 0 && f.sentence === 1));
});

test("assembly is capped and falls back to the recommender's words", async () => {
  const { w, requestId, token } = await invitedWorld();
  const rec = w.as("u_rec");
  await A.claimInvite(rec, { token });
  await A.saveAnswer(rec, { requestId, questionId: "F1", text: "I am Priya Nair." });
  for (let i = 0; i < 4; i++) await A.finishInterview(rec, { requestId });
  const calls = w.llmCalls.filter((m) => m[0].content.includes("editor, not an author")).length;
  assert.equal(calls, 3);
  assert.equal(w.outbox.filter((m) => m.subject.includes("finished")).length, 1, "student notified once");
});
