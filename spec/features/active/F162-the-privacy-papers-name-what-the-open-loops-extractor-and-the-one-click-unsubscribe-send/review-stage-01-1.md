PASS 5666c3903bde5f660964e8c29d9c383fc27192f6

I reviewed commit 5666c3903bde5f660964e8c29d9c383fc27192f6 (`git rev-parse HEAD` matches the candidate). `master` has no commits that HEAD lacks. The worktree was clean. I found no blocking finding: every new en and pl sentence in privacy, DPA and terms matches the code it describes, apart from two small wording gaps (notes 1 and 2).

**Unverified checks**
- The claims checks for ticket Acceptance 1 are unverified because I did not run them. These are `apps/server/src/legal-papers.test.ts`, `apps/docs/src/security/claims.test.ts` and `legal-version.test.ts`. The task said "Run no test suite". The `check:job` line of the worker was not in my brief. The row count pin (262 → 266) and the count table (`Later additions (F162)` 4 rows, total 266, gaps and unverified counts unchanged) agree by reading. All 8 source paths of C263–C266 exist.

**Sentences checked against code (proven by code read)**
- **Extractor input.** These sentences are correct: the subject, the local date, time and weekday, the recipient count, up to 8,000 characters of body, no header address, and an answer of at most 80 characters with a due date.
  - Fields: `extractorInputOf` in `packages/core/src/loops/extractor.ts`.
  - Prompt: `buildUserPrompt` in `extractor-v1.ts`.
  - Limits: `EXTRACT_BODY_MAX`, `EXTRACT_TEXT_MAX`.
  - Filters: 14 days, 10 recipients, list, auto and calendar mail, system drafts (`sentSkipReason`, called from `analyze-rules.ts:150`).
  - Gate: `open_loops`, `sent_sync` and the "Track my sent mail" switch (`trackingOn`).
  - One provider call per try: OpenAI `maxRetries: 0`, and `client.ts` has no retry.
  - The `openai` and `gemini` registry rows (en, pl) say the same.
- **One-click request.** These sentences are correct: one HTTPS POST, the fixed body `List-Unsubscribe=One-Click`, a fixed User-Agent, no cookie or sign-in, sent from the server address, no repeat, and the link not stored.
  - Request: `postOneClick` and `sendPinned` in `apps/server/src/platform/public-http.ts`.
  - No repeat: a second tap gets 409 `already_requested`, and nothing retries automatically.
  - Stored data: the sender address, the domain, the status and a code (`newsletter-unsubscribe.ts`).
  - Only an owner can tap: `requireOwner` in `newsletter-routes.ts`.
- **Report mail in every mode.** `report-mail-sender.ts` and `report-members.ts` never read the mailbox mode, so the mail goes into the INBOX in shadow mode too.
  - The "except a report mail" clause is now in privacy Actions, privacy AI and decisions, and terms, en and pl.
  - The DPA has no shadow-mode sentence.
  - The kinds "digest, weekly report, two trust notices" equal `reportMailKinds` (`digest`, `weekly_report`, `trust_report_ready`, `autonomy_paused`).
  - "Sends no mail" is true: the sender only APPENDs.
- **pl and en pages.** They carry the same facts and keep the same `##` headings.
- **Legal version.** `2026-11-20.2` is `nextLegalVersion("2026-11-20", "2026-11-20")` by the table in `packages/core/src/web/legal-version.test.ts`. I did not recompute the digest.
- **Ticket Acceptance 2, 3, 4 hold.**
  - The extractor call and its fields are in privacy "AI model", en and pl.
  - The one-click request is in the "Newsletter senders" bullet, en and pl.
  - The old `deploy/README.md` line is gone. Line 853 now says "Turn it on only on a release that carries the legal version that names the one-click request."

**Notes (none blocking)**
1. **Retry sentence puts two error kinds in the wrong place (proven by code read).** Privacy en and pl, claim C264, and plan P3 say: "When the AI service is busy or down, the call is tried again later, with no fixed limit." The code differs in two places (`apps/server/src/modules/loops/analyze.ts:231`, and `docs/capabilities/open-loops.md` rule 2):
   - A `timeout` counts as an attempt, so the row ends `failed` after 3 calls.
   - A configuration error (`http_401/402/403/404`, `http_429_quota`, `http_400_schema`) counts no attempt. Its retries have no fixed limit, but the text does not name this case.

   The first gap overstates the retries; the second leaves a case out. Possible wording: "A call that fails because of the mail, or that times out, is tried at most three times. When the AI service is busy, down or not set up correctly, the call is tried again later, with no fixed limit." Change the pl text, C264 and the digest entry with it.
