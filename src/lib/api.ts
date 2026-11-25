// Client-side calls to server actions. Verified against the installed SDK
// (deepspace 0.44.2) and docs guides/server-actions: the web client calls
// POST /api/actions/<name> with `Authorization: Bearer <getAuthToken()>`; the
// worker verifies that JWT and answers { success, data } | { success: false, error, code? }.
// Pages only use `api.*`, so this is the one client file that knows the transport.

import { getAuthToken } from "deepspace";
import type { Flag, Question, Assembly, Answers, Letter } from "../core/types";

export type Result<T> = { ok: true; data: T } | { ok: false; code: string; error: string };

type Wire<T> = { success: true; data: T } | { success: false; error?: string; code?: string };

async function invoke<T>(name: string, input: unknown = {}): Promise<Result<T>> {
  let token: string | null = null;
  try { token = await getAuthToken(); } catch { /* treated as signed out below */ }
  if (!token) return { ok: false, code: "unauthenticated", error: "Sign in to continue." };
  let res: Response;
  try {
    res = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input ?? {}),
    });
  } catch {
    return { ok: false, code: "network", error: "The server could not be reached. Check your connection and try again." };
  }
  if (res.status === 401) return { ok: false, code: "unauthenticated", error: "Your session ended. Sign in again to continue." };
  let body: Wire<T> | null = null;
  try { body = (await res.json()) as Wire<T>; } catch { /* non-JSON answer */ }
  if (!body) return { ok: false, code: String(res.status), error: "The server could not be reached. Try again." };
  if (body.success) return { ok: true, data: body.data };
  return { ok: false, code: body.code ?? String(res.status), error: body.error ?? "Something went wrong. Try again." };
}

export interface RequestSummary { requestId: string; recommenderName: string; status: string; programs: { name: string; school: string; dueDate: string }[] }
export interface Interview { studentName: string; programs: RequestSummary["programs"]; questions: Question[]; answers: Answers; finished: boolean }
export interface Draft {
  assembly: Assembly; flags: Flag[]; edits: Record<string, string>; answers: Answers; questions: Question[];
  letters: Letter[]; forms: { programId: string; title: string; answers: { label: string; answer: string }[] }[];
}

export const api = {
  createRequest: (intake: unknown) => invoke<{ requestId: string }>("createRequest", intake),
  generateQuestions: (requestId: string) => invoke<{ questions: Question[]; source: string; notes: string[] }>("generateQuestions", { requestId }),
  removeQuestion: (requestId: string, questionId: string) => invoke<{ questions: Question[] }>("removeQuestion", { requestId, questionId }),
  sendInvite: (requestId: string) => invoke<{ sentTo: string }>("sendInvite", { requestId }),
  listMyRequests: () => invoke<RequestSummary[]>("listMyRequests"),
  claimInvite: (token: string) => invoke<{ requestId: string }>("claimInvite", { token }),
  getInterview: (requestId: string) => invoke<Interview>("getInterview", { requestId }),
  saveAnswer: (input: { requestId: string; questionId: string; text?: string; followUp?: string; skipped?: boolean }) => invoke<{ saved: true }>("saveAnswer", input),
  finishInterview: (requestId: string) => invoke<{ mode: string; flagCount: number; notes: string[] }>("finishInterview", { requestId }),
  getDraft: (requestId: string) => invoke<Draft>("getDraft", { requestId }),
  saveEdit: (input: { requestId: string; paragraph: number; sentence: number; text: string }) => invoke<{ saved: true }>("saveEdit", input),
};
