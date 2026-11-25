// Regression tests for the stage 2 fixes: stable sentence ids, edits that survive a re-finish,
// the concurrent double claim, autosave bound to its question, and the tuned comparison words.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as A from "../src/actions/logic";
import type { Row, Runtime } from "../src/actions/logic";
import {
  buildQuestionSet, defaultMiddle, deterministicAssembly, validateAssembly, buildLetters, claimCheck,
  comparisonWords, leadingReasons, createAutosaver, type AnswerDraft, type Scheduler,
} from "../src/core/index";
import { intake, answers as fixtureAnswers } from "../fixtures/demo";
import { makeWorld } from "./memoryRuntime";

const tokenFrom = (text: string) => /token=([0-9a-f]{64})/.exec(text)![1];
const questions = buildQuestionSet(intake, defaultMiddle(intake));

async function claimedWorld(llm?: NonNullable<Parameters<typeof makeWorld>[0]>["llm"]) {
  const w = makeWorld({ llm });
  const student = w.as("u_student", "jordan@example.com");
  const { requestId } = await A.createRequest(student, structuredClone(intake));
  await A.generateQuestions(student, { requestId });
  await A.sendInvite(student, { requestId });
  const token = tokenFrom(w.outbox[0].text);
  const rec = w.as("u_rec", "priya.nair@example.com");
  await A.claimInvite(rec, { token });
  return { w, student, rec, requestId, token };
}

// ---------- 1. stable ids; edits survive a re-finish ----------

test("sentence ids are stable across assemblies and unique even for duplicate sentences", () => {
  const a = deterministicAssembly(questions, fixtureAnswers);
  const b = deterministicAssembly(questions, structuredClone(fixtureAnswers));
  const ids = (x: typeof a) => x.paragraphs.flatMap((p) => p.sentences.map((s) => s.id));
  assert.deepEqual(ids(a), ids(b), "same answers, same ids");
  assert.ok(ids(a).every((id) => /^s[0-9a-f]{8}(-\d+)?$/.test(id)));

  const dup = validateAssembly({ paragraphs: [{ section: "work", programScope: "all", sentences: [
    { text: "Jordan wrote the tests.", sources: ["D3"], id: "model-chosen" },
    { text: "Jordan wrote the tests.", sources: ["D3"] }] }], cuts: [], checks: [] }, questions).assembly!;
  const [s1, s2] = dup.paragraphs[0].sentences;
  assert.notEqual(s1.id, s2.id, "duplicates get distinct ids");
  assert.notEqual(s1.id, "model-chosen", "the model never picks ids");
  assert.equal(s2.id, `${s1.id}-2`);
});

test("re-finishing keeps edits whose sentence still exists and drops the rest with a note", async () => {
  const { rec, requestId } = await claimedWorld(); // llm disabled: deterministic drafts
  await A.saveAnswer(rec, { requestId, questionId: "F1", text: "I am Priya Nair, a principal engineer at Harbor Labs." });
  await A.saveAnswer(rec, { requestId, questionId: "D3", text: "Jordan built the alerting pipeline." });
  await A.finishInterview(rec, { requestId });

  let d = await A.getDraft(rec, { requestId });
  const idOf = (q: string) => d.assembly.paragraphs.flatMap((p) => p.sentences).find((s) => s.sources.includes(q))!.id;
  const f1 = idOf("F1"), d3 = idOf("D3");
  await A.saveEdit(rec, { requestId, sentenceId: f1, text: "I am Dr. Priya Nair, principal engineer at Harbor Labs." });
  await A.saveEdit(rec, { requestId, sentenceId: d3, text: "Jordan built the whole alerting pipeline." });

  // Re-finish with unchanged answers: both edits survive (this used to reset edits to {}).
  let fin = await A.finishInterview(rec, { requestId });
  assert.equal(fin.keptEdits, 2);
  d = await A.getDraft(rec, { requestId });
  assert.equal(d.edits[f1], "I am Dr. Priya Nair, principal engineer at Harbor Labs.");
  assert.ok(d.letters[0].paragraphs.flat().some((s) => s.text === "Jordan built the whole alerting pipeline."));

  // Change the answer behind D3: that sentence is new, so its edit is dropped and quoted in a note.
  await A.saveAnswer(rec, { requestId, questionId: "D3", text: "Jordan built the alerting pipeline and its tests." });
  fin = await A.finishInterview(rec, { requestId });
  assert.equal(fin.keptEdits, 1);
  assert.ok(fin.notes.some((n) => n.includes("no longer in the draft") && n.includes("Jordan built the whole alerting pipeline.")));
  d = await A.getDraft(rec, { requestId });
  assert.deepEqual(Object.keys(d.edits), [f1]);
  assert.ok(d.notes.some((n) => n.includes("not carried over")), "notes are stored for the draft page");
});

