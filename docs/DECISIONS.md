# Decisions and tradeoffs

**Main tradeoff: constrained assembly over fluent generation.** The LLM may only clean up and order the recommender's answers, and a deterministic check enforces that afterwards. Cost: drafts are less polished than a fully generated letter. Benefit: every claim traces to something the recommender said, which is the point of the product.

**Claim check is code, not another LLM call.** A second model grading the first would share its failure modes. String rules are predictable, testable, and explainable in an interview. Cost: heuristic false positives (capitalized common words). They only produce a dismissible flag, never a silent change.

**Invite link, not shared credentials.** DeepSpace sign-in is Google or GitHub only, and a shared login would let the student read and edit the letter. The token is single-claim, expires in 30 days, is stored only as a SHA-256 hash, and the student's own account is refused.

**All collections are server-action-only.** The rules ("only the recommender of this request") are row-level. Rather than depend on how expressive collection permissions are, every read and write goes through actions that check identity. Cost: the student status page polls instead of syncing in realtime.

**Generation is an enhancement, never a dependency.** If LLM call 1 fails, returns bad JSON, or yields too few neutral questions, the default bank is used. If call 2 fails, the deterministic draft is used. The core path works with zero LLM calls.

**Fixed questions for identity, ranking, rating, and close.** Rankings and ratings must not depend on model phrasing, and the student cannot remove them.

**Student facts go in memoryJog, never question text.** Facts in a question become claims the recommender echoes. The recommender sees them only on request.

**Caps on paid calls.** Three generations per request, three assemblies per draft, all behind sign-in. Owner-billed integrations accept anonymous callers, so sign-in alone is not spend control.

**Dictation in the browser, not on the server.** Device dictation or the Web Speech API. No audio of someone discussing a student reaches the server. Cost: Firefox lacks the Dictate button; typing and OS dictation still work.

**Exports on the client.** The letter is the recommender's document; it is never stored as a file server-side.

## Left out on purpose
- **Payments:** nothing to charge for in an evaluation build.
- **Realtime presence, collaborative editing, messaging:** one person writes each letter; there is no co-editing or chat.
- **Google Workspace integrations:** per-user OAuth adds friction for a busy recommender with no gain over email.
- **Search, image, and other catalog APIs:** they would not improve a letter.
- **Server-side transcription:** see dictation above.
