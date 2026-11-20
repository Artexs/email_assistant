PASS dffd8e648b2c62ebc306e00f9ed01447b8ac98c0

The plan can be built. Its code facts hold at HEAD, and `git diff --stat 535e6f76 HEAD -- apps docs packages` is empty, so the plan base equals HEAD for code. Nothing is blocking: this is a plan review, and no acceptance bullet of built code is broken. But findings F1 to F5 below would each let a false or incomplete legal text ship. The planner should fix them before stage 01 is spawned.

HEAD check: `git rev-parse HEAD` = dffd8e648b2c62ebc306e00f9ed01447b8ac98c0, which matches the candidate.

## Checks run
- `bun install --frozen-lockfile`: exit 0, 991 packages (log `/tmp/f153-review-install.log`).
- `bun test apps/docs/src/security/claims.test.ts apps/server/src/legal-papers.test.ts apps/web/src/lib/legal-version.test.ts`: exit 0, 47 pass, 0 fail (log `/tmp/f153-review-tests.log`). This is only the baseline at HEAD. It does not test the plan.
- No lint, typecheck, unit or docs:build run. This job changes no code.

## Findings (pre-mortem: the stage that lets the bug through)

**F1 · The history-check trigger list is incomplete in the stage texts. Stages 01 and 03 ship it. Proven (code read).**
`trust/repo.ts:27` has the reasons `connect, cli, web, model_switch, flag_on`. `trust.md:49` (rollout step 2) says turning on `trust_ladder` starts a `flag_on` check for each active mailbox. That is the first trigger the pilot will hit. Plan P6 (`plan.md:28`) says "the triggers in the text are those of `history_checks.reason` at HEAD". But the sense text in `stage-01:27` lists only "connected, on request, after a change of the AI model", and it says "tune words, not facts". `stage-03:101` says only "when a mailbox is connected". So P6 and the stage texts conflict. A Sonnet worker that follows the stage text writes a privacy policy and a public claim that leave out the main trigger. No test checks the triggers.
Fix: add "when the feature is turned on" to both sense texts, or say which rule wins.

**F2 · The planned sentence contradicts itself when the trust ladder is on. Stages 01 and 03 ship it. Plausible (wording).**
`stage-01:27` says "does not classify a mail older than 7 days, unless the operator loads old mail once (a backfill)". The same bullet then says the history check classifies mails of the last 30 days. `stage-03:101` (`text.en`) has the same pair. Row C032 will quote the first sentence alone, with condition `—`. As a standalone ledger row it is then false for an organization with `trust_ladder` on. The shared check (D1) cannot see this, because the line holds both "classif" and "context".
Fix (decision needed): make the history check a named exception in the 7-day sentence and in C032, for example "unless the operator loads old mail once, or the optional history check runs".

**F3 · The sub-processor registry row `openai` stays incomplete, and the privacy page renders it next to the new bullet. No stage fixes it. Proven (code read).**
`packages/core/src/legal/subprocessors.ts:44-45`: `dataReceived` is "mail text, subject, sender for triage and drafts". The privacy page renders this table (`apps/web/src/pages/legal/[lang]/[doc].astro:41`), and the DPA renders it as Annex 2 (line 42). After stage 01, one page states two different lists: P5 adds To/Cc, date and context mails, and the table keeps the old list. Ledger rows C136 and C139 (`claims.md:183,186`) quote the row. `trust.md:119` already says "that sentence and the matching row of the registries need the new case". The registry is part of `legalTextParts()` (`legal-checks.ts:75-85`). Fixing it later therefore needs a second legal version, which is the cost that P4 avoids.
Fix: add the registry rows `openai`/`gemini` and C136/C139 to stage 01, or put them in Out of scope with the reason.

**F4 · The deferred "same bump batch" items are not decided. Proven (read).**
The owner decision `docs/owner-decisions.md:600` names a batch for the same version bump:
- the one-click unsubscribe request line;
- the `members` subject of `unsubscribe-data`;
- the report-mail-into-INBOX line.

`trust.md:119` and `notes/2026-11-18-f110-s25-docs.md:18-27` say to batch them with the next legal change. At HEAD none of them is in the papers: no one-click or report-mail text in `privacy.md`, and `data-categories.ts:286` has `subjects: ["others"]`. The plan cites this owner decision for P4, but no decision in the plan takes or rejects the batch (grep of ticket, plan and stages: no match). Result: a second re-acceptance later.
Fix: add a decision (take the batch into stage 01, or reject it with the reason). If the plan does not take it, `trust.md:119` also becomes stale, because it still says the pages are not changed.

**F5 · The ticket and the plan conflict. Proven (read).**
- `ticket.md:31` (acceptance 1) says "Ledger rows C030 to C032 … state the thread context mails". `stage-01:34` says "C030 names only the provider and stays". C030 (`claims.md:61`) is "This install uses OpenAI as the AI model." A reviewer cannot pass acceptance 1 as written. Fix the ticket bullet to C031, C032, or change the stage.
- `ticket.md:42` says "stage 02 adds a legal version". `plan.md` § User checkpoints and `stage-02:86` say stage 01 does. The coordinator could hold the wrong stage for the release batch. It also cites "`plan.md` § User steps", but the heading is "User checkpoints and user steps".