// ---------- 2. letters map back to the assembly by id, not text ----------

test("letter sentences carry assembly ids, so an edit to one of two identical sentences changes only that one", async () => {
  const twice = (m: { content: string }[]) =>
    m[0].content.includes("editor, not an author")
      ? JSON.stringify({ paragraphs: [
        { section: "opening", programScope: "all", sentences: [{ text: "I am Priya Nair.", sources: ["F1"] }] },
        { section: "work", programScope: "all", sentences: [
          { text: "Jordan checks their work.", sources: ["F3"] },
          { text: "Jordan checks their work.", sources: ["F3"] }] }], cuts: [], checks: [] })
      : null;
  const { rec, requestId } = await claimedWorld(twice as never);
  await A.saveAnswer(rec, { requestId, questionId: "F1", text: "I am Priya Nair." });
  await A.saveAnswer(rec, { requestId, questionId: "F3", text: "Jordan checks their work." });
  await A.finishInterview(rec, { requestId });
  let d = await A.getDraft(rec, { requestId });

  const assemblyIds = new Set(d.assembly.paragraphs.flatMap((p) => p.sentences.map((s) => s.id)));
  const letterSentences = d.letters[0].paragraphs.flat().filter((s) => !s.sources.includes("TEMPLATE"));
  assert.ok(letterSentences.every((s) => assemblyIds.has(s.id)), "every letter sentence resolves to the assembly");
  const [first, second] = d.assembly.paragraphs[1].sentences;
  assert.notEqual(first.id, second.id);

  await A.saveEdit(rec, { requestId, sentenceId: second.id, text: "Jordan checks their work before anyone asks." });
  d = await A.getDraft(rec, { requestId });
  const texts = d.letters[0].paragraphs.flat().map((s) => s.text);
  assert.equal(texts.filter((t) => t === "Jordan checks their work.").length, 1, "the first copy is untouched");
  assert.equal(texts.filter((t) => t === "Jordan checks their work before anyone asks.").length, 1);
});

// ---------- 3. concurrent double claim ----------

/** Both claimers read the unclaimed invite before either writes: the classic lost update. */
function racingRuntimes(w: ReturnType<typeof makeWorld>, users: string[]): Runtime[] {
  const base = w.as(null).db;
  let waiting: (() => void)[] = [];
  const gate = () => new Promise<void>((resolve) => {
    waiting.push(resolve);
    if (waiting.length === users.length) { waiting.forEach((r) => r()); waiting = []; }
  });
  const db: Runtime["db"] = {
    ...base,
    async find(c, where) {
      const rows: Row[] = await base.find(c, where);
      if (c === "invites" && "tokenHash" in where) await gate();
      return rows;
    },
  };
  return users.map((u) => ({ ...w.as(u), db }));
}

