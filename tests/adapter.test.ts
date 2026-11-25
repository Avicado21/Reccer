// The DeepSpace adapter (src/actions/deepspace.ts) against a fake ActionTools that
// mimics the RecordRoom storage rules verified in deepspace/dist/worker.js 0.44.2:
// envelopes { recordId, data }, booleans stored as 0/1, nulls omitted on read,
// JSON columns round-tripped, uniqueOn duplicates refused with "Duplicate: ...".
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ActionContext, ActionResult, ActionTools } from "deepspace/worker";
import {
  reccerActions, unwrap, anthropicBody, completionText, emailFromVerifiedJwt, cronRuntime, testRecipientsOnly, type AdapterEnv,
} from "../src/actions/deepspace";
import * as L from "../src/actions/logic";
import { tasks as cronTasks, DEADLINE_REMINDERS_TASK } from "../src/cron";
import { BOOLEAN_COLUMNS, reccerSchemas } from "../src/schemas/reccer-schemas";
import { schemas } from "../src/schemas";
import { rememberClaimToken, pendingClaimUrl, clearPendingClaim, CLAIM_PATH } from "../src/lib/claimReturn";
import { intake as demoIntake } from "../fixtures/demo";

type Stored = { recordId: string; data: Record<string, unknown>; createdBy: string; createdAt: string; updatedAt: string };

function fakeWorld(opts: { llm?: (body: any) => ActionResult<unknown> } = {}) {
  const tables = new Map<string, Map<string, Stored>>();
  const unique = Object.fromEntries(reccerSchemas.map((s) => [s.name, s.uniqueOn ?? []]));
  const mail: any[] = [];
  const llmBodies: any[] = [];
  let seq = 0;
  const table = (c: string) => tables.get(c) ?? tables.set(c, new Map()).get(c)!;
  const columns = Object.fromEntries(reccerSchemas.map((s) => [s.name, new Set(s.columns.map((c) => c.name))]));
  const store = (c: string, data: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(structuredClone(data))) {
      if (v === null || v === undefined) continue;
      if (columns[c] && !columns[c].has(k)) continue; // undeclared fields are silently dropped, as in the RecordRoom
      out[k] = (BOOLEAN_COLUMNS[c] ?? []).includes(k) ? (v ? 1 : 0) : v;
    }
    return out;
  };
  const dup = (c: string, data: Record<string, unknown>, self?: string) =>
    unique[c]?.length && [...table(c).values()].some((r) => r.recordId !== self && unique[c].every((f) => r.data[f] === data[f]));

  const toolsFor = (userId: string): ActionTools => ({
    async create(c, data) {
      const d = store(c, data);
      if (dup(c, d)) return { success: false, error: `Duplicate: a record already exists in ${c}` };
      const recordId = `r${++seq}`;
      const now = new Date().toISOString();
      table(c).set(recordId, { recordId, data: d, createdBy: userId, createdAt: now, updatedAt: now });
      return { success: true, data: { recordId } };
    },
    async update(c, id, patch) {
      const r = table(c).get(id);
      if (!r) return { success: false, error: "Record not found" };
      const merged = { ...r.data, ...patch };
      const d = store(c, merged as Record<string, unknown>);
      if (dup(c, d, id)) return { success: false, error: "Duplicate" };
      r.data = d;
      return { success: true, data: { recordId: id } };
    },
    async get(c, id) {
      const r = table(c).get(id);
      return r ? { success: true, data: { record: structuredClone(r) as any } } : { success: false, error: "Record not found" };
    },
    async query(c, o) {
      const rows = [...table(c).values()].filter((r) => Object.entries(o?.where ?? {}).every(([k, v]) => r.data[k] === v));
      return { success: true, data: { records: structuredClone(rows) as any, count: rows.length } };
    },
    async remove() { return { success: false, error: "unused" }; },
    async deleteWhere() { return { success: false, error: "unused" }; },
    async registerUser() { return { success: false, error: "unused" }; },
    async integration(endpoint: string, body?: any) {
      if (endpoint === "email/send") { mail.push(body); return { success: true, data: { id: "m" } }; }
      if (endpoint === "anthropic/chat-completion") {
        llmBodies.push(body);
        return (opts.llm?.(body) ?? { success: false, error: "llm off in test" }) as any;
      }
      return { success: false, error: `unknown ${endpoint}` };
    },
  });

  const jwt = (email: string) => `h.${Buffer.from(JSON.stringify({ sub: "x", email })).toString("base64url")}.s`;
  async function call(name: string, user: { id: string; email: string } | null, params: Record<string, unknown> = {}, env: AdapterEnv = { APP_NAME: "reccer" }) {
    const ctx = { userId: user?.id ?? "anon-123", params, tools: toolsFor(user?.id ?? "anon-123"), env, callerJwt: user ? jwt(user.email) : "" } as ActionContext<AdapterEnv>;
    return (await reccerActions[name](ctx)) as any;
  }
  /** The SDK's CronContext over the same tables (records via the RBAC-off tools API; email billed to the owner). */
  const cron = {
    ownerUserId: "owner",
    records: {
      async query(c: string, o?: { where?: Record<string, unknown>; limit?: number }) {
        const rows = [...table(c).values()].filter((r) => Object.entries(o?.where ?? {}).every(([k, v]) => (k === "recordId" ? r.recordId === v : r.data[k] === v)));
        return structuredClone(o?.limit ? rows.slice(0, o.limit) : rows);
      },
      async create(c: string, data: Record<string, unknown>) { return (await toolsFor("owner").create(c, data) as any).data; },
      async update(c: string, id: string, data: Record<string, unknown>) { return (await toolsFor("owner").update(c, id, data) as any).data; },
      async delete() { throw new Error("unused"); },
    },
    integrations: {
      async call(endpoint: string, body?: any) {
        if (endpoint !== "email/send") throw new Error(`unexpected ${endpoint}`);
        if (String(body?.to).includes("bounce")) throw new Error("Integration call email/send failed: bounced");
        mail.push(body);
        return { id: "m" };
      },
    },
  };
  return { tables, mail, llmBodies, call, table, cron };
}

