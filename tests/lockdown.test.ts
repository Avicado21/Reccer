// Pre-publication lockdown: the real worker app (worker.ts) with stubbed
// platform bindings. A signed-in non-owner must not reach owner-billed
// integrations through the browser proxy, the local-assistant (agent) tool
// surface must not be mounted, and the record tools' RBAC must deny every
// role on every Reccer collection. Server actions and cron call the
// api-worker directly (src/server/action-routes.ts callIntegration,
// buildCronContext), not through the proxy, so their capped paths are untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { canCreate, canDelete, canRead, canUpdate, getRolePermissions } from "deepspace/worker";

// worker.ts needs @cloudflare/workers-types, which tsconfig.core.json (node
// types, includes tests/**) must not pull in; `npm run typecheck`'s second
// pass checks worker.ts itself. So load it untyped at runtime.
type WorkerApp = { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
const WORKER_ENTRY = "../worker.ts";
const { default: app } = (await import(WORKER_ENTRY)) as { default: WorkerApp };
import { browserMayCall, integrations } from "../src/integrations";
import { reccerSchemas } from "../src/schemas/reccer-schemas";

const ISSUER = "https://auth.test";
const ORIGIN = "https://reccer.app.space";
const OWNER_JWT = "owner-jwt-must-never-leave-the-worker";
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

/** An ES256 JWT the worker's verifyJwt accepts (same key the env advertises). */
function jwt(claims: Record<string, unknown>): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "ES256", typ: "JWT" })}.${b64({ iat: now, exp: now + 600, ...claims })}`;
  const sig = sign("sha256", Buffer.from(body), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${body}.${sig.toString("base64url")}`;
}
const outsider = () => jwt({ sub: "u-outsider", iss: ISSUER, email: "outsider@example.test" });
const outsiderAgent = () => jwt({ sub: "u-outsider", iss: `${ISSUER}/agent`, aud: ORIGIN, scope: "agent" });

type Call = { url: string; auth: string | null };
function harness() {
  const apiCalls: Call[] = [];
  const roomCalls: string[] = [];
  const fetcher = (log: (url: string, init?: RequestInit) => void) => ({
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      log(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init);
      return Response.json({ success: true, data: {} });
    },
  });
  const namespace = (log: (url: string) => void) => ({
    idFromName: (name: string) => name,
    get: () => fetcher((url) => log(url)),
  });
  const env = {
    API_WORKER: fetcher((url, init) =>
      apiCalls.push({ url, auth: new Headers(init?.headers).get("Authorization") })),
    API_WORKER_URL: "https://api.test",
    AUTH_JWT_PUBLIC_KEY: PUBLIC_PEM,
    AUTH_JWT_ISSUER: ISSUER,
    AUTH_WORKER_URL: "https://auth.test",
    APP_NAME: "reccer",
    DEEPSPACE_APP_ID: "app-test",
    OWNER_USER_ID: "u-owner",
    APP_OWNER_JWT: OWNER_JWT,
    APP_IDENTITY_TOKEN: "app-identity",
    RECORD_ROOMS: namespace((url) => roomCalls.push(url)),
    CRON_ROOMS: namespace(() => {}),
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
  };
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const send = (path: string, init: RequestInit = {}) => app.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);
  return { send, apiCalls, roomCalls };
}