## Notes

- **N1 · A stage-03 hand revert depends on a stage-01 choice. Plausible.** `stage-03:115` expects that removing C261 prints `proof_not_in_ledger apps/server/src/modules/mail/repo/lookup.ts`. `claimProblems` (`claims.ts:268`) accepts a proof when *any* cited row's source names the path or its file name. If the stage-01 worker puts `lookup.ts` in the source of C031 or C032, the expected failure never happens, and the stage-03 worker cannot meet "fails as written". Name the interface: only C261 cites `lookup.ts`.
- **N2 · Missing test for acceptance 3. Proven (read of the test lists).** No test checks that the privacy policy (en and pl) or the DPIA names the history check. The 7-day check passes without it, and D3 ties numbers only to rows C261/C262. A Polish text that leaves out the history sentence passes every check. The stage-01 review is the only guard. A similar gap: D3 ties the numbers only to the ledger. If `THREAD_MAILS` changes, the C261 test fails, but the privacy and claim texts with "three" and "500" stay.
- **N3 · An AI call that no paper names. Plausible.** The open-loops extractor sends the user's own sent mail to the AI provider. `loops/extractor.ts:36-49` sends subject, body, To, Cc and date; it runs under the flag `open_loops`, off by default. The "AI model" bullet that stage 01 rewrites (`privacy.md:46`) does not name it, and the ticket's Out of scope names only the reply-draft call. Decide: name it in the same version, or list it as out of scope.
- **N4 · The shared check is narrow. Plausible.** D1's patterns miss "7-day limit" (the wording on `security.mdx:56`) and "seven days". A future text such as "the 7-day limit covers all mail the AI gets" passes. Acceptable for the ticket, but worth one line in D1.
- **N5 · A hardcoded row count (code detail, not a finding).** `apps/docs/src/security/claims.test.ts:111-114` asserts `rows.size` is 260. Stage 01 adds C261/C262, so that file must change in stage 01, not stage 03. The Proof will show it. The stage-01 step-4 check runs only `legal-papers.test.ts`.
- **Facts checked against HEAD, all true:**
  - `listThreadContext`: `left(body_text, 500)`, `received_at < before`, `limit(3)`, no age filter (`lookup.ts:20-27`).
  - classifier-v2: `BODY_CHARS 8000`, `THREAD_MAILS 3`, `EXCERPT_CHARS 500`, and the From/To/Cc/Subject/Date block (`classifier-v2.ts:14-16,112-120`).
  - The production pointer is `classifier-v2` (`prompts/index.ts:147-153`).
  - The history check uses the same input builder (`classify-input.ts:1-2,27`). So each history mail also takes its context mails along; the "for each mail that it classifies" sentence covers this.
  - `HISTORY_SAMPLE_SIZE 500` and `HISTORY_COST_CAP_USD 0.25` (`history-classify.ts:35,41`); `HISTORY_WINDOW_DAYS 30` (`history-queue.ts:22`).
  - Both indexes export these constants (`trust/index.ts:10-29`). `THREAD_MAILS` and `EXCERPT_CHARS` are not exported from `triage/index.ts`; D3 already says to add the export.
  - `claimProblems` needs a claim condition when a cited row has one (`claims.ts:275-277`).
  - The ledger ids must be consecutive and in order (`legal-papers.test.ts:248-256`). Only the Total line of the counts table is tested (`:290-295`).
  - `dpia.md` and `claims.md` are not in the legal digest (`legal-checks.ts:75-85`), so stage 02 needs no new version.
  - The plan base `535e6f76` is an ancestor of HEAD, and its C032 text exists, as stage-01 case 1 needs.
- **Stage size:** each stage file is under 700 words, and stage 01 fits one job. No stage is too big.

## Note check
- HEAD matches candidate dffd8e6: proven. `git rev-parse HEAD` (a single call, exit 0) printed dffd8e648b2c62ebc306e00f9ed01447b8ac98c0.
- Plan facts checked against the code at HEAD: proven. Evidence is the files read: `apps/server/src/modules/mail/repo/lookup.ts`, `apps/server/src/modules/triage/prompts/classifier-v2.ts`, `apps/server/src/modules/triage/prompts/index.ts`, `apps/server/src/modules/trust/history-classify.ts`, `apps/server/src/modules/trust/history-queue.ts`, `apps/docs/src/security/claims.ts`, `apps/server/src/legal-papers.test.ts`, `apps/web/src/lib/legal-version.test.ts`. The baseline test log is `/tmp/f153-review-tests.log`.
- Final message format (first line `PASS <sha>`, file:line, labels): not proven by a file. This message is the only evidence, and no separate file holds it.
- Easy-to-miss rule (missing code detail is not a finding): followed. Every finding F1 to F5 is a missing decision, a missing test or a conflict. The code-detail item (the 260-row count) is note N5.
- Project reminder (merge master and run checks before the final message): not applicable. This is a review job that commits no product code, so I ran no merge and no checks.
