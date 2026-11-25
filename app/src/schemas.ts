// Reccer collections.
// SDK-VERIFY: the exact CollectionSchema / column / permission syntax. Check
//   node_modules/deepspace/dist/*.d.ts and docs.deep.space/concepts/permissions.md
// This file states the INTENT precisely; the agent translates it into real SDK syntax.
//
// SAFE DEFAULT: every collection blocks client writes AND client reads. All access goes
// through server actions in src/actions/, which check the caller's identity themselves.
// Only relax a collection to client reads if the permissions docs prove the SDK can
// express "only rows where requests.recommenderUserId == caller" (row-level), not just
// role-level rules. A role-level "signed-in users can read" would leak every letter.
//
// Keep the scaffold's required `users` schema. Extend it; do not rename it.

export const COLLECTIONS = {
  /** One per letter request. Owned by the student. */
  requests: {
    columns: {
      studentUserId: "string",       // from verified JWT at creation, never from the client body
      recommenderUserId: "string?",  // set only by claimInvite
      intake: "json",                // StudentIntake (programs embedded, each with dueDate)
      status: "string",              // draft-intake | questions-ready | invited | in-progress | finished
      generationCount: "number",     // cap on LLM call 1
      createdAt: "string",
    },
    permissions: { client: "none" }, // student reads a status-only projection via listMyRequests
  },

  /** The question set for a request. Student previews it before inviting; then it is frozen. */
  questionSets: {
    columns: { requestId: "string", questions: "json", source: "string", frozen: "boolean" },
    permissions: { client: "none" },
  },

  /** Invites. Server-only. Stores the SHA-256 of the token, never the token. */
  invites: {
    columns: {
      requestId: "string", email: "string", tokenHash: "string",
      expiresAt: "string", claimedBy: "string?", claimedAt: "string?",
    },
    permissions: { client: "none" },
  },

  /** One record per answer, so each save is small and resume is free. Recommender only. */
  answers: {
    columns: { requestId: "string", questionId: "string", text: "string", followUp: "string?", skipped: "boolean", updatedAt: "string" },
    permissions: { client: "none" },
    // SDK-VERIFY: consider uniqueOn(["requestId","questionId"]) so double-saves upsert.
  },

  /** The draft. Recommender only. Student never reads this, ever. */
  drafts: {
    columns: {
      requestId: "string",
      assembly: "json",        // Assembly (paragraphs with per-sentence sources)
      flags: "json",           // Flag[] from claimCheck
      edits: "json",           // recommender's edited sentences, keyed "p:s"
      assemblyCount: "number", // cap on LLM call 2
      updatedAt: "string",
    },
    permissions: { client: "none" },
  },
} as const;
