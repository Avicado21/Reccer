// Stage 2 product features: reopen and edit a saved request, deadline reminders, advisory checks
// on edits, and invite cancel / resend / status. Every student-facing read stays status-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as A from "../src/actions/logic";
import type { Runtime } from "../src/actions/logic";
import { remindersDue, daysUntil, reminderKey, type ReminderRequest } from "../src/core/index";
import { intake, answers as fixtureAnswers } from "../fixtures/demo";
import { makeWorld } from "./memoryRuntime";

const tokenFrom = (text: string) => /token=([0-9a-f]{64})/.exec(text)![1];
const at = (rt: Runtime, iso: string): Runtime => ({ ...rt, now: () => new Date(iso) });
const ANSWER_TEXT = ["monitoring team relies on it", "patience", "polling interval"]; // phrases only in answers, never the intake

async function studentWorld() {
  const w = makeWorld();
  const student = w.as("u_student", "jordan@example.com");
  const { requestId } = await A.createRequest(student, structuredClone(intake));
  await A.generateQuestions(student, { requestId });
  return { w, student, requestId };
}

async function answerAll(rec: Runtime, requestId: string) {
  const { questions } = await A.getInterview(rec, { requestId });
  for (const q of questions) {
    const a = fixtureAnswers[q.id];
    if (a && a !== "SKIPPED") await A.saveAnswer(rec, { requestId, questionId: q.id, text: a.text });
  }
}

// ---------- 6. getMyRequestIntake / updateIntake ----------

test("getMyRequestIntake: owner only, intake and questions, never answers, drafts, or letters", async () => {
  const { w, student, requestId } = await studentWorld();
  const mine = await A.getMyRequestIntake(student, { requestId });
  assert.equal(mine.intake.recommenderEmail, intake.recommenderEmail);
  assert.ok(mine.questions.length >= 17);
  assert.equal(mine.editable, true);
  assert.equal(mine.invite, null);
  await assert.rejects(A.getMyRequestIntake(w.as("u_other"), { requestId }), { code: "forbidden" });
  await assert.rejects(A.getMyRequestIntake(w.as(null), { requestId }), { code: "unauthenticated" });

  await A.sendInvite(student, { requestId });
  const rec = w.as("u_rec", "priya.nair@example.com");
  await A.claimInvite(rec, { token: tokenFrom(w.outbox[0].text) });
  await assert.rejects(A.getMyRequestIntake(rec, { requestId }), { code: "forbidden" }, "the recommender has getInterview instead");
  await answerAll(rec, requestId);
  await A.finishInterview(rec, { requestId });

  const after = await A.getMyRequestIntake(student, { requestId });
  assert.deepEqual(Object.keys(after).sort(), ["editable", "intake", "invite", "questionSource", "questions", "questionsFrozen", "questionsStale", "requestId", "status"]);
  const json = JSON.stringify(after);
  for (const phrase of ANSWER_TEXT) assert.ok(!json.includes(phrase), `leaks "${phrase}"`);
  assert.ok(!json.includes("tokenHash") && !json.includes("claimedEmail") && !json.includes("u_rec"));
  assert.equal(after.editable, false);
});

test("updateIntake: contact fixes keep the questions; name or program changes make them stale", async () => {
  const { w, student, requestId } = await studentWorld();
  const mine = await A.getMyRequestIntake(student, { requestId });

  const contact = await A.updateIntake(student, { requestId, intake: { ...mine.intake, recommenderEmail: "p.nair@example.com" } });
  assert.equal(contact.questionsStale, false);
  assert.equal((await A.getMyRequestIntake(student, { requestId })).status, "questions-ready");

  const renamed = await A.updateIntake(student, { requestId, intake: { ...mine.intake, recommenderEmail: "p.nair@example.com", preferredName: "Jo" } });
  assert.equal(renamed.questionsStale, true);
  assert.ok(renamed.notes[0].includes("Create the questions again"));
  assert.equal((await A.getMyRequestIntake(student, { requestId })).status, "draft-intake");
  await assert.rejects(A.sendInvite(student, { requestId }), { code: "conflict" }, "stale questions cannot be sent");

  const g = await A.generateQuestions(student, { requestId });
  assert.ok(g.questions.some((q) => q.prompt.includes("Jo")), "new questions use the new name");
  await A.sendInvite(student, { requestId });
  assert.equal(w.outbox.at(-1)!.to, "p.nair@example.com", "the invite goes to the corrected address");
});