const STUDENT = { id: "u-student", email: "student@example.test" };
const REC = { id: "u-rec", email: "rec@example.test" };
const OTHER = { id: "u-other", email: "other@example.test" };
const intake = () => structuredClone({ ...demoIntake, recommenderEmail: REC.email });

test("schemas: users kept, every Reccer collection is client-none for every role", () => {
  assert.ok(schemas.some((s) => s.name === "users"));
  for (const s of reccerSchemas) {
    for (const [role, p] of Object.entries(s.permissions)) {
      assert.deepEqual(p, { read: false, create: false, update: false, delete: false }, `${s.name}/${role}`);
    }
    assert.ok(s.permissions["*"], `${s.name} has a catch-all deny`);
  }
  // Fields logic.ts writes must be real columns, or the RecordRoom silently drops them.
  const cols = (n: string) => reccerSchemas.find((s) => s.name === n)!.columns.map((c) => c.name);
  assert.ok(cols("requests").includes("studentEmail"));
  assert.ok(cols("invites").includes("claimedEmail"));
});

test("unwrap flattens envelopes and turns stored 0/1 booleans back into booleans", () => {
  assert.deepEqual(unwrap("answers", { recordId: "a1", data: { text: "hi", skipped: 0 } }), { id: "a1", text: "hi", skipped: false });
  assert.deepEqual(unwrap("questionSets", { recordId: "q1", data: { frozen: 1 } }), { id: "q1", frozen: true });
  // A data field named id cannot shadow the record id.
  assert.equal(unwrap("requests", { recordId: "r1", data: { id: "spoof" } }).id, "r1");
});

test("anthropic body puts system prompts in `system`; text comes from content blocks", () => {
  const b = anthropicBody([{ role: "system", content: "S" }, { role: "user", content: "U" }]);
  assert.equal(b.model, "claude-sonnet-5-5");
  assert.equal(b.system, "S");
  assert.deepEqual(b.messages, [{ role: "user", content: "U" }]);
  assert.equal(completionText({ content: [{ type: "text", text: "a" }, { type: "tool_use" }, { type: "text", text: "b" }] }), "ab");
  assert.equal(completionText({ content: [] }), null);
  assert.equal(completionText({ choices: [{ message: { content: "x" } }] }), "x");
  assert.equal(completionText(null), null);
});