2. **"You tap Unsubscribe" in the privacy page (proven: `requireOwner` at `newsletter-routes.ts:54`).** The Newsletters purpose and the "Newsletter senders" bullet (en and pl) say "after you tap Unsubscribe". Only an owner can tap, and the DPA and C265 say "an owner". A member who reads the privacy page may think they can tap.
3. **Subjects cell uses the code words (proven by file read).** The new `docs/legal/records-of-processing.md` cell for `unsubscribe-data` says `users, others`. Every other two-subject row of that table says `members, other people`. The plan text caused this. Use `members, other people`.
4. **Changed claim rows keep sources that do not cover their new clauses (proven by grep).** This applies to C015, C050 and C092 (the shadow-mode exception), C045 (report mail), C046 and C054 (open loops, newsletter unsubscribe) and C114 (DPA purposes). None of `docs/architecture.md` §4.3, `actions-and-undo.md` or `drafts-and-send.md` mentions report mail, open loops or unsubscribe. The stage did not ask for new sources on changed rows, and the new rows C263–C266 carry correct sources. Consider adding `docs/capabilities/trust.md` rule 19 / rule 21 and `docs/capabilities/open-loops.md` to those rows. Stage 02 (the code ties) is a natural place.
5. **Minor duplicate.** Privacy "AI results" (en and pl) now ends "…the system stores them. The system stores all of them." This is harmless but redundant.

**Checks I ran**
- `git rev-parse HEAD && git log --oneline HEAD..master && grep -n "Turn it on only on a release that carries the legal version" deploy/README.md && grep -c "^| C26[3-6] " docs/legal/claims.md` exited 0. HEAD is the candidate, master has no commits ahead, deploy line 853 is present, and the claims ledger has 4 new rows.
- `grep -n "A timeout is the exception" apps/server/src/modules/loops/analyze.ts && grep -n "export const EXTRACT_BODY_MAX = 8000" packages/core/src/loops/extractor.ts && grep -n "ONE_CLICK_BODY = " apps/server/src/platform/public-http.ts && grep -n "requireOwner," apps/server/src/modules/triage/newsletter-routes.ts` exited 0.
- `git show HEAD --word-diff` of all 13 changed files.
- I read the source files: `extractor.ts` (core and server), `extractor-v1.ts`, `analyze.ts`, `errors.ts`, `client.ts`, `public-http.ts`, `newsletter-unsubscribe.ts`, `newsletter-routes.ts`, `report-mail-sender.ts`, `legal-version.ts`, and `trust.md` rules 19 and 21.
- No test, lint or typecheck ran.

**Note check**
- HEAD is the candidate: proven. `git rev-parse HEAD && git log --oneline HEAD..master && grep -n "Turn it on only on a release that carries the legal version" deploy/README.md && grep -c "^| C26[3-6] " docs/legal/claims.md`
- New privacy, DPA and terms sentences match the code: proven, with notes 1 and 2 as non-blocking wording gaps. `grep -n "A timeout is the exception" apps/server/src/modules/loops/analyze.ts && grep -n "export const EXTRACT_BODY_MAX = 8000" packages/core/src/loops/extractor.ts && grep -n "ONE_CLICK_BODY = " apps/server/src/platform/public-http.ts && grep -n "requireOwner," apps/server/src/modules/triage/newsletter-routes.ts`; diff read beside `apps/server/src/modules/channels/report-mail-sender.ts`.
- Ticket Acceptance 1 (new claim rows name code; claims checks pass): not proven. The rows name existing code (`docs/legal/claims.md`). The claims checks did not run because the task forbids a test suite, and no worker `check:job` line was given.
- Ticket Acceptance 2 (privacy en and pl name the extractor call and its fields): proven. `apps/web/src/legal/en/privacy.md`, `apps/web/src/legal/pl/privacy.md` (line 48).
- Ticket Acceptance 3 (privacy en and pl name the one-click request): proven. `apps/web/src/legal/en/privacy.md`, `apps/web/src/legal/pl/privacy.md` ("Newsletter senders" / "Nadawcy newsletterów").
- Ticket Acceptance 4 (deploy/README line gone): proven. `git rev-parse HEAD && git log --oneline HEAD..master && grep -n "Turn it on only on a release that carries the legal version" deploy/README.md && grep -c "^| C26[3-6] " docs/legal/claims.md`
- Stage "Done when" 1 (Acceptance 2–4 hold; 1 holds for C263–C266): proven for 2–4 as above. Item 1 is not proven: the claims checks did not run.
- Stage "Done when" 2 (plan Proof exits 0; `check:job` line copied): not proven. It is a worker obligation, and a review may not run it.
- Verdict line `PASS <sha>`, blocking only on a proven acceptance break: proven. The first line of this message.
- Easy-to-miss rule "Run no test suite.": followed. The session ran only git, grep, sed, cat and awk, and no `bun test`, lint or typecheck.
- Reminder "Tests run once per job / no test:unit etc.": followed. No test command ran.
- Reminder "Commit jobs run `bun run check:job` last": not applicable. This is a review job with no commits.
- Reminder "A review job runs no test suite, lint or typecheck": followed. None ran.
- Reminder "Never delete `node_modules/.cache/`": followed. No file was deleted.