test("two accounts claiming the same link at once: exactly one wins and the records agree", async () => {
  const w = makeWorld();
  const student = w.as("u_student", "jordan@example.com");
  const { requestId } = await A.createRequest(student, structuredClone(intake));
  await A.generateQuestions(student, { requestId });
  await A.sendInvite(student, { requestId });
  const token = tokenFrom(w.outbox[0].text);

  const [a, b] = racingRuntimes(w, ["u_a", "u_b"]);
  const results = await Promise.allSettled([A.claimInvite(a, { token }), A.claimInvite(b, { token })]);
  const won = results.filter((r) => r.status === "fulfilled");
  const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.equal(won.length, 1, "one claim succeeds");
  assert.equal(lost.length, 1, "the other is refused");
  assert.equal((lost[0].reason as A.ActionError).code, "conflict");

  const invite = [...w.tables.invites.values()][0];
  const request = w.tables.requests.get(requestId)!;
  assert.ok(invite.claimedBy === "u_a" || invite.claimedBy === "u_b");
  assert.equal(request.recommenderUserId, invite.claimedBy, "request and invite name the same recommender");
  const loser = invite.claimedBy === "u_a" ? b : a;
  await assert.rejects(A.getInterview(loser, { requestId }), { code: "forbidden" });
});

test("a request already claimed through one invite cannot be claimed through another", async () => {
  const { w, requestId } = await claimedWorld();
  // A stray second unclaimed invite row for the same request (e.g. written by an older build).
  const { hashToken } = await import("../src/core/index");
  await w.as(null).db.create("invites", {
    requestId, email: "x@example.com", tokenHash: await hashToken("f".repeat(64)),
    sentAt: "2026-11-25T12:00:00.000Z", expiresAt: "2026-12-25T00:00:00.000Z", claimedBy: null, claimedAt: null,
  });
  await assert.rejects(A.claimInvite(w.as("u_other"), { token: "f".repeat(64) }), { code: "conflict" });
  assert.equal(w.tables.requests.get(requestId)!.recommenderUserId, "u_rec");
});

// ---------- 4. autosave is bound to the question it was typed for ----------

const tick = () => new Promise((r) => setImmediate(r));

function fakeTimers() {
  let next = 1;
  const pending = new Map<number, () => void>();
  const scheduler: Scheduler = {
    set: (fn) => { const h = next++; pending.set(h, fn); return h; },
    clear: (h) => { pending.delete(h as number); },
  };
  const fire = () => { const fns = [...pending.values()]; pending.clear(); fns.forEach((f) => f()); };
  return { scheduler, fire, count: () => pending.size };
}

test("autosave: text typed for one question is saved to that question, never the next", async () => {
  const saves: AnswerDraft[] = [];
  const t = fakeTimers();
  const saver = createAutosaver({ delayMs: 1200, scheduler: t.scheduler, save: (d) => { saves.push(d); } });

  // Typed on Q1, then the recommender moves to Q2 before the pause timer fires.
  saver.change({ questionId: "D1", text: "In this role interns work on production.", followUp: "" });
  saver.change({ questionId: "D2", text: "In this role interns work on production.", followUp: "" }); // same text, new question
  await tick();
  assert.deepEqual(saves.map((s) => s.questionId), ["D1"], "D1's text was flushed to D1 at the switch");
  t.fire();
  await tick();
  assert.deepEqual(saves.map((s) => s.questionId), ["D1", "D2"], "D2 saves only what was typed for D2");

  // Unchanged text is not saved again; flush saves only what is pending.
  saver.change({ questionId: "D2", text: "In this role interns work on production.", followUp: "" });
  await saver.flush();
  assert.equal(saves.length, 2);

  // Skip discards the pending save for that question.
  saver.change({ questionId: "D3", text: "Jordan built it.", followUp: "" });
  saver.discard("D3");
  t.fire();
  await saver.flush();
  assert.equal(saves.length, 2);
  assert.equal(t.count(), 0);

  // flush() waits for a save the timer already started, so a quick Back never reads stale text.
  let release!: () => void;
  const slow: AnswerDraft[] = [];
  const t2 = fakeTimers();
  const slowSaver = createAutosaver({ delayMs: 1200, scheduler: t2.scheduler, save: (d) => new Promise<void>((r) => { release = () => { slow.push(d); r(); }; }) });
  slowSaver.change({ questionId: "D5", text: "That told me they trust evidence.", followUp: "" });
  t2.fire(); // the timer starts the save; it has not finished
  let flushed = false;
  const f = slowSaver.flush().then(() => { flushed = true; });
  await tick();
  assert.equal(flushed, false, "flush waits for the in-flight save");
  release();
  await f;
  assert.deepEqual(slow.map((s) => s.questionId), ["D5"]);

  // Empty text is never autosaved.
  saver.change({ questionId: "D4", text: "   ", followUp: "" });
  t.fire();
  await saver.flush();
  assert.equal(saves.length, 2);
});