test("email comes from the verified token's claims", () => {
  const t = `h.${Buffer.from(JSON.stringify({ email: "a@b.c" })).toString("base64url")}.s`;
  assert.equal(emailFromVerifiedJwt(t), "a@b.c");
  assert.equal(emailFromVerifiedJwt("garbage"), null);
});

test("anonymous callers are signed out; errors map to { success:false, code }", async () => {
  const w = fakeWorld();
  assert.deepEqual(await w.call("listMyRequests", null), { success: false, code: "unauthenticated", error: "Sign in to continue." });
  const r = await w.call("getInterview", STUDENT, { requestId: "nope" });
  assert.equal(r.code, "not_found");
  // A non-string id never reaches the record tools.
  assert.equal((await w.call("getDraft", STUDENT, { requestId: { $ne: 1 } })).code, "not_found");
});

test("full path through the adapter: envelopes, booleans, emails, permissions", async () => {
  const w = fakeWorld({
    // The model answers, but not with usable JSON: both calls must fall back.
    llm: () => ({ success: true, data: { content: [{ type: "text", text: "not json" }] } }),
  });
  const c = await w.call("createRequest", STUDENT, intake());
  assert.equal(c.success, true, JSON.stringify(c));
  const requestId = c.data.requestId;
  const stored = w.table("requests").get(requestId)!;
  assert.equal(stored.data.studentUserId, STUDENT.id);
  assert.equal(stored.data.studentEmail, STUDENT.email);

  const g = await w.call("generateQuestions", STUDENT, { requestId });
  assert.equal(g.success, true);
  assert.equal(g.data.source, "default"); // unreadable model output falls back
  assert.equal(w.llmBodies.length, 1);
  assert.ok(w.llmBodies[0].system && w.llmBodies[0].messages.every((m: any) => m.role !== "system"));

  const inv = await w.call("sendInvite", STUDENT, { requestId });
  assert.equal(inv.success, true);
  assert.doesNotMatch(JSON.stringify(inv), /token/i);
  const link = w.mail[0].text.match(/https:\/\/reccer\.app\.space\/recommender\/claim\?token=([A-Za-z0-9_-]+)/);
  assert.ok(link, w.mail[0].text);
  assert.equal(w.mail[0].to, REC.email);
  // Stored boolean is 0/1, read back as frozen=true: removing a question is now refused.
  const qs = [...w.table("questionSets").values()][0];
  assert.equal(qs.data.frozen, 1);
  assert.equal((await w.call("removeQuestion", STUDENT, { requestId, questionId: "D1" })).code, "conflict");

  assert.equal((await w.call("claimInvite", STUDENT, { token: link[1] })).code, "forbidden");
  assert.equal((await w.call("claimInvite", REC, { token: link[1] })).success, true);
  assert.equal((await w.call("claimInvite", OTHER, { token: link[1] })).code, "conflict");

  const iv = await w.call("getInterview", REC, { requestId });
  assert.equal(iv.success, true);
  const firstQ = iv.data.questions[0].id;
  assert.equal((await w.call("saveAnswer", REC, { requestId, questionId: firstQ, text: "I supervised Jordan for a year." })).success, true);
  assert.equal((await w.call("saveAnswer", REC, { requestId, questionId: firstQ, text: "I supervised Jordan for one year." })).success, true);
  assert.equal((await w.call("saveAnswer", REC, { requestId, questionId: iv.data.questions[1].id, skipped: true })).success, true);
  assert.equal(w.table("answers").size, 2); // second save of the same question updated, not duplicated
  const again = await w.call("getInterview", REC, { requestId });
  assert.deepEqual(again.data.answers[firstQ], { text: "I supervised Jordan for one year.", followUp: undefined });
  assert.equal(again.data.answers[iv.data.questions[1].id], "SKIPPED");

  const fin = await w.call("finishInterview", REC, { requestId });
  assert.equal(fin.success, true);
  assert.equal(fin.data.mode, "deterministic");
  assert.equal(w.mail.at(-1).to, STUDENT.email); // completion email, status only
  assert.doesNotMatch(w.mail.at(-1).text, /supervised Jordan/);

  const d = await w.call("getDraft", REC, { requestId });
  assert.equal(d.success, true);
  assert.ok(d.data.letters.length >= 1);
  for (const n of ["getDraft", "getInterview"]) assert.equal((await w.call(n, STUDENT, { requestId })).code, "forbidden");
  assert.equal((await w.call("saveEdit", STUDENT, { requestId, paragraph: 0, sentence: 0, text: "x" })).code, "forbidden");
  assert.equal((await w.call("listMyRequests", STUDENT)).data[0].status, "finished");
});

