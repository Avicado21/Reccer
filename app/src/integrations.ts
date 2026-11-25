// Billing per integration. SDK-VERIFY: merge into the scaffold's existing src/integrations.ts
// rather than replacing it (the scaffold may already list google).
// Run first:  npx deepspace integrations list
//             npx deepspace integrations info openai/chat-completion
//             npx deepspace integrations info email/send
export const integrations: Record<string, { billing: "developer" | "user" }> = {
  // Owner pays. Safe ONLY because every call is behind sign-in and per-request caps
  // (generationCount <= 3, assemblyCount <= 3) enforced in server actions.
  openai: { billing: "developer" },
  email: { billing: "developer" },
};

// SDK-VERIFY: confirm endpoint names and body shapes with `integrations info`.
export const LLM_ENDPOINT = "openai/chat-completion";
export const LLM_MODEL = "REPLACE_WITH_MODEL_FROM_integrations_info"; // do not guess
export const EMAIL_FROM = "Reccer <reccer@app.space>"; // must be <app-name>@app.space
export const MAX_GENERATIONS = 3;
export const MAX_ASSEMBLIES = 3;
export const INVITE_TTL_DAYS = 30;
