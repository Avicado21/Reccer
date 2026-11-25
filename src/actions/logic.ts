// All Reccer server-side behavior, written against a small Runtime interface.
// deepspace.ts adapts the real SDK to this interface; tests use an in-memory runtime.
// Every permission rule lives here, in code, so it does not depend on how expressive
// the SDK's collection permissions turn out to be.

import {
  buildQuestionSet, defaultMiddle, validateGeneratedQuestions, parseModelJson,
  questionGenerationMessages, assemblyMessages, validateAssembly, deterministicAssembly,
  claimCheck, buildLetters, buildFormAnswers, newInviteToken, hashToken, inviteEmail, completionEmail,
  type Answers, type Assembly, type ChatMessage, type Flag, type Question, type StudentIntake,
} from "../core/index";
import { MAX_ASSEMBLIES, MAX_GENERATIONS, INVITE_TTL_DAYS } from "../integrations";

// ---------- Runtime interface ----------

export type Coll = "requests" | "questionSets" | "invites" | "answers" | "drafts";
export interface Row { id: string; [k: string]: unknown }

export interface Runtime {
  /** From a verified JWT only. Never from the request body. */
  userId: string | null;
  userEmail: string | null;
  now(): Date;
  appUrl: string; // "https://reccer.app.space"
  db: {
    get(c: Coll, id: string): Promise<Row | null>;
    find(c: Coll, where: Record<string, unknown>): Promise<Row[]>;
    create(c: Coll, data: Record<string, unknown>): Promise<string>;
    put(c: Coll, id: string, patch: Record<string, unknown>): Promise<void>;
  };
  llm(messages: ChatMessage[]): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  email(msg: { to: string; subject: string; text: string }): Promise<{ ok: boolean; error?: string }>;
}

export class ActionError extends Error {
  constructor(public code: "unauthenticated" | "forbidden" | "not_found" | "invalid" | "limit" | "conflict", message: string) {
    super(message);
  }
}

// ---------- guards ----------

function requireUser(rt: Runtime): string {
  if (!rt.userId) throw new ActionError("unauthenticated", "Sign in to continue.");
  return rt.userId;
}

async function loadRequest(rt: Runtime, requestId: string): Promise<Row> {
  const r = await rt.db.get("requests", requestId);
  if (!r) throw new ActionError("not_found", "This request does not exist.");
  return r;
}

/** The student who created the request. */
async function asStudent(rt: Runtime, requestId: string) {
  const uid = requireUser(rt);
  const r = await loadRequest(rt, requestId);
  if (r.studentUserId !== uid) throw new ActionError("forbidden", "Only the student who created this request can do that.");
  return r;
}

/** The recommender who claimed the invite. The student is never allowed through here. */
async function asRecommender(rt: Runtime, requestId: string) {
  const uid = requireUser(rt);
  const r = await loadRequest(rt, requestId);
  if (!r.recommenderUserId || r.recommenderUserId !== uid) throw new ActionError("forbidden", "Only the invited recommender can open this.");
  return r;
}

const intakeOf = (r: Row) => r.intake as StudentIntake;

async function questionSetOf(rt: Runtime, requestId: string): Promise<Row | null> {
  return (await rt.db.find("questionSets", { requestId }))[0] ?? null;
}

async function answersOf(rt: Runtime, requestId: string): Promise<Answers> {
  const rows = await rt.db.find("answers", { requestId });
  const out: Answers = {};
  for (const a of rows) {
    out[a.questionId as string] = a.skipped ? "SKIPPED" : { text: a.text as string, followUp: (a.followUp as string) || undefined };
  }
  return out;
}

// ---------- intake validation ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateIntake(i: StudentIntake): string[] {
  const e: string[] = [];
  if (!i?.studentName?.trim()) e.push("Add your full name.");
  if (!i?.recommenderName?.trim()) e.push("Add your recommender's name.");
  if (!EMAIL_RE.test(i?.recommenderEmail ?? "")) e.push("Add a valid email for your recommender.");
  if (!i?.relationship?.trim()) e.push("Describe how you know your recommender.");
  if (!Array.isArray(i?.programs) || i.programs.length === 0) e.push("Add at least one program.");
  i?.programs?.forEach((p, n) => {
    if (!p.school?.trim() || !p.name?.trim()) e.push(`Program ${n + 1}: add the school and program name.`);
    if (!DATE_RE.test(p.dueDate ?? "")) e.push(`Program ${n + 1}: add a due date.`);
  });
  if ((i?.factSheet ?? "").length > 8000) e.push("Shorten the background notes to under 8,000 characters.");
  return e;
}