test("APP_URL overrides the link base; trailing slash is dropped", async () => {
  const w = fakeWorld();
  const c = await w.call("createRequest", STUDENT, intake());
  await w.call("generateQuestions", STUDENT, { requestId: c.data.requestId });
  await w.call("sendInvite", STUDENT, { requestId: c.data.requestId }, { APP_NAME: "reccer", APP_URL: "http://localhost:5173/" });
  assert.match(w.mail[0].text, /http:\/\/localhost:5173\/recommender\/claim\?token=/);
});

test("claim token survives the sign-in round trip, once", () => {
  const m = new Map<string, string>();
  const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  rememberClaimToken("/home", "?token=abc", s, 0);
  assert.equal(m.size, 0, "only the claim page stores a token");
  rememberClaimToken(CLAIM_PATH, "?token=abc", s, 1000);
  assert.equal(pendingClaimUrl(CLAIM_PATH, s, 2000), null, "no redirect from the claim page itself");
  assert.equal(pendingClaimUrl("/home", s, 2000), `${CLAIM_PATH}?token=abc`);
  assert.equal(pendingClaimUrl("/home", s, 3000), null, "consumed");
  rememberClaimToken(CLAIM_PATH, "?token=old", s, 0);
  assert.equal(pendingClaimUrl("/home", s, 2 * 60 * 60 * 1000), null, "stale tokens are dropped");
  rememberClaimToken(CLAIM_PATH, "?token=x", s, 0);
  clearPendingClaim(s);
  assert.equal(pendingClaimUrl("/home", s, 1), null);
});

test("dev outbox: only under ALLOW_DEBUG_ROUTES=true, only @deepspace.test, only for the recipient", async () => {
  const { captureDevMail, devMailFor } = await import("../src/server/dev-outbox");
  const msg = { to: "Rec-1@deepspace.test", subject: "s", text: "t" };
  assert.equal(captureDevMail({}, msg), false, "deployed apps never capture");
  assert.equal(captureDevMail({ ALLOW_DEBUG_ROUTES: "1" }, msg), false);
  assert.equal(captureDevMail({ ALLOW_DEBUG_ROUTES: "true" }, { ...msg, to: "real@example.com" }), false, "real inboxes get real mail");
  assert.equal(captureDevMail({ ALLOW_DEBUG_ROUTES: "true" }, msg), true);
  assert.equal(devMailFor("rec-1@deepspace.test").length, 1);
  assert.equal(devMailFor("student@deepspace.test").length, 0);
});

// ---------- stage 2: new actions, new columns, the scheduled job ----------

const tokenIn = (text: string) => text.match(/claim\?token=([A-Za-z0-9_-]+)/)![1];

test("stage 2 columns exist, so the RecordRoom keeps what logic.ts writes", () => {
  const cols = (n: string) => reccerSchemas.find((s) => s.name === n)!.columns.map((c) => c.name);
  for (const c of ["remindersSent"]) assert.ok(cols("requests").includes(c), `requests.${c}`);
  for (const c of ["stale", "frozen"]) assert.ok(cols("questionSets").includes(c), `questionSets.${c}`);
  for (const c of ["sentAt", "cancelledAt", "replacedAt", "claimedEmail"]) assert.ok(cols("invites").includes(c), `invites.${c}`);
  for (const c of ["edits", "notes"]) assert.ok(cols("drafts").includes(c), `drafts.${c}`);
  assert.deepEqual(BOOLEAN_COLUMNS.questionSets.sort(), ["frozen", "stale"]);
});

