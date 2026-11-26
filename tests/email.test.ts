// Emails: HTML alongside text, escaping, button links, reply-to on recommender mail, and the
// student's optional note to the recommender (invite email only, never the model or the letter).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as A from "../src/actions/logic";
import {
  inviteEmail, completionEmail, studentReminderEmail, recommenderReminderEmail,
  esc, cleanNote, replyToField, MAX_NOTE_CHARS, type StudentIntake,
} from "../src/core/index";
import { intake as demoIntake, answers as fixtureAnswers } from "../fixtures/demo";
import { makeWorld } from "./memoryRuntime";

const LINK = "https://reccer.app.space/recommender/claim?token=abc123&x=1";
const NOW = new Date("2026-11-25T12:00:00Z");
const STUDENT_EMAIL = "jordan@example.com";
const due = { status: "invited" as const, program: demoIntake.programs[0], daysLeft: 3 };

/** href values in the HTML, unescaped back to the URL they point to. */
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const visibleText = (html: string) => html.replace(/<[^>]*>/g, " ");

const hostile: StudentIntake = {
  ...structuredClone(demoIntake),
  studentName: `Jo <script>alert(1)</script> "Q" & Co`,
  preferredName: "Jo'<b>",
  recommenderName: "Dr. <img src=x onerror=alert(1)>",
  programs: demoIntake.programs.map((p) => ({ ...p, name: `${p.name} <i>&</i>`, school: `${p.school} "x"` })),
  noteToRecommender: `Thanks so much!\n<a href="https://evil.example">click</a> & "quotes"`,
};

