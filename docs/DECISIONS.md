# Decisions and tradeoffs

**Main tradeoff: constrained assembly over fluent generation.** The LLM may only clean up and order the recommender's answers, and a deterministic check enforces that afterwards. Cost: drafts are less polished than a fully generated letter. Benefit: every claim traces to something the recommender said, which is the point of the product.

**Claim check is code, not another LLM call.** A second model grading the first would share its failure modes. String rules are predictable, testable, and explainable in an interview. Cost: heuristic false positives (capitalized common words). They only produce a dismissible flag, never a silent change.

**Invite link, not shared credentials.** DeepSpace sign-in is Google or GitHub only, and a shared login would let the student read and edit the letter. The token is single-claim, expires in 30 days, is stored only as a SHA-256 hash, and the student's own account is refused.

**Forwarded links keep working; the login email does not have to match.** Recommenders often sign in with a different address than the one the student typed (a personal Gmail instead of a work address), and some forward the invite to an assistant. Requiring a match would break those real cases. Cost: anyone holding the link can claim it, so a student with a second account could claim their own invite. That is documented, not prevented. The student cannot cancel or reissue an invite once it is claimed, and the status they see never says which account claimed it.

**Resend and cancel, capped.** A resend emails a new link and turns off the old one, so at most one unclaimed link is live. Cancel unlocks the request for edits. Sends are capped at 5 per request because email is owner-billed and a student should not be able to flood a recommender.

**Edits key on what a sentence is, not where it sits.** Sentence ids are derived from section, scope, sources, and original text, so they survive re-sorting, duplicates, and a re-finish that produces the same sentence. The alternative (positions, or matching by text) silently attached edits to the wrong sentence. Cost: when the LLM rewords a sentence on a re-run, its edit cannot be carried over. Reccer says so and quotes the edit back instead of guessing where it belongs.

**Ranking words are judged in context, still in code.** "First", "only", "most", "top", "higher", and "better" are ordinary words; flagging every use taught recommenders to ignore the flags. They now flag only inside ranking phrases ("the only intern who", "top three"), matched by plain regular expressions. Still deterministic, still testable. Praise words with no ordinary use ("exceptional") flag on any use.

**The recommender's edits are checked, but only advised.** The edit is their own words, so it stands. The same rules still run on it and show as notes ("your edit adds the number 15, which is not in your original answer"), which catches typos and accidental overstatement without overriding the author.

**All collections are server-action-only.** The rules ("only the recommender of this request") are row-level. Rather than depend on how expressive collection permissions are, every read and write goes through actions that check identity. Cost: the student status page polls instead of syncing in realtime.

**Generation is an enhancement, never a dependency.** If LLM call 1 fails, returns bad JSON, or yields too few neutral questions, the default bank is used. If call 2 fails, the deterministic draft is used. The core path works with zero LLM calls.

**Fixed questions for identity, ranking, rating, and close.** Rankings and ratings must not depend on model phrasing, and the student cannot remove them.

**Student facts go in memoryJog, never question text.** Facts in a question become claims the recommender echoes. The recommender sees them only on request.

**Caps on paid calls.** Three generations per request, three assemblies per draft, all behind sign-in. Owner-billed integrations accept anonymous callers, so sign-in alone is not spend control.

**Owner-billed integrations are server-only; the scaffold's agent tool surface is off.** The browser proxy `/api/integrations/:name/:endpoint` refuses every developer-billed integration without `browser: true` in `src/integrations.ts` (none has it), so a signed-in account cannot call Anthropic or email directly and skip the caps; `registerAgent` runs with `local: false` because Reccer has no use for `/_deepspace/agent`.

**Reminders run only from the scheduler, and carry no new claim link.** `sendDeadlineReminders` reads across every request, so it refuses any runtime that is not the scheduled job's. Minting a fresh claim link from a cron would put a working credential in an email nobody asked for; the reminder points to the original invite instead, and the student can resend.

**Dictation in the browser, not on the server.** Device dictation or the Web Speech API. No audio of someone discussing a student reaches the server. Cost: Firefox lacks the Dictate button; typing and OS dictation still work.

**Exports on the client.** The letter is the recommender's document; it is never stored as a file server-side.

## Left out on purpose
- **Payments:** nothing to charge for in an evaluation build.
- **Realtime presence, collaborative editing, messaging:** one person writes each letter; there is no co-editing or chat.
- **Google Workspace integrations:** per-user OAuth adds friction for a busy recommender with no gain over email.
- **Search, image, and other catalog APIs:** they would not improve a letter.
- **Server-side transcription:** see dictation above.