// ---------- student actions ----------

export async function createRequest(rt: Runtime, intake: StudentIntake) {
  const uid = requireUser(rt);
  const errors = validateIntake(intake);
  if (errors.length) throw new ActionError("invalid", errors.join(" "));
  intake.programs = intake.programs.map((p, n) => ({ ...p, id: p.id || `p${n + 1}` }));
  const id = await rt.db.create("requests", {
    studentUserId: uid, studentEmail: rt.userEmail, recommenderUserId: null,
    intake, status: "draft-intake", generationCount: 0, createdAt: rt.now().toISOString(),
  });
  return { requestId: id };
}

/** LLM call 1, with validation and a default-bank fallback. Generation never blocks the flow. */
export async function generateQuestions(rt: Runtime, { requestId }: { requestId: string }) {
  const r = await asStudent(rt, requestId);
  const existing = await questionSetOf(rt, requestId);
  if (existing?.frozen) throw new ActionError("conflict", "The invite is sent, so the questions are locked.");
  const count = (r.generationCount as number) ?? 0;
  const intake = intakeOf(r);

  let middle: Question[] = defaultMiddle(intake);
  let source: "generated" | "default" = "default";
  let notes: string[] = [];

  if (count >= MAX_GENERATIONS) {
    notes = [`Question generation is limited to ${MAX_GENERATIONS} tries per request. Using the standard questions.`];
  } else {
    await rt.db.put("requests", requestId, { generationCount: count + 1 });
    const res = await rt.llm(questionGenerationMessages(intake));
    if (res.ok) {
      try {
        const v = validateGeneratedQuestions(parseModelJson(res.text), intake);
        notes = v.errors;
        if (v.ok) { middle = v.questions; source = "generated"; }
        else notes.push("Not enough usable questions were generated. Using the standard questions.");
      } catch (err) {
        notes = [`The generated questions could not be read (${(err as Error).message}). Using the standard questions.`];
      }
    } else {
      notes = [`Question generation is unavailable (${res.error}). Using the standard questions.`];
    }
  }

  const questions = buildQuestionSet(intake, middle);
  if (existing) await rt.db.put("questionSets", existing.id, { questions, source });
  else await rt.db.create("questionSets", { requestId, questions, source, frozen: false });
  await rt.db.put("requests", requestId, { status: "questions-ready" });
  return { questions, source, notes };
}

/** The student may remove generated or default questions before inviting. Fixed ones stay. */
export async function removeQuestion(rt: Runtime, { requestId, questionId }: { requestId: string; questionId: string }) {
  await asStudent(rt, requestId);
  const qs = await questionSetOf(rt, requestId);
  if (!qs) throw new ActionError("not_found", "Generate questions first.");
  if (qs.frozen) throw new ActionError("conflict", "The invite is sent, so the questions are locked.");
  const questions = qs.questions as Question[];
  const target = questions.find((q) => q.id === questionId);
  if (!target) throw new ActionError("not_found", "That question is not in the set.");
  if (target.source === "fixed") throw new ActionError("forbidden", "This question is required and cannot be removed.");
  const next = questions.filter((q) => q.id !== questionId);
  await rt.db.put("questionSets", qs.id, { questions: next });
  return { questions: next };
}