test("every email has an html body next to the text body, wrapped in the email shell", () => {
  const mails = [
    inviteEmail(demoIntake, LINK, 18, STUDENT_EMAIL),
    completionEmail(demoIntake),
    studentReminderEmail(demoIntake, due),
    recommenderReminderEmail(demoIntake, { status: "in-progress", daysLeft: 3 }, NOW, "https://reccer.app.space/recommender/interview?id=r1", STUDENT_EMAIL),
    recommenderReminderEmail(demoIntake, { status: "invited", daysLeft: 3 }, NOW, null, STUDENT_EMAIL),
  ];
  for (const m of mails) {
    assert.ok(m.text.length > 50, m.subject);
    assert.match(m.html, /^<!doctype html>/);
    assert.ok(m.html.includes("</html>"));
    assert.doesNotMatch(m.html, /<link|<script|@import|url\(|<img|fonts\.googleapis/i, "no external assets or web fonts");
    assert.doesNotMatch(m.html, /<style/i, "inline styles only");
  }
});

test("invite: the 'Start your letter' button and the text link go to the same URL", () => {
  const m = inviteEmail(demoIntake, LINK, 18, STUDENT_EMAIL);
  assert.ok(m.text.includes(`Start here: ${LINK}`));
  assert.ok(m.html.includes(">Start your letter</a>"));
  const links = hrefs(m.html);
  assert.ok(links.length >= 1);
  for (const h of links) assert.equal(h, LINK);
  assert.ok(m.html.includes("abc123&amp;x=1"), "the & in the URL is escaped in the HTML");
});

test("in-progress recommender reminder: 'Pick up where you left off' button matches the text link", () => {
  const resume = "https://reccer.app.space/recommender/interview?id=r1";
  const m = recommenderReminderEmail(demoIntake, { status: "in-progress", daysLeft: 3 }, NOW, resume, STUDENT_EMAIL);
  assert.ok(m.text.includes(`Pick up where you left off: ${resume}`));
  assert.ok(m.html.includes(">Pick up where you left off</a>"));
  for (const h of hrefs(m.html)) assert.equal(h, resume);
  const invited = recommenderReminderEmail(demoIntake, { status: "invited", daysLeft: 3 }, NOW, null, STUDENT_EMAIL);
  assert.equal(hrefs(invited.html).length, 0, "no button without a resume link");
});

test("reply_to: recommender mail replies go to the student's sign-in email; student mail has none", () => {
  assert.equal(inviteEmail(demoIntake, LINK, 18, STUDENT_EMAIL).replyTo, STUDENT_EMAIL);
  assert.equal(recommenderReminderEmail(demoIntake, { status: "invited", daysLeft: 3 }, NOW, null, STUDENT_EMAIL).replyTo, STUDENT_EMAIL);
  assert.equal(inviteEmail(demoIntake, LINK, 18, null).replyTo, undefined, "no stored email, no reply-to");
  assert.ok(!("replyTo" in completionEmail(demoIntake)));
  assert.ok(!("replyTo" in studentReminderEmail(demoIntake, due)));
  assert.deepEqual(replyToField("bad address"), {});
  assert.deepEqual(replyToField("a@b.co\r\nBcc: x@y.z"), {}, "no header injection");
  assert.deepEqual(replyToField(" a@b.co "), { replyTo: "a@b.co" });
});

test("every interpolated value is escaped in the HTML", () => {
  const all = [
    inviteEmail(hostile, LINK, 18, STUDENT_EMAIL),
    completionEmail(hostile),
    studentReminderEmail(hostile, { ...due, program: hostile.programs[0] }),
    recommenderReminderEmail(hostile, { status: "in-progress", daysLeft: 3 }, NOW, "https://reccer.app.space/recommender/interview?id=r1", STUDENT_EMAIL),
  ];
  for (const m of all) {
    for (const bad of ["<script", "<img", "<i>", "<b>", 'href="https://evil', "onerror=alert(1)>"]) {
      assert.ok(!m.html.includes(bad), `${m.subject}: unescaped ${bad}`);
    }
  }
  const inv = all[0];
  assert.ok(inv.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(inv.html.includes("&lt;a href=&quot;https://evil.example&quot;&gt;click&lt;/a&gt; &amp; &quot;quotes&quot;"));
  assert.equal(esc(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
});

test("custom note: quoted and attributed in the invite (text and HTML) when present, absent otherwise", () => {
  const withNote = { ...structuredClone(demoIntake), noteToRecommender: "Thank you for doing this.\nThe first deadline is in December." };
  const m = inviteEmail(withNote, LINK, 18, STUDENT_EMAIL);
  const who = demoIntake.preferredName || demoIntake.studentName;
  assert.ok(m.text.includes(`A note from ${who}:\n> Thank you for doing this.\n> The first deadline is in December.`), m.text);
  assert.ok(m.html.includes(`A note from ${esc(who)}:`));
  assert.ok(m.html.includes("<blockquote"));
  assert.ok(m.html.includes("Thank you for doing this.<br>The first deadline is in December."));

  for (const none of [undefined, "", "   \n  "]) {
    const plain = inviteEmail({ ...structuredClone(demoIntake), noteToRecommender: none }, LINK, 18, STUDENT_EMAIL);
    assert.ok(!plain.text.includes("A note from"));
    assert.ok(!plain.html.includes("A note from") && !plain.html.includes("<blockquote"));
    assert.ok(!plain.text.includes("\n\n\n"), "no empty gap where the note would be");
  }
  // Only the invite carries the note.
  for (const other of [completionEmail(withNote), studentReminderEmail(withNote, due),
    recommenderReminderEmail(withNote, { status: "in-progress", daysLeft: 3 }, NOW, LINK, STUDENT_EMAIL)]) {
    assert.ok(!other.text.includes("Thank you for doing this") && !other.html.includes("Thank you for doing this"));
  }
  assert.equal(cleanNote(`  a\r\nb  `), "a\nb");
  assert.equal(cleanNote("x".repeat(MAX_NOTE_CHARS + 50)).length, MAX_NOTE_CHARS);
});

test("student mail is status only: no answers, no letter content, in text or HTML", async () => {
  const w = makeWorld();
  const student = w.as("u_student", STUDENT_EMAIL);
  const { requestId } = await A.createRequest(student, structuredClone(demoIntake));
  await A.generateQuestions(student, { requestId });
  await A.sendInvite(student, { requestId });
  const rec = w.as("u_rec", demoIntake.recommenderEmail);
  await A.claimInvite(rec, { token: /token=([0-9a-f]{64})/.exec(w.outbox[0].text)![1] });
  const { questions } = await A.getInterview(rec, { requestId });
  for (const q of questions) {
    const a = fixtureAnswers[q.id];
    if (a && a !== "SKIPPED") await A.saveAnswer(rec, { requestId, questionId: q.id, text: a.text });
  }
  await A.finishInterview(rec, { requestId });
  const done = w.outbox.at(-1)!;
  assert.equal(done.to, STUDENT_EMAIL);
  assert.equal(done.replyTo, undefined);
  assert.ok(done.html);
  for (const q of questions) {
    const a = fixtureAnswers[q.id];
    if (!a || a === "SKIPPED") continue;
    const snippet = a.text.slice(0, 40);
    assert.ok(!done.text.includes(snippet) && !visibleText(done.html!).includes(esc(snippet)), `leaks answer to ${q.id}`);
  }
});

// ---------- the note through the action logic ----------

const NOTE = "Thank you so much. My CMU deadline is first, December 1.";

test("note: stored with the intake, editable until the invite goes out, emailed with reply-to set", async () => {
  const w = makeWorld({ llm: () => null });
  const student = w.as("u_student", STUDENT_EMAIL);
  const { requestId } = await A.createRequest(student, { ...structuredClone(demoIntake), noteToRecommender: `  ${NOTE}\r\n` });
  assert.equal((await A.getMyRequestIntake(student, { requestId })).intake.noteToRecommender, NOTE, "trimmed and normalized");
  await A.generateQuestions(student, { requestId });

  const edited = { ...(await A.getMyRequestIntake(student, { requestId })).intake, noteToRecommender: `${NOTE} See you soon.` };
  const u = await A.updateIntake(student, { requestId, intake: edited });
  assert.equal(u.questionsStale, false, "the note does not affect the questions");

  await A.sendInvite(student, { requestId });
  const invite = w.outbox[0];
  assert.equal(invite.to, demoIntake.recommenderEmail);
  assert.equal(invite.replyTo, STUDENT_EMAIL);
  assert.ok(invite.text.includes(`> ${NOTE} See you soon.`));
  assert.ok(invite.html!.includes(esc(`${NOTE} See you soon.`)));
  await assert.rejects(A.updateIntake(student, { requestId, intake: { ...edited, noteToRecommender: "changed" } }), { code: "conflict" }, "locked once the invite is sent");

  const rec = w.as("u_rec", demoIntake.recommenderEmail);
  await A.claimInvite(rec, { token: /token=([0-9a-f]{64})/.exec(invite.text)![1] });
  const iv = await A.getInterview(rec, { requestId });
  assert.equal(iv.noteFromStudent, `${NOTE} See you soon.`);
  assert.ok(!JSON.stringify(iv.questions).includes("See you soon"), "never in the questions");
});

test("note: validated and capped; non-text is refused; blank is dropped", async () => {
  const w = makeWorld();
  const student = w.as("u_student", STUDENT_EMAIL);
  await assert.rejects(A.createRequest(student, { ...structuredClone(demoIntake), noteToRecommender: "x".repeat(MAX_NOTE_CHARS + 1) }),
    (e: A.ActionError) => e.code === "invalid" && e.message.includes("1,000"));
  await assert.rejects(A.createRequest(student, { ...structuredClone(demoIntake), noteToRecommender: { html: "<b>" } as unknown as string }), { code: "invalid" });
  const ok = await A.createRequest(student, { ...structuredClone(demoIntake), noteToRecommender: "x".repeat(MAX_NOTE_CHARS) });
  assert.equal((await A.getMyRequestIntake(student, { requestId: ok.requestId })).intake.noteToRecommender!.length, MAX_NOTE_CHARS);
  const blank = await A.createRequest(student, { ...structuredClone(demoIntake), noteToRecommender: "   " });
  assert.ok(!("noteToRecommender" in (await A.getMyRequestIntake(student, { requestId: blank.requestId })).intake));
});

test("note: never sent to the model, never in the questions or the letter", async () => {
  const w = makeWorld({ llm: () => "not json" }); // both calls run, then fall back
  const student = w.as("u_student", STUDENT_EMAIL);
  const { requestId } = await A.createRequest(student, { ...structuredClone(demoIntake), noteToRecommender: NOTE });
  const { questions } = await A.generateQuestions(student, { requestId });
  await A.sendInvite(student, { requestId });
  const rec = w.as("u_rec", demoIntake.recommenderEmail);
  await A.claimInvite(rec, { token: /token=([0-9a-f]{64})/.exec(w.outbox[0].text)![1] });
  for (const q of questions) {
    const a = fixtureAnswers[q.id];
    if (a && a !== "SKIPPED") await A.saveAnswer(rec, { requestId, questionId: q.id, text: a.text });
  }
  await A.finishInterview(rec, { requestId });
  assert.equal(w.llmCalls.length, 2, "question generation and assembly both ran");
  for (const call of w.llmCalls) assert.ok(!JSON.stringify(call).includes("CMU deadline"), "note reached the model");
  assert.ok(!JSON.stringify(questions).includes("CMU deadline"));
  const draft = await A.getDraft(rec, { requestId });
  assert.ok(!JSON.stringify(draft.letters).includes("CMU deadline"));
});