test("updateIntake: validated, owner only, locked once the invite is out, unlocked by cancelling", async () => {
  const { w, student, requestId } = await studentWorld();
  const { intake: saved } = await A.getMyRequestIntake(student, { requestId });
  await assert.rejects(A.updateIntake(student, { requestId, intake: { ...saved, recommenderEmail: "nope" } }), { code: "invalid" });
  await assert.rejects(A.updateIntake(w.as("u_other"), { requestId, intake: saved }), { code: "forbidden" });

  // Unknown fields are not stored; program ids are kept so fit questions stay scoped.
  await A.updateIntake(student, { requestId, intake: { ...saved, sneaky: "x", programs: saved.programs.map((p) => ({ ...p, extra: 1 })) } as never });
  const row = w.tables.requests.get(requestId)!;
  assert.ok(!JSON.stringify(row.intake).includes("sneaky") && !JSON.stringify(row.intake).includes("extra"));
  assert.deepEqual((row.intake as typeof intake).programs.map((p) => p.id), ["lakeshore-ai", "northgate-aip"]);

  await A.sendInvite(student, { requestId });
  await assert.rejects(A.updateIntake(student, { requestId, intake: saved }), { code: "conflict" });
  await A.cancelInvite(student, { requestId });
  const ok = await A.updateIntake(student, { requestId, intake: { ...saved, recommenderName: "Priya Nair" } });
  assert.equal(ok.saved, true);
});

// ---------- 9. invite cancel / resend / status ----------

test("resend replaces the old link; the student sees when it was sent and whether it was claimed", async () => {
  const { w, student, requestId } = await studentWorld();
  await A.sendInvite(student, { requestId });
  const first = tokenFrom(w.outbox.at(-1)!.text);
  await A.sendInvite(at(student, "2026-11-26T09:00:00Z"), { requestId });
  const second = tokenFrom(w.outbox.at(-1)!.text);
  assert.notEqual(first, second);

  let [row] = await A.listMyRequests(student);
  assert.equal(row.invite!.sentAt, "2026-11-26T09:00:00.000Z");
  assert.equal(row.invite!.sendCount, 2);
  assert.equal(row.invite!.claimed, false);

  const rec = w.as("u_rec", "priya.nair@example.com");
  await assert.rejects(A.claimInvite(rec, { token: first }), (e: A.ActionError) => e.code === "invalid" && e.message.includes("newer invite"));
  await A.claimInvite(at(rec, "2026-11-27T10:00:00Z"), { token: second });

  [row] = await A.listMyRequests(student);
  assert.equal(row.invite!.claimed, true);
  assert.equal(row.invite!.claimedAt, "2026-11-27T10:00:00.000Z");
  const json = JSON.stringify(row);
  assert.ok(!json.includes(second) && !json.includes("tokenHash") && !json.includes("claimedEmail") && !json.includes("u_rec"), "status only");
  await assert.rejects(A.sendInvite(student, { requestId }), { code: "conflict" }, "no resend after the claim");
  await assert.rejects(A.cancelInvite(student, { requestId }), { code: "conflict" }, "no cancel after the claim");
});

