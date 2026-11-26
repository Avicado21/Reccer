# Writeup draft (fill in from what actually happened; keep it short)

**Live:** https://<name>.app.space   **Repo:** <url>

## What I built
Reccer: AI assisted, not AI generated letters of recommendation. A student sets up a request with their programs and due dates; their recommender gets an email invite, signs in with their own account, and answers a short interview by typing or dictation. Reccer turns the answers into a draft made of the recommender's own words, checks in code that nothing was invented, and lets them edit and export to text, PDF, or Word. The student gets status updates, never the letter: when the invite was sent, whether it was accepted, and when the draft is ready. They can reopen and fix a request before inviting, and resend or cancel an invite that has not been accepted. Both people get a reminder email as the earliest deadline approaches.

## DeepSpace features and integrations
**Platform features:** auth (Google or GitHub), records, server actions holding every permission check, per-user ownership, deploy.
**Integrations:**
- `anthropic/chat-completion` (Claude Sonnet 5.5), called twice: once to write neutral interview questions, once to clean up and order answers. Both outputs are validated by my code; both fall back to non-LLM paths; both are capped per request and behind sign-in.
- `email/send`: the invite to the recommender, a status-only notice to the student, and deadline reminders to both (status only for the student). The platform always sends from `DeepSpace Apps <notifications@updates.app.space>`, so every email comes with a plain HTML version (a "Start your letter" button on the invite) to look trustworthy, and recommender mail sets `reply_to` to the student so replies reach a person. The student can add an optional note to the recommender, which is quoted in the invite. It is never sent to the model and never appears in the letter.
**Left out on purpose:** payments, presence, collaborative editing, messaging, Google Workspace, search. None improves a letter (see `docs/DECISIONS.md`).

## Main tradeoff
<one paragraph, from DECISIONS.md: constrained assembly plus a deterministic claim check, over fluent generation.>

## What the agents did
- **Claude (claude.ai), stage 1, in a sandbox without network access:** designed the architecture; wrote the SDK-free core (question layers, leading-question validator, prompts, assembly, claim check, exports, invite tokens), all server-action logic and permission rules against a test runtime, 25 tests, and first drafts of the pages; rendered two pages in a headless browser. It could not install the SDK, so the SDK adapter, schemas, and client transport were marked unverified.
- **firstmate + Opus, stage 2, lane 2 (product, SDK-free layers):** fixed edits being wiped on a re-finish and edits landing on the wrong one of two identical sentences (stable sentence ids); made a concurrent double claim of one invite leave exactly one recommender; bound autosave to the question it was typed for; tuned the claim check so ordinary "first", "only", and "most" stop flagging while real rankings still do; added reopen-and-edit for students, invite resend, cancel, and status, advisory checks on the recommender's own edits, and deadline reminders. Each change ships with tests (unit tests 25 to 64, plus an end-to-end flow). After lane 1 landed: rebased onto the scaffold layout, registered the new actions, added the schema columns, and scheduled the reminders as a DeepSpace cron task.
- **firstmate + Opus, stage 2, lane 1 (SDK):** <scaffold, verified integrations, implemented the adapter and schemas, routing, deploy. Pull from AGENT_LOG.md.>

## What I verified or changed myself
- <e.g. ran the two-account acceptance tests on the deployed URL: results>
- <e.g. checked the student could not reach answers or drafts by URL>
- <e.g. caught and fixed: …>
- <decisions I made: invite design instead of shared credentials; neutral questions with facts kept in memoryJog; …>

## Unfinished, and what I would do next
- **Forwarded invite links:** anyone holding the link can claim it, so a student with a second account could claim their own invite. I kept this on purpose, because recommenders often sign in with a different address than the one the student typed. Reccer refuses the student's own account and allows one claim per invite, but it cannot tell that two accounts are one person. Next step: optionally require the email to match, with an owner-visible override.
- **Re-finishing an LLM draft drops most edits** (the sentences are reworded); each dropped edit is quoted back so nothing is lost silently.
- **Claims without a conditional write:** write, re-read, and repair make a double claim end with one winner; a compare-and-set in the SDK would close the window fully.
- <the rest of HANDOFF.md section 5, plus anything cut tonight>