/** Freezes the questions, emails the recommender. The token is never returned to the student. */
export async function sendInvite(rt: Runtime, { requestId }: { requestId: string }) {
  const r = await asStudent(rt, requestId);
  const qs = await questionSetOf(rt, requestId);
  if (!qs) throw new ActionError("invalid", "Generate or choose questions before inviting.");
  if (r.recommenderUserId) throw new ActionError("conflict", "Your recommender has already accepted this invite.");
  const intake = intakeOf(r);
  const token = newInviteToken();
  const expires = new Date(rt.now().getTime() + INVITE_TTL_DAYS * 86_400_000);
  // Resending replaces any earlier unclaimed invite.
  for (const old of await rt.db.find("invites", { requestId })) {
    if (!old.claimedBy) await rt.db.put("invites", old.id, { expiresAt: rt.now().toISOString() });
  }
  await rt.db.create("invites", {
    requestId, email: intake.recommenderEmail, tokenHash: await hashToken(token),
    expiresAt: expires.toISOString(), claimedBy: null, claimedAt: null,
  });
  const mail = inviteEmail(intake, `${rt.appUrl}/recommender/claim?token=${token}`, (qs.questions as Question[]).length);
  const sent = await rt.email({ to: intake.recommenderEmail, ...mail });
  if (!sent.ok) throw new ActionError("invalid", `The invite email could not be sent (${sent.error ?? "unknown error"}). Check the address and try again.`);
  await rt.db.put("questionSets", qs.id, { frozen: true });
  await rt.db.put("requests", requestId, { status: "invited" });
  return { sentTo: intake.recommenderEmail };
}

/** Status only. No answers, no draft, no letter. */
export async function listMyRequests(rt: Runtime) {
  const uid = requireUser(rt);
  const rows = await rt.db.find("requests", { studentUserId: uid });
  return rows.map((r) => {
    const i = intakeOf(r);
    return {
      requestId: r.id, recommenderName: i.recommenderName, status: r.status as string,
      programs: i.programs.map((p) => ({ name: p.name, school: p.school, dueDate: p.dueDate })),
    };
  });
}

// ---------- recommender actions ----------

export async function claimInvite(rt: Runtime, { token }: { token: string }) {
  const uid = requireUser(rt);
  const invite = (await rt.db.find("invites", { tokenHash: await hashToken(token ?? "") }))[0];
  if (!invite) throw new ActionError("not_found", "This invite link is not valid. Ask the student to send a new one.");
  const r = await loadRequest(rt, invite.requestId as string);
  if (r.studentUserId === uid) throw new ActionError("forbidden", "This invite is for your recommender. Students cannot open it.");
  if (invite.claimedBy && invite.claimedBy !== uid) throw new ActionError("conflict", "This invite was already accepted by another account.");
  if (!invite.claimedBy) {
    if (new Date(invite.expiresAt as string) < rt.now()) throw new ActionError("invalid", "This invite has expired. Ask the student to send a new one.");
    await rt.db.put("invites", invite.id, { claimedBy: uid, claimedAt: rt.now().toISOString(), claimedEmail: rt.userEmail });
    await rt.db.put("requests", r.id, { recommenderUserId: uid, status: "in-progress" });
  }
  return { requestId: r.id };
}

export async function getInterview(rt: Runtime, { requestId }: { requestId: string }) {
  const r = await asRecommender(rt, requestId);
  const qs = await questionSetOf(rt, requestId);
  const i = intakeOf(r);
  return {
    studentName: i.studentName,
    programs: i.programs.map((p) => ({ name: p.name, school: p.school, dueDate: p.dueDate })),
    questions: (qs?.questions as Question[]) ?? [],
    answers: await answersOf(rt, requestId),
    finished: r.status === "finished",
  };
}

export async function saveAnswer(
  rt: Runtime,
  input: { requestId: string; questionId: string; text?: string; followUp?: string; skipped?: boolean },
) {
  await asRecommender(rt, input.requestId);
  const qs = await questionSetOf(rt, input.requestId);
  if (!(qs?.questions as Question[] | undefined)?.some((q) => q.id === input.questionId)) {
    throw new ActionError("not_found", "That question is not part of this interview.");
  }
  const text = (input.text ?? "").slice(0, 6000);
  const followUp = (input.followUp ?? "").slice(0, 3000);
  const data = { text, followUp, skipped: !!input.skipped, updatedAt: rt.now().toISOString() };
  const existing = (await rt.db.find("answers", { requestId: input.requestId, questionId: input.questionId }))[0];
  if (existing) await rt.db.put("answers", existing.id, data);
  else await rt.db.create("answers", { requestId: input.requestId, questionId: input.questionId, ...data });
  return { saved: true };
}