const post = (token: string | null, body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

test("signed-in non-owner is refused on POST /api/integrations/anthropic/chat-completion", async () => {
  const h = harness();
  const res = await h.send(
    "/api/integrations/anthropic/chat-completion",
    post(outsider(), { model: "claude-sonnet-5-5", max_tokens: 4096, messages: [{ role: "user", content: "hi" }] }),
  );
  assert.equal(res.status, 403);
  assert.deepEqual(h.apiCalls, [], "nothing reached the api-worker with the owner's token");
});

test("signed-in non-owner is refused on POST /api/integrations/email/send", async () => {
  const h = harness();
  const res = await h.send(
    "/api/integrations/email/send",
    post(outsider(), { to: "anyone@example.com", subject: "spam", text: "spam" }),
  );
  assert.equal(res.status, 403);
  assert.deepEqual(h.apiCalls, []);
});

test("unlisted (default developer-billed) integrations and signed-out callers are refused too", async () => {
  for (const token of [outsider(), null]) {
    const h = harness();
    for (const path of ["/api/integrations/openai/chat-completion", "/api/integrations/anthropic/chat-completion", "/api/integrations/email/send"]) {
      const res = await h.send(path, post(token, {}));
      assert.ok(res.status === 403 || res.status === 401, `${path} ${token ? "signed-in" : "signed-out"}: ${res.status}`);
    }
    // GET is refused the same way; the gate is method-agnostic.
    assert.equal((await h.send("/api/integrations/anthropic/chat-completion", { headers: token ? { Authorization: `Bearer ${token}` } : {} })).status >= 401, true);
    assert.deepEqual(h.apiCalls, []);
  }
});

test("user-billed integrations still proxy, billed to the caller and never to the owner", async () => {
  const h = harness();
  const token = outsider();
  const res = await h.send("/api/integrations/google/calendar-list", post(token, {}));
  assert.equal(res.status, 200);
  assert.equal(h.apiCalls.length, 1);
  assert.equal(h.apiCalls[0].auth, `Bearer ${token}`);
  assert.notEqual(h.apiCalls[0].auth, `Bearer ${OWNER_JWT}`);
});

test("browserMayCall: every developer-billed integration is server-only unless opted in", () => {
  assert.equal(browserMayCall("anthropic"), false);
  assert.equal(browserMayCall("email"), false);
  assert.equal(browserMayCall("openai"), false, "unlisted defaults to developer, server-only");
  assert.equal(browserMayCall("constructor"), false, "own keys only");
  assert.equal(browserMayCall("google"), true);
  assert.equal(browserMayCall("composio"), true);
  for (const [name, config] of Object.entries(integrations)) {
    if (config.billing === "developer") assert.notEqual(config.browser, true, `${name} must stay server-only`);
  }
});

test("local-assistant agent surface (/_deepspace/agent HTTP + MCP) is not mounted", async () => {
  const h = harness();
  const agent = outsiderAgent();
  const session = outsider();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const probes: Array<[string, RequestInit]> = [
    ["/_deepspace/agent/tools", { headers: auth(agent) }],
    ["/_deepspace/agent/tools.md", { headers: auth(agent) }],
    ["/_deepspace/agent/tools/records_query", post(agent, { input: { collection: "answers" } })],
    ["/_deepspace/agent/mcp", post(agent, { jsonrpc: "2.0", id: 1, method: "tools/list" })],
    ["/_deepspace/agent/browser/tools", { headers: auth(session) }],
    ["/_deepspace/agent/browser/tools/records_create", post(session, { input: { collection: "drafts", data: {} } })],
  ];
  for (const [path, init] of probes) {
    const res = await h.send(path, init);
    assert.equal(res.status, 404, path);
  }
  assert.deepEqual(h.roomCalls, [], "no agent probe reached a RecordRoom");
  assert.deepEqual(h.apiCalls, [], "no agent probe reached the api-worker");
});

test("record tools RBAC (what records.* run as a signed-in caller) denies every role on every Reccer collection", () => {
  const roles = ["viewer", "member", "admin", "anonymous", "some-custom-role"];
  for (const schema of reccerSchemas) {
    for (const role of roles) {
      // The caller's own row, the most permissive case for 'own' rules.
      const record = { recordId: "r1", createdBy: "u-outsider", data: { studentUserId: "u-outsider", recommenderUserId: "u-outsider" } };
      const where = `${schema.name}/${role}`;
      assert.deepEqual(getRolePermissions(schema, role), { read: false, create: false, update: false, delete: false }, where);
      assert.equal(canRead(schema, role, record, "u-outsider"), false, `read ${where}`);
      assert.equal(canCreate(schema, role), false, `create ${where}`);
      assert.equal(canUpdate(schema, role, record, "u-outsider"), false, `update ${where}`);
      assert.equal(canDelete(schema, role, record, "u-outsider"), false, `delete ${where}`);
    }
  }
  assert.deepEqual(
    reccerSchemas.map((s) => s.name).sort(),
    ["answers", "drafts", "invites", "questionSets", "requests"],
  );
});