test("cancel: the link stops working, questions unlock, and the request can be sent again", async () => {
  const { w, student, requestId } = await studentWorld();
  await A.sendInvite(student, { requestId });
  const token = tokenFrom(w.outbox.at(-1)!.text);
  await assert.rejects(A.cancelInvite(w.as("u_other"), { requestId }), { code: "forbidden" });
  assert.deepEqual(await A.cancelInvite(student, { requestId }), { cancelled: true });

  await assert.rejects(A.claimInvite(w.as("u_rec"), { token }), (e: A.ActionError) => e.code === "invalid" && e.message.includes("cancelled"));
  const mine = await A.getMyRequestIntake(student, { requestId });
  assert.equal(mine.status, "questions-ready");
  assert.equal(mine.questionsFrozen, false);
  assert.equal(mine.invite!.cancelled, true);
  await A.removeQuestion(student, { requestId, questionId: "D6" }); // unlocked again
  await assert.rejects(A.cancelInvite(student, { requestId }), { code: "conflict" }, "nothing left to cancel");

  await A.sendInvite(student, { requestId });
  await A.claimInvite(w.as("u_rec"), { token: tokenFrom(w.outbox.at(-1)!.text) });
});

test("resending is capped per request", async () => {
  const { student, requestId } = await studentWorld();
  for (let i = 0; i < A.MAX_INVITE_SENDS; i++) await A.sendInvite(student, { requestId });
  await assert.rejects(A.sendInvite(student, { requestId }), { code: "limit" });
  const [row] = await A.listMyRequests(student);
  assert.equal(row.invite!.sendsLeft, 0);
});

test("a failed invite email retires the new link and keeps the earlier one working", async () => {
  const { w, student, requestId } = await studentWorld();
  await A.sendInvite(student, { requestId });
  const good = tokenFrom(w.outbox.at(-1)!.text);
  const broken: Runtime = { ...student, email: async () => ({ ok: false, error: "mailbox full" }) };
  await assert.rejects(A.sendInvite(broken, { requestId }), { code: "invalid" });
  assert.deepEqual(await A.claimInvite(w.as("u_rec"), { token: good }), { requestId });
});

// ---------- 8. advisory claim check on edits ----------

test("an edit that adds a ranking or number keeps standing and gets advisory notes", async () => {
  const w = makeWorld();
  const student = w.as("u_student", "jordan@example.com");
  const { requestId } = await A.createRequest(student, structuredClone(intake));
  await A.generateQuestions(student, { requestId });
  await A.sendInvite(student, { requestId });
  const rec = w.as("u_rec");
  await A.claimInvite(rec, { token: tokenFrom(w.outbox.at(-1)!.text) });
  await A.saveAnswer(rec, { requestId, questionId: "F3", text: "I am recommending Jordan because they check their own work." });
  await A.finishInterview(rec, { requestId });
  let d = await A.getDraft(rec, { requestId });
  const target = d.assembly.paragraphs[0].sentences.find((s) => s.sources.includes("F3"))!;

  await A.saveEdit(rec, { requestId, sentenceId: target.id, text: "Jordan is the best of my 15 interns because they check their own work." });
  d = await A.getDraft(rec, { requestId });
  assert.ok(d.letters[0].paragraphs.flat().some((s) => s.text.startsWith("Jordan is the best of my 15 interns")), "the edit stands");
  assert.ok(!d.flags.some((f) => f.sentenceId === target.id), "no blocking flags on the edited sentence");
  const kinds = d.advisories.map((f) => `${f.kind}:${f.token}`).sort();
  assert.deepEqual(kinds, ["comparison:best", "number:15"]);
  assert.ok(d.advisories.every((f) => f.advisory && f.sentenceId === target.id && f.message.startsWith("your edit adds")));

  // A plain edit in the recommender's own words gets no notes; saving the original reverts.
  await A.saveEdit(rec, { requestId, sentenceId: target.id, text: "I recommend Jordan because they check their work." });
  assert.deepEqual((await A.getDraft(rec, { requestId })).advisories, []);
  const back = await A.saveEdit(rec, { requestId, sentenceId: target.id, text: target.text });
  assert.equal(back.reverted, true);
  assert.deepEqual((await A.getDraft(rec, { requestId })).edits, {});
  await assert.rejects(A.saveEdit(rec, { requestId, sentenceId: "s00000000", text: "x" }), { code: "invalid" });
});

// ---------- 7. deadline reminders ----------