/** LLM call 2 (assembly only), then the claim check. Falls back to deterministic assembly. */
export async function finishInterview(rt: Runtime, { requestId }: { requestId: string }) {
  const r = await asRecommender(rt, requestId);
  const intake = intakeOf(r);
  const questions = ((await questionSetOf(rt, requestId))?.questions as Question[]) ?? [];
  const answers = await answersOf(rt, requestId);
  const answeredCount = Object.values(answers).filter((a) => a !== "SKIPPED").length;
  if (answeredCount === 0) throw new ActionError("invalid", "Answer at least one question before finishing.");

  const existing = (await rt.db.find("drafts", { requestId }))[0];
  const count = (existing?.assemblyCount as number) ?? 0;
  let assembly: Assembly = deterministicAssembly(questions, answers);
  const notes: string[] = [];

  if (count >= MAX_ASSEMBLIES) {
    notes.push(`Drafting is limited to ${MAX_ASSEMBLIES} runs. This draft uses your answers as written.`);
  } else {
    const res = await rt.llm(assemblyMessages(intake, questions, answers));
    if (res.ok) {
      try {
        const v = validateAssembly(parseModelJson(res.text), questions);
        if (v.ok && v.assembly) assembly = v.assembly;
        else notes.push("The drafting step returned an unusable result. This draft uses your answers as written.");
      } catch {
        notes.push("The drafting step returned an unreadable result. This draft uses your answers as written.");
      }
    } else {
      notes.push(`Drafting is unavailable (${res.error}). This draft uses your answers as written.`);
    }
  }

  const flags: Flag[] = claimCheck(intake, questions, answers, assembly);
  const draft = { assembly, flags, edits: {}, assemblyCount: count + 1, updatedAt: rt.now().toISOString() };
  if (existing) await rt.db.put("drafts", existing.id, draft);
  else await rt.db.create("drafts", { requestId, ...draft });

  const firstFinish = r.status !== "finished";
  await rt.db.put("requests", requestId, { status: "finished" });
  if (firstFinish && typeof r.studentEmail === "string") {
    await rt.email({ to: r.studentEmail, ...completionEmail(intake) }); // status only; failure is non-fatal
  }
  return { mode: assembly.mode, flagCount: flags.length, notes };
}

/** Applies the recommender's sentence edits on top of the assembly. */
function withEdits(assembly: Assembly, edits: Record<string, string>): Assembly {
  return {
    ...assembly,
    paragraphs: assembly.paragraphs.map((p, pi) => ({
      ...p,
      sentences: p.sentences.map((s, si) => (edits[`${pi}:${si}`] !== undefined ? { ...s, text: edits[`${pi}:${si}`] } : s)),
    })),
  };
}

export async function getDraft(rt: Runtime, { requestId }: { requestId: string }) {
  const r = await asRecommender(rt, requestId);
  const d = (await rt.db.find("drafts", { requestId }))[0];
  if (!d) throw new ActionError("not_found", "Finish the interview to create a draft.");
  const intake = intakeOf(r);
  const questions = ((await questionSetOf(rt, requestId))?.questions as Question[]) ?? [];
  const answers = await answersOf(rt, requestId);
  const edits = (d.edits as Record<string, string>) ?? {};
  const assembly = withEdits(d.assembly as Assembly, edits);
  // A sentence the recommender rewrote is their own words, so its flags are dropped.
  const flags = (d.flags as Flag[]).filter((f) => f.paragraph === null || edits[`${f.paragraph}:${f.sentence}`] === undefined);
  return {
    assembly, flags, edits, answers, questions,
    letters: buildLetters(intake, assembly),
    forms: intake.programs.map((p) => ({ programId: p.id, title: `${p.school}, ${p.name}`, answers: buildFormAnswers(p, questions, answers) })),
  };
}

export async function saveEdit(rt: Runtime, input: { requestId: string; paragraph: number; sentence: number; text: string }) {
  await asRecommender(rt, input.requestId);
  const d = (await rt.db.find("drafts", { requestId: input.requestId }))[0];
  if (!d) throw new ActionError("not_found", "Finish the interview to create a draft.");
  const a = d.assembly as Assembly;
  if (!a.paragraphs[input.paragraph]?.sentences[input.sentence]) throw new ActionError("invalid", "That sentence does not exist.");
  const edits = { ...((d.edits as Record<string, string>) ?? {}), [`${input.paragraph}:${input.sentence}`]: input.text.slice(0, 2000) };
  await rt.db.put("drafts", d.id, { edits, updatedAt: rt.now().toISOString() });
  return { saved: true };
}
