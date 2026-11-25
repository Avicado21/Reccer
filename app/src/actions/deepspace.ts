// ADAPTER: DeepSpace SDK -> Runtime. This is the ONLY file that should touch server-side SDK APIs.
// Status: UNVERIFIED. Written from docs excerpts without the SDK installed.
// Every line marked SDK-VERIFY must be checked against node_modules/deepspace/dist/*.d.ts
// and docs.deep.space/guides/server-actions.md + sdk-reference/worker/server-actions.md.
//
// Known from the External APIs docs (verified wording):
//   export const summarizeDay: ActionHandler<Env> = async ({ tools }) => {
//     const r = await tools.integration('openai/chat-completion', { model, messages })
//   }
// Unknown: how a handler receives input, the caller's verified identity, and record access.

import * as L from "./logic";
import type { Runtime, Coll, Row } from "./logic";
import { LLM_ENDPOINT, LLM_MODEL, EMAIL_FROM } from "../integrations";
// SDK-VERIFY: import path and type names.
// import type { ActionHandler } from "deepspace/worker";

type Ctx = any; // SDK-VERIFY: replace with the real handler context type.

function runtimeFrom(ctx: Ctx, env: any): Runtime {
  return {
    // SDK-VERIFY: identity MUST come from the verified JWT the SDK provides, never ctx.input.
    userId: ctx.user?.id ?? ctx.auth?.userId ?? null,
    userEmail: ctx.user?.email ?? ctx.auth?.email ?? null,
    now: () => new Date(),
    appUrl: env?.APP_URL ?? "https://reccer.app.space", // SDK-VERIFY: or derive from APP_NAME
    db: {
      // SDK-VERIFY: server-side record access API. Names below are placeholders.
      async get(c: Coll, id: string) { return (await ctx.records.get(c, id)) as Row | null; },
      async find(c: Coll, where: Record<string, unknown>) { return (await ctx.records.query(c, { where })) as Row[]; },
      async create(c: Coll, data: Record<string, unknown>) { return (await ctx.records.create(c, data)).id as string; },
      async put(c: Coll, id: string, patch: Record<string, unknown>) { await ctx.records.put(id, patch); },
      // NOTE from the SDK skill: records are envelopes (fields under record.data), and put() merges.
      // If so, unwrap here: ({ id: rec.id, ...rec.data }). Keep logic.ts unaware of envelopes.
    },
    async llm(messages) {
      // SDK-VERIFY body + response shape: npx deepspace integrations info openai/chat-completion
      const r = await ctx.tools.integration(LLM_ENDPOINT, { model: LLM_MODEL, messages });
      if (!r?.success) return { ok: false, error: r?.error ?? "integration failed" };
      const text = r.data?.choices?.[0]?.message?.content; // SDK-VERIFY
      return typeof text === "string" ? { ok: true, text } : { ok: false, error: "empty completion" };
    },
    async email({ to, subject, text }) {
      // SDK-VERIFY with: npx deepspace integrations info email/send
      const r = await ctx.tools.integration("email/send", { from: EMAIL_FROM, to, subject, text });
      return r?.success ? { ok: true } : { ok: false, error: r?.error };
    },
  };
}

/** Wrap a logic function as a handler; convert ActionError into the SDK's error shape. */
function action<I, O>(fn: (rt: Runtime, input: I) => Promise<O>) {
  return async (ctx: Ctx) => {
    const rt = runtimeFrom(ctx, ctx.env);
    try {
      return { ok: true, data: await fn(rt, (ctx.input ?? {}) as I) }; // SDK-VERIFY: input location
    } catch (e) {
      if (e instanceof L.ActionError) return { ok: false, code: e.code, error: e.message };
      console.error(e);
      return { ok: false, code: "internal", error: "Something went wrong on our side. Try again." };
    }
  };
}

// SDK-VERIFY: how actions are registered/exported so the client can call them by name.
export const actions = {
  createRequest: action(L.createRequest),
  generateQuestions: action(L.generateQuestions),
  removeQuestion: action(L.removeQuestion),
  sendInvite: action(L.sendInvite),
  listMyRequests: action((rt) => L.listMyRequests(rt)),
  claimInvite: action(L.claimInvite),
  getInterview: action(L.getInterview),
  saveAnswer: action(L.saveAnswer),
  finishInterview: action(L.finishInterview),
  getDraft: action(L.getDraft),
  saveEdit: action(L.saveEdit),
};