const row = (over: Partial<ReminderRequest>): ReminderRequest => ({ id: "r1", status: "invited", intake, remindersSent: [], ...over });

test("remindersDue: status, window, earliest upcoming deadline, and already-sent rules", () => {
  // Northgate is due 2026-12-01, Lakeshore 2026-12-15.
  const nov28 = new Date("2026-11-28T15:00:00Z");
  assert.equal(daysUntil("2026-12-01", nov28), 3);

  const [r] = remindersDue([row({})], nov28);
  assert.equal(r.program.id, "northgate-aip");
  assert.equal(r.window, 7);
  assert.deepEqual(r.recipients, ["student", "recommender"]);

  assert.deepEqual(remindersDue([row({ status: "finished" }), row({ status: "questions-ready" }), row({ status: "draft-intake" })], nov28), []);
  assert.deepEqual(remindersDue([row({})], new Date("2026-11-20T00:00:00Z")), [], "11 days out: no window yet");
  assert.equal(remindersDue([row({ status: "in-progress" })], nov28).length, 1);

  const sent = [reminderKey("2026-12-01", 7, "student"), reminderKey("2026-12-01", 7, "recommender")];
  assert.deepEqual(remindersDue([row({ remindersSent: sent })], nov28), [], "already reminded for this window");
  const [tighter] = remindersDue([row({ remindersSent: sent })], new Date("2026-11-30T08:00:00Z"));
  assert.equal(tighter.window, 2, "the 2-day window is new");
  assert.deepEqual(remindersDue([row({ remindersSent: [sent[0]] })], nov28)[0].recipients, ["recommender"]);

  // Once Northgate has passed, the next upcoming deadline (Lakeshore) is the one that counts.
  const [later] = remindersDue([row({})], new Date("2026-12-10T00:00:00Z"));
  assert.equal(later.program.id, "lakeshore-ai");
  assert.deepEqual(remindersDue([row({})], new Date("2026-12-16T00:00:00Z")), [], "all deadlines passed");
});

test("sendDeadlineReminders: system-only, status-only to the student, a nudge to the recommender, once per window", async () => {
  const w = makeWorld();
  const student = w.as("u_student", "jordan@example.com");
  const make = async () => {
    const { requestId } = await A.createRequest(student, structuredClone(intake));
    await A.generateQuestions(student, { requestId });
    await A.sendInvite(student, { requestId });
    return { requestId, token: tokenFrom(w.outbox.at(-1)!.text) };
  };
  const invited = await make();
  const started = await make();
  const rec = w.as("u_rec", "priya.nair@example.com");
  await A.claimInvite(rec, { token: started.token });
  await answerAll(rec, started.requestId);
  await make().then(({ requestId }) => A.cancelInvite(student, { requestId })); // not invited any more
  const cron: Runtime = { ...w.as(null), system: true, now: () => new Date("2026-11-28T14:00:00Z") };

  await assert.rejects(A.sendDeadlineReminders(student), { code: "forbidden" }, "clients cannot trigger it");
  await assert.rejects(A.sendDeadlineReminders(w.as(null)), { code: "forbidden" });

  const before = w.outbox.length;
  const res = await A.sendDeadlineReminders(cron);
  assert.equal(res.checked, 2);
  assert.equal(res.sent.length, 4);
  assert.deepEqual(res.failed, []);
  const mails = w.outbox.slice(before);

  const toStudent = mails.filter((m) => m.to === "jordan@example.com");
  assert.equal(toStudent.length, 2);
  for (const m of toStudent) {
    for (const phrase of ANSWER_TEXT) assert.ok(!m.text.includes(phrase), "student reminder leaks no answers");
    assert.ok(m.text.includes("December 1, 2026") && m.text.includes("status update only"));
    assert.ok(!/token=/.test(m.text));
  }
  assert.ok(toStudent.some((m) => m.text.includes("has not opened your invite")));
  assert.ok(toStudent.some((m) => m.text.includes("has started the interview")));

  const toRec = mails.filter((m) => m.to === intake.recommenderEmail);
  assert.equal(toRec.length, 2);
  for (const m of toRec) assert.ok(m.text.indexOf("December 1, 2026") < m.text.indexOf("December 15, 2026"), "due dates, earliest first");
  assert.ok(toRec.some((m) => m.text.includes(`/recommender/interview?id=${started.requestId}`)), "in-progress gets a resume link");
  const unclaimed = toRec.find((m) => !m.text.includes("/recommender/interview"))!;
  assert.ok(unclaimed.text.includes("asked you for a letter of recommendation") && !/token=/.test(unclaimed.text), "no new claim link from the cron");
  void invited;

  // Same day again: nothing new. Two days out: the tighter window sends once more.
  assert.equal((await A.sendDeadlineReminders(cron)).sent.length, 0);
  const later = await A.sendDeadlineReminders({ ...cron, now: () => new Date("2026-11-30T14:00:00Z") });
  assert.equal(later.sent.length, 4);
  assert.ok(later.sent.every((s) => s.window === 2));
});

