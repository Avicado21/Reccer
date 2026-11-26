# Acceptance tests (deployed URL, real accounts)

The automated local version of this path (test accounts, dev outbox instead of real mail) is `tests/reccer.spec.ts`: `npx deepspace test run tests/reccer.spec.ts`.

Use three accounts: **S** (student), **R** (recommender), **X** (outsider). Use separate browser profiles or one normal window plus incognito. Record pass or fail and anything odd in `docs/AGENT_LOG.md`.

## Happy path
1. Signed out, open the app: student and recommender pages require sign-in.
2. S creates a request with two programs (different due dates) and a fact sheet containing a project name and a number.
3. Questions appear. None of them contains the project name, the number, or praise words. Fixed questions have no Remove button.
4. S removes one generated question, then sends the invite.
5. R's inbox: the email is from `DeepSpace Apps <notifications@updates.app.space>` (the platform ignores any other sender), lists both programs with the earliest due date first, and says the student cannot see the answers. It shows as formatted HTML with a "Start your letter" button, and the button opens the same link as the one printed under it. If S wrote a note to the recommender in step 2, it appears quoted under "A note from <S's name>:"; without a note, there is no note section. Replying to the email addresses S's sign-in email.
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

## Stage 2 features
26. Before inviting, S opens the request from the home page ("Review and send"): the saved details and questions load. S fixes the recommender's email and saves: the questions stay. S changes their preferred name and saves: a notice says the questions must be created again, and Send invite is refused until they are.
27. After inviting, S's home page shows "Invite sent <date, time>; not opened yet". S opens it: Resend and Cancel are offered, with the number of sends left.
28. S resends. The first email's link now says a newer invite was sent; the second link works.
29. S cancels an invite. The link says the invite was cancelled; S can edit details again and send a new one.
30. After R claims: S's home page shows "Accepted <date, time>", with no name or email of the account that claimed it, and Resend and Cancel are gone.
31. R edits a sentence to add a ranking word or a number that was not in the answer: the edit stands, and a note on that sentence says what was added.
32. R goes back to the interview, changes one answer, and rebuilds the draft: edits on other sentences are still there; an edit on the changed sentence is quoted in a note at the top of the draft.
33. Two identical sentences in a draft: editing the second changes only the second.
34. R types an answer and moves to another question within a second: the text is saved to the question it was typed on (check by going Back).
35. Deadline reminders: with a request whose earliest due date is within 7 days, let the daily task run (09:00 America/New_York) or, locally, `POST /api/dev/cron/deadline-reminders` as a test account. S gets a status-only email; R gets a nudge listing the due dates (with a resume link if in progress). Triggering again the same day sends nothing.

## Must fail (stage 2)
36. X calls `getMyRequestIntake`, `updateIntake`, or `cancelInvite` for S's request: refused.
37. S calls the reminder entry point from the client: refused (it runs only from the scheduled job).
38. S resends a 6th time: refused with a plain message.

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
