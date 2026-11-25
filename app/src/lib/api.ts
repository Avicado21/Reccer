// Client-side calls to server actions. SDK-VERIFY: replace `invoke` with the SDK's real
// server-action client (release notes mention `callAction` for deepspace/native; find the
// web equivalent in node_modules/deepspace/dist/*.d.ts or docs guides/server-actions.md).
// Pages only use `api.*`, so this is the one client file to fix.

import type { Flag, Question, Assembly, Answers, Letter } from "../core/types";

export type Result<T> = { ok: true; data: T } | { ok: false; code: string; error: string };

async function invoke<T>(name: string, input: unknown = {}): Promise<Result<T>> {
  // SDK-VERIFY placeholder transport.
  const res = await fetch(`/api/actions/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), credentials: "include",
  });
  if (!res.ok && res.status !== 200) return { ok: false, code: String(res.status), error: "The server could not be reached. Try again." };
  return (await res.json()) as Result<T>;
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