test("sendDeadlineReminders: a failed send is reported and retried next run", async () => {
  const w = makeWorld();
  const student = w.as("u_student", "jordan@example.com");
  const { requestId } = await A.createRequest(student, structuredClone(intake));
  await A.generateQuestions(student, { requestId });
  await A.sendInvite(student, { requestId });
  const base: Runtime = { ...w.as(null), system: true, now: () => new Date("2026-11-28T14:00:00Z") };
  const flaky: Runtime = { ...base, email: async (m) => (m.to === intake.recommenderEmail ? { ok: false, error: "bounced" } : base.email(m)) };
  const first = await A.sendDeadlineReminders(flaky);
  assert.deepEqual(first.sent.map((s) => s.to), ["student"]);
  assert.deepEqual(first.failed.map((f) => [f.to, f.error]), [["recommender", "bounced"]]);
  const retry = await A.sendDeadlineReminders(base);
  assert.deepEqual(retry.sent.map((s) => s.to), ["recommender"], "only the failed one is retried");
});

test("describeInvite: a plain status line for the student", async () => {
  const { describeInvite } = await import("../src/core/index");
  const base = { sentAt: "2026-11-25T15:10:00.000Z", claimed: false, claimedAt: null, cancelled: false, expired: false };
  assert.equal(describeInvite(null), "No invite sent yet");
  assert.equal(describeInvite(base, "UTC"), "Invite sent November 25, 3:10 PM; not opened yet");
  assert.equal(describeInvite({ ...base, claimed: true, claimedAt: "2026-11-26T09:05:00.000Z" }, "UTC"), "Accepted November 26, 9:05 AM");
  assert.equal(describeInvite({ ...base, cancelled: true }, "UTC"), "Invite cancelled");
  assert.match(describeInvite({ ...base, expired: true }, "UTC"), /link has expired$/);
});

test("sendDeadlineReminders: an expired invite tells the student to resend and holds the recommender's nudge", async () => {
  const w = makeWorld();
  const student = w.as("u_student", "jordan@example.com");
  const { requestId } = await A.createRequest(student, structuredClone(intake));
  await A.generateQuestions(student, { requestId });
  await A.sendInvite(at(student, "2026-10-20T12:00:00Z"), { requestId }); // the link expires Nov 19
  const cron: Runtime = { ...w.as(null), system: true, now: () => new Date("2026-11-28T14:00:00Z") };
  const first = await A.sendDeadlineReminders(cron);
  assert.deepEqual(first.sent.map((s) => s.to), ["student"]);
  assert.ok(w.outbox.at(-1)!.text.includes("expired before"));

  await A.sendInvite(at(student, "2026-11-28T15:00:00Z"), { requestId }); // resent: a working link again
  const next = await A.sendDeadlineReminders({ ...cron, now: () => new Date("2026-11-28T16:00:00Z") }); // same 7-day window
  assert.deepEqual(next.sent.map((s) => s.to), ["recommender"], "the held nudge goes out once the link works");
});
