// All Reccer server-side behavior, written against a small Runtime interface.
// deepspace.ts adapts the real SDK to this interface; tests use an in-memory runtime.
// Every permission rule lives here, in code, so it does not depend on how expressive
// the SDK's collection permissions turn out to be.

import {
  buildQuestionSet, defaultMiddle, validateGeneratedQuestions, parseModelJson,
  questionGenerationMessages, assemblyMessages, validateAssembly, deterministicAssembly,
  claimCheck, adviseOnEdit, buildLetters, buildFormAnswers, newInviteToken, hashToken, inviteEmail, completionEmail,
  assignSentenceIds, sentenceIndex, remindersDue, reminderKey, studentReminderEmail, recommenderReminderEmail,
  REMINDER_WINDOWS_DAYS,
  type Answers, type Assembly, type ChatMessage, type Flag, type Program, type Question, type StudentIntake,
} from "../core/index";
import { MAX_ASSEMBLIES, MAX_GENERATIONS, INVITE_TTL_DAYS } from "../integrations";

// ---------- Runtime interface ----------

export type Coll = "requests" | "questionSets" | "invites" | "answers" | "drafts";
export interface Row { id: string; [k: string]: unknown }

export interface Runtime {
  /** From a verified JWT only. Never from the request body. */
  userId: string | null;
  /**
   * True only when the adapter calls logic from a scheduled job (cron), never for a client
   * request. Gates sendDeadlineReminders, which reads across all requests.
   */
  system?: boolean;
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

/** Resending is capped so a student cannot use Reccer to flood a recommender's inbox. */
export const MAX_INVITE_SENDS = 5;

/** Student-facing invite status. Never the token, its hash, or the claiming account. */
export interface InviteStatus {
  sentAt: string | null;
  expiresAt: string;
  claimed: boolean;
  claimedAt: string | null;
  cancelled: boolean;
  expired: boolean;
  sendCount: number;
  sendsLeft: number;
}

async function invitesOf(rt: Runtime, requestId: string): Promise<Row[]> {
  const rows = await rt.db.find("invites", { requestId });
  return rows.sort((a, b) => String(a.sentAt ?? "").localeCompare(String(b.sentAt ?? "")));
}

const isActiveInvite = (i: Row, now: Date) => !i.claimedBy && !i.cancelledAt && !i.replacedAt && new Date(i.expiresAt as string) >= now;

async function inviteStatusOf(rt: Runtime, requestId: string): Promise<InviteStatus | null> {
  const all = await invitesOf(rt, requestId);
  const latest = all.find((i) => i.claimedBy) ?? all.at(-1);
  if (!latest) return null;
  return {
    sentAt: (latest.sentAt as string) ?? null,
    expiresAt: latest.expiresAt as string,
    claimed: !!latest.claimedBy,
    claimedAt: (latest.claimedAt as string) ?? null,
    cancelled: !!latest.cancelledAt,
    expired: !latest.claimedBy && !latest.cancelledAt && new Date(latest.expiresAt as string) < rt.now(),
    sendCount: all.length,
    sendsLeft: Math.max(0, MAX_INVITE_SENDS - all.length),
  };
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

const str = (v: unknown) => (typeof v === "string" ? v : "");
const optStr = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

/**
 * Keeps only the fields Reccer knows, so a client cannot store arbitrary data in the intake.
 * Program ids are kept when present (fit questions are scoped by them) and made unique.
 */
export function cleanIntake(raw: StudentIntake): StudentIntake {
  const i = (raw ?? {}) as unknown as Record<string, unknown>;
  const used = new Set<string>();
  const programs: Program[] = (Array.isArray(i.programs) ? i.programs : []).map((rp: Record<string, unknown>) => {
    const p: Program = {
      id: str(rp?.id).trim(),
      school: str(rp?.school),
      name: str(rp?.name),
      dueDate: str(rp?.dueDate),
      submission: rp?.submission === "portal-form" || rp?.submission === "both" ? rp.submission : "upload",
    };
    const description = optStr(rp?.description);
    if (description) p.description = description;
    if (Array.isArray(rp?.formQuestions)) {
      p.formQuestions = (rp.formQuestions as Record<string, unknown>[])
        .filter((f) => typeof f?.key === "string" && typeof f?.label === "string")
        .map((f) => ({ key: f.key as string, label: f.label as string }));
    }
    if (Array.isArray(rp?.ratingOptions)) p.ratingOptions = (rp.ratingOptions as unknown[]).filter((x): x is string => typeof x === "string");
    return p;
  });
  for (const p of programs) {
    if (p.id && !used.has(p.id)) { used.add(p.id); continue; }
    let n = 1;
    while (used.has(`p${n}`)) n++;
    p.id = `p${n}`;
    used.add(p.id);
  }
  const out: StudentIntake = {
    studentName: str(i.studentName), recommenderName: str(i.recommenderName), recommenderEmail: str(i.recommenderEmail).trim(),
    relationship: str(i.relationship), factSheet: str(i.factSheet), programs,
  };
  const preferredName = optStr(i.preferredName);
  const pronouns = optStr(i.pronouns);
  if (preferredName) out.preferredName = preferredName;
  if (pronouns) out.pronouns = pronouns;
  return out;
}

/** Whether an intake change makes the existing questions wrong (names, facts, programs). */
function questionsAffected(a: StudentIntake, b: StudentIntake): boolean {
  const shape = (i: StudentIntake) => JSON.stringify([
    i.studentName, i.preferredName ?? "", i.pronouns ?? "", i.relationship, i.factSheet,
    i.programs.map((p) => [p.id, p.school, p.name, p.description ?? "", p.formQuestions ?? [], p.ratingOptions ?? []]),
  ]);
  return shape(a) !== shape(b);
}

// ---------- student actions ----------

export async function createRequest(rt: Runtime, input: StudentIntake) {
  const uid = requireUser(rt);
  const errors = validateIntake(input);
  if (errors.length) throw new ActionError("invalid", errors.join(" "));
  const intake = cleanIntake(input);
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
  if (existing) await rt.db.put("questionSets", existing.id, { questions, source, stale: false });
  else await rt.db.create("questionSets", { requestId, questions, source, frozen: false, stale: false });
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

/**
 * Freezes the questions and emails the recommender. Also the resend path: a new link replaces
 * any earlier unclaimed one. The token is never returned to the student.
 */
export async function sendInvite(rt: Runtime, { requestId }: { requestId: string }) {
  const r = await asStudent(rt, requestId);
  const qs = await questionSetOf(rt, requestId);
  if (!qs) throw new ActionError("invalid", "Generate or choose questions before inviting.");
  if (qs.stale) throw new ActionError("conflict", "Your details changed after the questions were made. Create the questions again before inviting.");
  if (r.recommenderUserId) throw new ActionError("conflict", "Your recommender has already accepted this invite.");
  const earlier = await invitesOf(rt, requestId);
  if (earlier.length >= MAX_INVITE_SENDS) {
    throw new ActionError("limit", `An invite can be sent ${MAX_INVITE_SENDS} times per request. Contact your recommender directly.`);
  }
  const intake = intakeOf(r);
  const token = newInviteToken();
  const now = rt.now().toISOString();
  const expires = new Date(rt.now().getTime() + INVITE_TTL_DAYS * 86_400_000);
  const inviteId = await rt.db.create("invites", {
    requestId, email: intake.recommenderEmail, tokenHash: await hashToken(token),
    sentAt: now, expiresAt: expires.toISOString(), claimedBy: null, claimedAt: null, cancelledAt: null, replacedAt: null,
  });
  const mail = inviteEmail(intake, `${rt.appUrl}/recommender/claim?token=${token}`, (qs.questions as Question[]).length);
  const sent = await rt.email({ to: intake.recommenderEmail, ...mail });
  if (!sent.ok) {
    // The new link never reached anyone; retire it and leave any earlier link working.
    await rt.db.put("invites", inviteId, { expiresAt: now, cancelledAt: now });
    throw new ActionError("invalid", `The invite email could not be sent (${sent.error ?? "unknown error"}). Check the address and try again.`);
  }
  for (const old of earlier) {
    if (!old.claimedBy && !old.cancelledAt && !old.replacedAt) await rt.db.put("invites", old.id, { expiresAt: now, replacedAt: now });
  }
  await rt.db.put("questionSets", qs.id, { frozen: true });
  await rt.db.put("requests", requestId, { status: "invited" });
  return { sentTo: intake.recommenderEmail }; // sent time is in the status views
}

/**
 * Withdraws an unclaimed invite. The link stops working, the questions unlock, and the request
 * goes back to "questions-ready" so the student can fix details and send again.
 */
export async function cancelInvite(rt: Runtime, { requestId }: { requestId: string }) {
  const r = await asStudent(rt, requestId);
  if (r.recommenderUserId) throw new ActionError("conflict", "Your recommender has already accepted this invite, so it cannot be cancelled.");
  const now = rt.now();
  const all = await invitesOf(rt, requestId);
  if (all.some((i) => i.claimedBy)) throw new ActionError("conflict", "Your recommender has already accepted this invite, so it cannot be cancelled.");
  const active = all.filter((i) => isActiveInvite(i, now));
  // An expired invite can still be "cancelled": that unlocks the request for editing.
  if (!active.length && r.status !== "invited") throw new ActionError("conflict", "There is no open invite to cancel.");
  for (const i of active) await rt.db.put("invites", i.id, { cancelledAt: now.toISOString(), expiresAt: now.toISOString() });
  const qs = await questionSetOf(rt, requestId);
  if (qs) await rt.db.put("questionSets", qs.id, { frozen: false });
  await rt.db.put("requests", requestId, { status: qs ? "questions-ready" : "draft-intake" });
  return { cancelled: true };
}

/** Status only. No answers, no draft, no letter. */
export async function listMyRequests(rt: Runtime) {
  const uid = requireUser(rt);
  const rows = await rt.db.find("requests", { studentUserId: uid });
  return Promise.all(rows.map(async (r) => {
    const i = intakeOf(r);
    return {
      requestId: r.id, recommenderName: i.recommenderName, status: r.status as string,
      programs: i.programs.map((p) => ({ name: p.name, school: p.school, dueDate: p.dueDate })),
      invite: await inviteStatusOf(rt, r.id),
    };
  }));
}

/**
 * The student's own request, to reopen and edit it: intake and question set, plus invite status.
 * Never answers, drafts, flags, or letters.
 */
export async function getMyRequestIntake(rt: Runtime, { requestId }: { requestId: string }) {
  const r = await asStudent(rt, requestId);
  const qs = await questionSetOf(rt, requestId);
  const status = r.status as string;
  return {
    requestId: r.id,
    status,
    intake: intakeOf(r),
    questions: (qs?.questions as Question[] | undefined) ?? [],
    questionSource: (qs?.source as string | undefined) ?? null,
    questionsFrozen: !!qs?.frozen,
    questionsStale: !!qs?.stale,
    editable: !r.recommenderUserId && (status === "draft-intake" || status === "questions-ready"),
    invite: await inviteStatusOf(rt, requestId),
  };
}

/**
 * Edits a saved intake. Allowed only before the invite goes out (cancel it first to edit).
 * Changes that affect the questions (names, facts, programs) mark them stale, and the student
 * creates them again; recommender contact details and due dates do not.
 */
export async function updateIntake(rt: Runtime, { requestId, intake: input }: { requestId: string; intake: StudentIntake }) {
  const r = await asStudent(rt, requestId);
  const status = r.status as string;
  if (r.recommenderUserId || (status !== "draft-intake" && status !== "questions-ready")) {
    throw new ActionError("conflict", "The invite is sent, so these details are locked. Cancel the invite to change them.");
  }
  const errors = validateIntake(input);
  if (errors.length) throw new ActionError("invalid", errors.join(" "));
  const intake = cleanIntake(input);
  const qs = await questionSetOf(rt, requestId);
  if (qs?.frozen) throw new ActionError("conflict", "The invite is sent, so these details are locked. Cancel the invite to change them.");
  const stale = !!qs && (!!qs.stale || questionsAffected(intakeOf(r), intake));
  await rt.db.put("requests", requestId, { intake, ...(qs ? { status: stale ? "draft-intake" : status } : {}) });
  if (qs && stale && !qs.stale) await rt.db.put("questionSets", qs.id, { stale: true });
  return {
    saved: true as const,
    questionsStale: stale,
    notes: stale ? ["Your changes affect the questions. Create the questions again before sending the invite."] : [],
  };
}

// ---------- recommender actions ----------

export async function claimInvite(rt: Runtime, { token }: { token: string }) {
  const uid = requireUser(rt);
  const invite = (await rt.db.find("invites", { tokenHash: await hashToken(token ?? "") }))[0];
  if (!invite) throw new ActionError("not_found", "This invite link is not valid. Ask the student to send a new one.");
  const r = await loadRequest(rt, invite.requestId as string);
  if (r.studentUserId === uid) throw new ActionError("forbidden", "This invite is for your recommender. Students cannot open it.");
  if (invite.claimedBy === uid && r.recommenderUserId === uid) return { requestId: r.id }; // re-opening the link
  const taken = () => new ActionError("conflict", "This invite was already accepted by another account.");
  if (invite.claimedBy && invite.claimedBy !== uid) throw taken();
  if (r.recommenderUserId && r.recommenderUserId !== uid) throw taken();
  if (invite.cancelledAt) throw new ActionError("invalid", "The student cancelled this invite. Ask them to send a new one.");
  if (invite.replacedAt) throw new ActionError("invalid", "A newer invite was sent for this request. Use the link in the most recent email.");
  if (new Date(invite.expiresAt as string) < rt.now()) throw new ActionError("invalid", "This invite has expired. Ask the student to send a new one.");

  // The Runtime has no conditional write, so two accounts holding the same (forwarded) link can
  // both pass the checks above. Write, then re-read: the account whose write landed last wins and
  // everyone else is refused. ADAPTER NOTE: if the SDK offers a conditional write or transaction
  // (put only if claimedBy is still null), use it in deepspace.ts for this put; the re-reads
  // below then become a cheap confirmation instead of the only guard.
  await rt.db.put("invites", invite.id, { claimedBy: uid, claimedAt: rt.now().toISOString(), claimedEmail: rt.userEmail });
  const after = await rt.db.get("invites", invite.id);
  if (after?.claimedBy !== uid) throw taken();
  if (after.cancelledAt || after.replacedAt) {
    // The student cancelled or resent while we were claiming; their action wins.
    await rt.db.put("invites", invite.id, { claimedBy: null, claimedAt: null, claimedEmail: null });
    throw new ActionError("invalid", "The student withdrew this invite a moment ago. Ask them to send a new one.");
  }
  await rt.db.put("requests", r.id, { recommenderUserId: uid, status: "in-progress" });
  // A rival write can land between our re-read and the request update. Check once more and, if
  // we lost, hand the request to the account the invite records, so the two never disagree.
  const final = await rt.db.get("invites", invite.id);
  if (final?.claimedBy !== uid) {
    const winner = (final?.claimedBy as string | null) ?? null;
    await rt.db.put("requests", r.id, winner ? { recommenderUserId: winner } : { recommenderUserId: null, status: "invited" });
    throw taken();
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

  // Keep the recommender's edits on every sentence that is still in the new draft (same id);
  // drop only the ones whose sentence vanished, and say so, quoting the edit so it is not lost.
  const ids = sentenceIndex(assembly);
  const edits: Record<string, string> = {};
  for (const [id, text] of Object.entries((existing?.edits as Record<string, string> | undefined) ?? {})) {
    if (ids.has(id)) edits[id] = text;
    else notes.push(`One of your edits was to a sentence that is no longer in the draft, so it was not carried over. Your edit was: "${text}"`);
  }

  const flags: Flag[] = claimCheck(intake, questions, answers, assembly);
  const draft = { assembly, flags, edits, notes, assemblyCount: count + 1, updatedAt: rt.now().toISOString() };
  if (existing) await rt.db.put("drafts", existing.id, draft);
  else await rt.db.create("drafts", { requestId, ...draft });

  const firstFinish = r.status !== "finished";
  await rt.db.put("requests", requestId, { status: "finished" });
  if (firstFinish && typeof r.studentEmail === "string") {
    await rt.email({ to: r.studentEmail, ...completionEmail(intake) }); // status only; failure is non-fatal
  }
  return { mode: assembly.mode, flagCount: flags.length, keptEdits: Object.keys(edits).length, notes };
}

/** The stored assembly, with sentence ids (assigned here for any draft saved without them). */
function storedAssembly(d: Row): Assembly {
  const a = d.assembly as Assembly;
  return a.paragraphs.every((p) => p.sentences.every((s) => s.id)) ? a : { ...a, paragraphs: assignSentenceIds(a.paragraphs) };
}

/** Applies the recommender's sentence edits, keyed by sentence id, on top of the assembly. */
function withEdits(assembly: Assembly, edits: Record<string, string>): Assembly {
  return {
    ...assembly,
    paragraphs: assembly.paragraphs.map((p) => ({
      ...p,
      sentences: p.sentences.map((s) => (edits[s.id] !== undefined ? { ...s, text: edits[s.id] } : s)),
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
  const base = storedAssembly(d);
  const assembly = withEdits(base, edits);
  // A sentence the recommender rewrote is their own words, so its original flags are dropped...
  const flags = ((d.flags as Flag[]) ?? []).filter((f) => !f.sentenceId || edits[f.sentenceId] === undefined);
  // ...and the same check runs on their edit as advisory notes. The edit stands either way.
  const index = sentenceIndex(base);
  const advisories = Object.entries(edits).flatMap(([id, text]) => {
    const at = index.get(id);
    return at ? adviseOnEdit(intake, questions, answers, at.value, { paragraph: at.paragraph, sentence: at.sentence }, text) : [];
  });
  return {
    assembly, flags, advisories, edits, answers, questions,
    notes: (d.notes as string[] | undefined) ?? [],
    letters: buildLetters(intake, assembly),
    forms: intake.programs.map((p) => ({ programId: p.id, title: `${p.school}, ${p.name}`, answers: buildFormAnswers(p, questions, answers) })),
  };
}

/**
 * Saves the recommender's rewrite of one sentence, by its stable id. (paragraph, sentence)
 * positions in the stored assembly are still accepted. Saving empty text, or the original
 * text, reverts the sentence.
 */
export async function saveEdit(
  rt: Runtime,
  input: { requestId: string; sentenceId?: string; paragraph?: number; sentence?: number; text: string },
) {
  await asRecommender(rt, input.requestId);
  const d = (await rt.db.find("drafts", { requestId: input.requestId }))[0];
  if (!d) throw new ActionError("not_found", "Finish the interview to create a draft.");
  const a = storedAssembly(d);
  const id = input.sentenceId ?? a.paragraphs[input.paragraph ?? -1]?.sentences[input.sentence ?? -1]?.id;
  const target = id ? sentenceIndex(a).get(id) : undefined;
  if (!id || !target) throw new ActionError("invalid", "That sentence does not exist.");
  const text = (typeof input.text === "string" ? input.text : "").trim().slice(0, 2000);
  const edits = { ...((d.edits as Record<string, string>) ?? {}) };
  const reverted = !text || text === target.value.text;
  if (reverted) delete edits[id];
  else edits[id] = text;
  await rt.db.put("drafts", d.id, { edits, updatedAt: rt.now().toISOString() });
  return { saved: true as const, reverted };
}

// ---------- scheduled job ----------

/**
 * Deadline reminders. ENTRY POINT for the scheduled job: call with a Runtime built for the cron
 * trigger (system: true, userId: null), e.g. once a day. Reminds the student (status only) and
 * the recommender (a gentle nudge with due dates) for every invited or in-progress request whose
 * earliest upcoming due date is inside a window, at most once per window per recipient.
 */
export async function sendDeadlineReminders(rt: Runtime, { windows = REMINDER_WINDOWS_DAYS }: { windows?: number[] } = {}) {
  if (!rt.system) throw new ActionError("forbidden", "Reminders run only from the scheduled job.");
  const rows = [
    ...(await rt.db.find("requests", { status: "invited" })),
    ...(await rt.db.find("requests", { status: "in-progress" })),
  ];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const due = remindersDue(
    rows.map((r) => ({ id: r.id, status: r.status as string, intake: intakeOf(r), remindersSent: (r.remindersSent as string[] | undefined) ?? [] })),
    rt.now(), windows,
  );
  const sent: { requestId: string; to: "student" | "recommender"; window: number }[] = [];
  const failed: { requestId: string; to: "student" | "recommender"; error: string }[] = [];
  for (const rem of due) {
    const r = byId.get(rem.requestId)!;
    const intake = intakeOf(r);
    const keys: string[] = [];
    // An invited request whose link has lapsed: tell the student to resend, and hold the
    // recommender's nudge (unmarked) until there is a working link for it to point to.
    const inviteExpired = rem.status === "invited" && !(await invitesOf(rt, r.id)).some((i) => isActiveInvite(i, rt.now()));
    for (const who of rem.recipients) {
      if (who === "recommender" && inviteExpired) continue;
      const to = who === "student" ? (typeof r.studentEmail === "string" ? r.studentEmail : "") : intake.recommenderEmail;
      if (!to) { failed.push({ requestId: r.id, to: who, error: "no email address on file" }); continue; }
      const mail = who === "student"
        ? studentReminderEmail(intake, rem, { inviteExpired })
        : recommenderReminderEmail(intake, rem, rt.now(), rem.status === "in-progress" ? `${rt.appUrl}/recommender/interview?id=${r.id}` : null);
      const res = await rt.email({ to, ...mail });
      if (res.ok) { keys.push(reminderKey(rem.program.dueDate, rem.window, who)); sent.push({ requestId: r.id, to: who, window: rem.window }); }
      else failed.push({ requestId: r.id, to: who, error: res.error ?? "send failed" });
    }
    if (keys.length) await rt.db.put("requests", r.id, { remindersSent: [...((r.remindersSent as string[] | undefined) ?? []), ...keys] });
  }
  return { checked: rows.length, sent, failed };
}