// ---------- 5. comparison words: rankings flag, ordinary uses do not ----------

test("comparison check: ordinary uses of first/only/most/top/higher/better do not flag", () => {
  const ordinary = [
    "The first time we met, Jordan asked about the test plan.",
    "Their first project was a dashboard.",
    "It took only two weeks.",
    "Not only did they fix it, they documented it.",
    "Most mornings Jordan reviews the alerts.",
    "Most of the time they work alone.",
    "The most recent release had no incidents.",
    "The chart sits at the top of the page.",
    "Reliability was our top priority.",
    "They wrote better tests for the parser.",
    "This approach is better than other approaches.",
    "They took on higher-priority tickets.",
    "The error rate was higher than expected.",
  ];
  for (const s of ordinary) assert.deepEqual(comparisonWords(s), [], s);
});

test("comparison check: genuine rankings still flag", () => {
  const ranking: [string, string][] = [
    ["Jordan is the best intern I have had.", "best"],
    ["Jordan is in the top three.", "top"],
    ["They are in the top 5% of students I have taught.", "top"],
    ["Jordan is the only intern who shipped to production.", "only"],
    ["Jordan is the only other intern on the team.", "only"],
    ["Jordan is the most capable engineer on the team.", "most"],
    ["Jordan ranked first in their cohort.", "first"],
    ["Jordan is better than any intern I have supervised.", "better"],
    ["They scored higher than their peers.", "higher"],
    ["Jordan is a top performer.", "top"],
  ];
  for (const [s, word] of ranking) assert.ok(comparisonWords(s).includes(word), `${s} -> ${word}`);
});

test("claim check: an ordinary 'first' or 'only' no longer flags, an invented ranking does", () => {
  const a = validateAssembly({ paragraphs: [{ section: "work", programScope: "all", sentences: [
    { text: "Jordan's first project was TideWatch, and it took only a week to fix the polling interval.", sources: ["D2", "D4"] },
    { text: "Jordan is the only intern who could have fixed it.", sources: ["D4"] }] }], cuts: [], checks: [] }, questions).assembly!;
  const flags = claimCheck(intake, questions, fixtureAnswers, a).filter((f) => f.kind === "comparison");
  assert.deepEqual(flags.map((f) => [f.sentence, f.token]), [[1, "only"]]);
  assert.equal(flags[0].sentenceId, a.paragraphs[0].sentences[1].id, "flags are keyed by sentence id");
});

test("leading-question check accepts ordinary 'first' and still rejects ranking prompts", () => {
  assert.deepEqual(leadingReasons("What was the first project you saw Jordan own?", intake), []);
  assert.ok(leadingReasons("Why is Jordan the top intern you have worked with?", intake).some((r) => r.includes("top")));
});

test("letters still build one per program after the id change", () => {
  const letters = buildLetters(intake, deterministicAssembly(questions, fixtureAnswers));
  assert.equal(letters.length, 2);
  for (const l of letters) {
    const ids = l.paragraphs.flat().map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, "ids are unique within a letter");
    assert.ok(ids.includes(`template:${l.programId}`));
  }
});
