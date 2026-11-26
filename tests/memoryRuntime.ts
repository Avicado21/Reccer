// In-memory Runtime for testing action logic and permissions without the SDK.
import type { Coll, EmailOut, Row, Runtime } from "../src/actions/logic";
import type { ChatMessage } from "../src/core/index";

export function makeWorld(opts: { llm?: (m: ChatMessage[]) => string | null } = {}) {
  const tables: Record<Coll, Map<string, Row>> = {
    requests: new Map(), questionSets: new Map(), invites: new Map(), answers: new Map(), drafts: new Map(),
  };
  let seq = 0;
  const outbox: EmailOut[] = [];
  const llmCalls: ChatMessage[][] = [];
  const db: Runtime["db"] = {
    async get(c, id) { const r = tables[c].get(id); return r ? structuredClone(r) : null; },
    async find(c, where) {
      return [...tables[c].values()].filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)).map((r) => structuredClone(r));
    },
    async create(c, data) { const id = `${c}_${++seq}`; tables[c].set(id, { id, ...structuredClone(data) }); return id; },
    async put(c, id, patch) { const r = tables[c].get(id); if (!r) throw new Error(`no ${c}/${id}`); Object.assign(r, structuredClone(patch)); },
  };
  const as = (userId: string | null, userEmail: string | null = null): Runtime => ({
    userId, userEmail, appUrl: "https://reccer.app.space", now: () => new Date("2026-11-25T12:00:00Z"), db,
    async llm(m) { llmCalls.push(m); const t = opts.llm?.(m); return t == null ? { ok: false, error: "llm disabled in test" } : { ok: true, text: t }; },
    async email(msg) { outbox.push(msg); return { ok: true }; },
  });
  return { tables, outbox, llmCalls, as };
}