test("new actions are registered; the reminder job is not a client action", () => {
  for (const n of ["getMyRequestIntake", "updateIntake", "cancelInvite", "sendInvite"]) assert.equal(typeof reccerActions[n], "function", n);
  assert.equal(reccerActions.sendDeadlineReminders, undefined);
  assert.equal(Object.keys(reccerActions).some((n) => /remind|cron/i.test(n)), false);
});

test("reopen and edit, cancel and resend, through the adapter with undeclared fields dropped", async () => {
  const w = fakeWorld();
  const { data: { requestId } } = await w.call("createRequest", STUDENT, intake());
  await w.call("generateQuestions", STUDENT, { requestId });

  const mine = await w.call("getMyRequestIntake", STUDENT, { requestId });
  assert.equal(mine.success, true, JSON.stringify(mine));
  assert.equal(mine.data.editable, true);
  assert.equal((await w.call("getMyRequestIntake", OTHER, { requestId })).code, "forbidden");

  // A question-affecting edit: the stale flag must survive the 0/1 round trip.
  const up = await w.call("updateIntake", STUDENT, { requestId, intake: { ...mine.data.intake, preferredName: "Jo" } });
  assert.equal(up.data.questionsStale, true);
  assert.equal([...w.table("questionSets").values()][0].data.stale, 1);
  assert.equal((await w.call("getMyRequestIntake", STUDENT, { requestId })).data.questionsStale, true);
  assert.equal((await w.call("sendInvite", STUDENT, { requestId })).code, "conflict");
  await w.call("generateQuestions", STUDENT, { requestId });

  // Send, resend: the first link is superseded (replacedAt must persist), the second works.
  assert.equal((await w.call("sendInvite", STUDENT, { requestId })).success, true);
  const first = tokenIn(w.mail.at(-1).text);
  assert.equal((await w.call("sendInvite", STUDENT, { requestId })).success, true);
  const second = tokenIn(w.mail.at(-1).text);
  const status = (await w.call("listMyRequests", STUDENT)).data[0].invite;
  assert.equal(status.sendCount, 2);
  assert.match(status.sentAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(status.claimed, false);
  const stale = await w.call("claimInvite", REC, { token: first });
  assert.equal(stale.code, "invalid");
  assert.match(stale.error, /newer invite/);

  // Cancel: the live link stops working (cancelledAt must persist) and the request unlocks.
  assert.equal((await w.call("cancelInvite", OTHER, { requestId })).code, "forbidden");
  assert.equal((await w.call("cancelInvite", STUDENT, { requestId })).success, true);
  assert.match((await w.call("claimInvite", REC, { token: second })).error, /cancelled/);
  const unlocked = await w.call("getMyRequestIntake", STUDENT, { requestId });
  assert.equal(unlocked.data.editable, true);
  assert.equal(unlocked.data.questionsFrozen, false);
  assert.equal((await w.call("updateIntake", STUDENT, { requestId, intake: { ...unlocked.data.intake, recommenderName: "Dr. Nair" } })).success, true);

  await w.call("sendInvite", STUDENT, { requestId });
  assert.equal((await w.call("claimInvite", REC, { token: tokenIn(w.mail.at(-1).text) })).success, true);
  const claimed = (await w.call("listMyRequests", STUDENT)).data[0];
  assert.equal(claimed.invite.claimed, true);
  assert.doesNotMatch(JSON.stringify(claimed), /rec@example|u-rec|tokenHash/);
  assert.equal((await w.call("updateIntake", STUDENT, { requestId, intake: unlocked.data.intake })).code, "conflict");
});

test("edits by sentence id and finish notes persist through the adapter", async () => {
  const w = fakeWorld();
  const { data: { requestId } } = await w.call("createRequest", STUDENT, intake());
  await w.call("generateQuestions", STUDENT, { requestId });
  await w.call("sendInvite", STUDENT, { requestId });
  await w.call("claimInvite", REC, { token: tokenIn(w.mail.at(-1).text) });
  await w.call("saveAnswer", REC, { requestId, questionId: "F1", text: "I am Priya Nair, a principal engineer." });
  await w.call("saveAnswer", REC, { requestId, questionId: "F3", text: "I recommend Jordan because they check their work." });
  await w.call("finishInterview", REC, { requestId });
  let d = (await w.call("getDraft", REC, { requestId })).data;
  assert.ok(d.notes.length >= 1, "the fallback note was stored (drafts.notes)");
  const f1 = d.assembly.paragraphs[0].sentences.find((s: any) => s.sources.includes("F1"));
  assert.equal((await w.call("saveEdit", REC, { requestId, sentenceId: f1.id, text: "I am Dr. Priya Nair, principal engineer." })).success, true);
  assert.equal((await w.call("finishInterview", REC, { requestId })).data.keptEdits, 1);
  d = (await w.call("getDraft", REC, { requestId })).data;
  assert.equal(d.edits[f1.id], "I am Dr. Priya Nair, principal engineer.");
  assert.equal((await w.call("saveEdit", STUDENT, { requestId, sentenceId: f1.id, text: "x" })).code, "forbidden");
});

test("scheduled job: daily task, cron Runtime over the RecordRoom, reminders marked once", async () => {
  assert.deepEqual(cronTasks, [{ name: DEADLINE_REMINDERS_TASK, schedule: "0 9 * * *", timezone: "America/New_York" }]);
  const w = fakeWorld();
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const i = { ...intake(), programs: intake().programs.map((p: any) => ({ ...p, dueDate: soon })) };
  const { data: { requestId } } = await w.call("createRequest", STUDENT, i);
  await w.call("generateQuestions", STUDENT, { requestId });
  await w.call("sendInvite", STUDENT, { requestId });
  const before = w.mail.length;

  const rt = cronRuntime(w.cron as any, { APP_NAME: "reccer" });
  assert.equal(rt.system, true);
  assert.equal(rt.userId, null);
  assert.equal((await rt.db.get("requests", requestId))?.id, requestId, "get by recordId");
  const res = await L.sendDeadlineReminders(rt);
  assert.equal(res.checked, 1);
  assert.deepEqual(res.sent.map((x) => x.to).sort(), ["recommender", "student"]);
  assert.deepEqual(w.mail.slice(before).map((m) => m.to).sort(), [REC.email, STUDENT.email].sort());
  assert.equal((w.table("requests").get(requestId)!.data.remindersSent as string[]).length, 2, "requests.remindersSent persisted");
  assert.equal((await L.sendDeadlineReminders(rt)).sent.length, 0, "not sent twice in one window");

  // A client-built runtime can never run it.
  const clientRt = { ...rt, system: undefined };
  await assert.rejects(L.sendDeadlineReminders(clientRt), { code: "forbidden" });
});

test("scheduled job: a failed send is reported, not marked; the dev filter skips real inboxes", async () => {
  const w = fakeWorld();
  const soon = new Date(Date.now() + 1 * 86_400_000).toISOString().slice(0, 10);
  const i = { ...intake(), recommenderEmail: "bounce@example.test", programs: intake().programs.map((p: any) => ({ ...p, dueDate: soon })) };
  const { data: { requestId } } = await w.call("createRequest", STUDENT, i);
  await w.call("generateQuestions", STUDENT, { requestId });
  await w.call("sendInvite", STUDENT, { requestId }, { APP_NAME: "reccer" });
  const rt = cronRuntime(w.cron as any, { APP_NAME: "reccer" });

  const dev = await L.sendDeadlineReminders(testRecipientsOnly(rt));
  assert.equal(dev.sent.length, 0, "no @deepspace.test recipients here");
  assert.ok(dev.failed.every((f) => /not a test address/.test(f.error)));
  assert.equal(w.table("requests").get(requestId)!.data.remindersSent, undefined, "skipped sends are not marked");

  const real = await L.sendDeadlineReminders(rt);
  assert.deepEqual(real.sent.map((x) => x.to), ["student"]);
  assert.match(real.failed[0].error, /bounced/);
});
