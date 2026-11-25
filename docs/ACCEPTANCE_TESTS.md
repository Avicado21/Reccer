# Acceptance tests (deployed URL, real accounts)

The automated local version of this path (test accounts, dev outbox instead of real mail) is `tests/reccer.spec.ts`: `npx deepspace test run tests/reccer.spec.ts`.

Use three accounts: **S** (student), **R** (recommender), **X** (outsider). Use separate browser profiles or one normal window plus incognito. Record pass or fail and anything odd in `docs/AGENT_LOG.md`.

## Happy path
1. Signed out, open the app: student and recommender pages require sign-in.
2. S creates a request with two programs (different due dates) and a fact sheet containing a project name and a number.
3. Questions appear. None of them contains the project name, the number, or praise words. Fixed questions have no Remove button.
4. S removes one generated question, then sends the invite.
5. R's inbox: the email is from `DeepSpace Apps <notifications@updates.app.space>` (the platform ignores any other sender), lists both programs with the earliest due date first, and says the student cannot see the answers.
6. R opens the link, signs in, and lands on question 1. The link still works after the sign-in redirect.
7. R gives a one-sentence answer: the follow-up question appears once, then moves on.
8. R taps "Show the student's notes" on a question with notes; the notes appear.
9. R closes the tab midway, reopens the link: answers are kept and R resumes at the first unanswered question.
10. R skips one question, answers the rest, and finishes.
11. The draft opens with one tab per program. Each letter includes only its own fit paragraph.
12. Clicking a sentence shows the answer it came from.
13. R rewrites one sentence; it saves and any flags on it disappear.
14. With name and email filled in: Copy text, Save as PDF, and Download Word file all work. Open the .docx in Word or Google Docs.
15. S's inbox: the completion email has no letter content. S's home page shows "Your recommender has a draft."

## Must fail
16. S opens R's invite link while signed in as S: refused.
17. S opens `/recommender/interview?id=<id>` and `/recommender/draft?id=<id>`: refused.
18. X opens the already-claimed invite link: refused. (Before R claims it, whoever signs in with the link first gets it; by design, see `DEPLOY.md`.)
19. X opens the interview and draft URLs: refused.
20. A link with a changed token: refused with a plain message.
21. Finish four times as R: no more than three LLM assembly calls (`npx deepspace app usage` or the logs); later drafts use the answers as written.
22. Regenerate questions four times as S, before inviting: no more than three LLM calls.
23. View the deployed page source and network responses as S: no answer or letter text, and no API keys anywhere.

## Failure handling
24. Temporarily break the LLM endpoint name: question generation falls back to the standard questions with a notice, and finishing still produces a draft. Restore it afterwards.
