/**
 * Reccer collections, in the installed SDK's CollectionSchema syntax
 * (verified against node_modules/deepspace/dist/schema.d.ts, deepspace 0.44.2).
 *
 * Every collection is CLIENT-NONE: no role (viewer, member, admin, or the `*`
 * catch-all) may read, create, update, or delete through the records
 * WebSocket or `useQuery`/`useMutations`. All access goes through the server
 * actions in src/actions/, which run RBAC-off and check the caller's verified
 * identity themselves (src/actions/logic.ts).
 *
 * Why not row-level rules: the SDK's levels are 'own' (creator or ownerField),
 * collaborator/team/visibility. "Rows where requests.recommenderUserId ==
 * caller, across answers/drafts joined by requestId" is not expressible, and a
 * role-level `read: true` would leak every letter. So reads stay server-side.
 *
 * Storage notes (verified in deepspace/dist/worker.js):
 * - `interpretation: { kind: 'json' }` on a text column stores JSON and
 *   returns it parsed.
 * - Booleans are stored as 0/1 numbers and come back as numbers; the adapter
 *   in src/actions/deepspace.ts converts them back (BOOLEAN_COLUMNS below).
 * - Null values are omitted from `record.data` on read.
 * - `uniqueOn` makes a duplicate create fail with "Duplicate: ...".
 */

import type { CollectionSchema, ColumnDefinition, RolePermissions } from 'deepspace/schema'

const NONE: RolePermissions = { read: false, create: false, update: false, delete: false }
/** Explicit for every role the app uses, plus the catch-all. */
const CLIENT_NONE: Record<string, RolePermissions> = {
  '*': NONE,
  viewer: NONE,
  member: NONE,
  admin: NONE,
}

const text = (name: string): ColumnDefinition => ({ name, storage: 'text', interpretation: 'plain' })
const json = (name: string): ColumnDefinition => ({ name, storage: 'text', interpretation: { kind: 'json' } })
const num = (name: string): ColumnDefinition => ({ name, storage: 'number', interpretation: 'plain' })
const bool = (name: string): ColumnDefinition => ({ name, storage: 'number', interpretation: { kind: 'boolean' } })
const when = (name: string): ColumnDefinition => ({ name, storage: 'text', interpretation: { kind: 'datetime' } })

/** One per letter request. Owned by the student. */
export const requestsSchema: CollectionSchema = {
  name: 'requests',
  columns: [
    text('studentUserId'), // from the verified JWT at creation, never from the client body
    text('studentEmail'), // from the verified JWT; completion email goes here (status only)
    text('recommenderUserId'), // set only by claimInvite
    json('intake'), // StudentIntake (programs embedded, each with dueDate)
    text('status'), // draft-intake | questions-ready | invited | in-progress | finished
    num('generationCount'), // cap on LLM call 1
    when('createdAt'),
    json('remindersSent'), // string[] of reminder keys already sent (core/reminders.ts reminderKey)
  ],
  permissions: CLIENT_NONE,
}

/** The question set for a request. Student previews it before inviting; then it is frozen. */
export const questionSetsSchema: CollectionSchema = {
  name: 'questionSets',
  columns: [
    text('requestId'),
    json('questions'),
    text('source'),
    bool('frozen'),
    bool('stale'), // the intake changed after these were made; regenerate before inviting
  ],
  uniqueOn: ['requestId'],
  permissions: CLIENT_NONE,
}

/** Invites. Stores the SHA-256 of the token, never the token. */
export const invitesSchema: CollectionSchema = {
  name: 'invites',
  columns: [
    text('requestId'),
    text('email'),
    text('tokenHash'),
    when('expiresAt'),
    text('claimedBy'),
    when('claimedAt'),
    text('claimedEmail'),
    when('sentAt'), // shown to the student as status
    when('cancelledAt'), // the student cancelled it, or its email failed to send
    when('replacedAt'), // a resend superseded it
  ],
  uniqueOn: ['tokenHash'],
  permissions: CLIENT_NONE,
}

/** One record per answer, so each save is small and resume is free. Recommender only. */
export const answersSchema: CollectionSchema = {
  name: 'answers',
  columns: [
    text('requestId'),
    text('questionId'),
    text('text'),
    text('followUp'),
    bool('skipped'),
    when('updatedAt'),
  ],
  uniqueOn: ['requestId', 'questionId'],
  permissions: CLIENT_NONE,
}

/** The draft. Recommender only. The student never reads this. */
export const draftsSchema: CollectionSchema = {
  name: 'drafts',
  columns: [
    text('requestId'),
    json('assembly'), // Assembly (paragraphs with per-sentence sources)
    json('flags'), // Flag[] from claimCheck
    json('edits'), // recommender's edited sentences, keyed by stable sentence id
    json('notes'), // string[] from the last finish (drafting fallbacks, edits not carried over)
    num('assemblyCount'), // cap on LLM call 2
    when('updatedAt'),
  ],
  uniqueOn: ['requestId'],
  permissions: CLIENT_NONE,
}

export const reccerSchemas: CollectionSchema[] = [
  requestsSchema,
  questionSetsSchema,
  invitesSchema,
  answersSchema,
  draftsSchema,
]

/** Boolean columns per collection, so the adapter can turn stored 0/1 back into booleans. */
export const BOOLEAN_COLUMNS: Record<string, string[]> = Object.fromEntries(
  reccerSchemas.map((s) => [
    s.name,
    s.columns
      .filter((c) => typeof c.interpretation === 'object' && c.interpretation.kind === 'boolean')
      .map((c) => c.name),
  ]),
)
