# F115 stage 09: the answered pass and the sweep (2026-11-18)

What a later agent needs. Stage file: `spec/features/active/F115-e6a-reply-drafts/stages/stage-09-answered-sweep.md`. Behaviour rules: `docs/capabilities/drafts-and-send.md`, bullets "Answered pass (F115 stage 09)" and "Sweep (F115 stage 09)".

## Where the code is

- `apps/server/src/modules/actions/reply-pass.ts`: `checkReplyBeforeSend`. Called in `applySend` (`send.ts`, step 1a) for a `reply` only, before the copy check (1b). `closeForCopy` became `closeForReason`.
- `apps/server/src/modules/mail/repo/thread.ts`: `newerMailInThread` (D7; the interfaces file named it but no stage had built it). `mail/flags.ts` `refreshFlagsOfEmail` and `mail/repo/flags.ts` `getFlagTarget` (one mail, the same mail check and writer as the flag refresh). `mail/sent-view.ts` `isSentVisible`.
- `apps/server/src/modules/replies/sweep.ts`: `createReplySweep` (job `replies.sweep`, `main.ts` `40 */5 * * * *`, `bun run job:run --name replies.sweep`). It is NOT in `createReplyJobs`: that needs the model client, and the sweep must run with the LLM scope off. Reader: `actions/repo/reply-threads.ts` `listSweepReplySends`.
- Texts: `core/src/texts/approvals.ts` (en, pl), `core/src/digest/approvals.ts`, `core/src/notices/views.ts`, `channels/notices/send-result.ts` (`EXPIRY_REASONS`, now exported; `send-result-reasons.test.ts` pins that every `closeSendReasons` entry has a text).

## Choices made here (defaults, none needs the owner)

- **Reasons that only a reply has** (`answered`, `sent_by_user`, `newer_mail`, `original_moved`, `suspicious`) have no follow-up text: `renderFollowUpResult` throws `RangeError` for them (no code closes a follow-up with them). Only `draft_missing` and `draft_changed` apply to every kind.
- **`draft_missing` text** (stage 08 review N2) is one text for both causes (never made, or deleted, moved or sent in the mail client): "the draft is not in your Drafts folder (...)". Not a new reason code: `status_reason` stays `draft_missing`. The follow-up text and `deploy/README.md` follow.
- **`has_gaps`** has its own cause text (`causes.hasGaps`), no Send again button.
- **Pass order.** DB first (`newer_mail`, then `original_moved`), then the Sent header step, then the flag read of the original, then the answered decision. A newer mail wins over an answer. The sweep checks in the order of the stage text: `answered`, `newer_mail`, `original_moved`, `suspicious`, `policy_changed`.
- **Errors.** A thrown IMAP error in the pass goes through `copyCheckFailed`: soft = back to `approved` for 5 minutes, no count, 6 h soft cap then `failed` / `copy_check_error`; hard = a counted try; auth = mailbox `auth_error`. Sent sync flag off, switch off, no Sent folder, `cursor_moved`: go on with the flags only. Sent pass status `budget` (time ran out) is treated as a soft error: a partial read could miss the answer and the user would get a second reply. (This is a choice beyond the stage text, which names only `flag_off`, `off` and errors.) A UID that is gone or names another mail on the server leaves the stored flags and reads as "not answered by the flag".
- **No baseline and answered** ends `answered` and the copy stays (`kept = no_baseline`); the stage 08 carry-over said "keep the answered check first".
- **Sweep scope.** Org flag `reply_drafts` off: the sweep does nothing (the committer holds reply sends; the expiry job ends them 7 days after creation). A mailbox with no settings row is left alone. The limit of 200 is per run over all mailboxes (budget shared, oldest send first inside a mailbox), not per mailbox. `approved` sends with a stale `locked_at` (a dead committer) are not listed; the next claim takes them back.
- **Suspicious** uses `suspiciousReasonsOf` (the newest triage result; ignores the flag `suspicious_mail`, as the drafter does).
- **The `sentVisible: false` view field** is set by `approvalViewFor` (`channels/notices/approval.ts`) for a reply when the org flag `sent_sync` or the switch of the mailbox is off. The Telegram card text "I cannot see your sent mail" is stage 12; the panel field `sentVisible` of `ApprovalItem` is stage 15 (it can read the same helper `isSentVisible`).
- **Log lines.** The pass writes `reply_send_checked` with `result` = `answered`, `not_answered`, `newer_mail` or `original_moved` (and `status`, `kind` on the full pass); the copy check writes the same event with `same`, `changed`, `missing`, `no_baseline`. `actions-copy-check.test.ts` now filters to the copy codes. The sweep writes `reply_closed` (`action_id`, `reason`) and `reply_sweep_failed`.
- **Test hook.** `CommitterDeps.sentBudgetMs` / `ApplyDeps.sentBudgetMs` (the time budget of the Sent pass; absent = the default). Only a test sets it.

## For later stages

- Stage 12: print "I cannot see your sent mail" when the approval view has `sentVisible: false`; the expired tap text still says 48 h for a reply (7 days).
- Stage 15: `ApprovalItem.sentVisible` for a reply; the panel texts `appr_send_note`, `appr_edit_hint` (stage 08 note) are unchanged.
- Stage 17: the capability page has the two new bullets; `docs/known-alerts.md` has no entry for `reply_sweep_failed` (a warn line with `error_code`).
- No migration. No change of `TERMS_VERSION`; no legal text or registry changed.

## Repair after the Opus review (FAIL 41804a77; `spec/features/active/F115-e6a-reply-drafts/review-9.md`)

- **B1.** Only closes count against the cap of 200 per run. At most 1000 open sends are listed per run (`SWEEP_LIST_LIMIT`). Mailboxes are visited by the age of their oldest open reply send (`listMailboxesWithOpenReplySends`; a mailbox with nothing open is not in the list; `listSyncTargets` still decides which mailboxes are active). Test hooks: `SweepDeps.closeLimit`, `SweepDeps.listLimit`. Known limit: one mailbox with more than 1000 open sends starves its newest sends (the list is oldest first); not expected (replies live 7 days).
- **N1.** `closeSend(notify: "approved")` decides the notice from the row the close locks; the sweep uses it.
- **N2.** `isSentVisible` is false also for the Sent state `no_folder` or `folder_missing` and for a folder map with no `sent` key.
- **N3.** `listUserAnswers` counts a Sent mail only when a recipient (To or Cc) is the sender or an address of the Reply-To of the original. A row whose recipients the retention cleared (no stored recipient) is not judged by this rule (it counts as before: the existing test "still answers after the headers were cleared"). This also changes the `answered` fact of the drafter (`replyFactsOf`).
- **N4.** A Sent mail with `Auto-Submitted` other than `no` is no answer (`notAutomaticSql` in `mail/repo/shared.ts`). The header step of the Sent sync does not store that header (only the text step does), so the committer pass reads it once for the Sent mail that would count and is unread (`mail/sent-automatic.ts`, `markAutomaticAnswers`: UID plus Message-ID check, then `fetchContent`; reads only) and stores it only when automatic. The sweep reads the database only: a vacation reply that the text step has not read yet still counts there (a close of a draft, never a send).
- **N6.** `original_moved` needs `emails.moved_at` null (a move of the assistant does not count), in the pass and the sweep. The text says "moved to another folder" and names no folder (the view has none).
- **N7.** `newerMailInThread` ignores mail in the junk folder (`mailbox_folders` role `junk`, by folder or source folder), in the trash folder (`mailboxes.folder_map.trash`) and mail whose newest triage result is `spam`.
- **T1.** Test 2b is split (2b, 2c), test 4 and 6 are split (4h, 6b); no test of `replies-answered-pass.test.ts` has more than one GreenMail box. **T2.** Test T2 in `replies-sweep.test.ts`. **N10.** `newer_mail`: "Read the newer mail; a new draft may follow."; `suspicious`: "Read the mail with care; a new draft may follow." (the decision text "read the newer mail" does not fit a suspicious mail, so the wording is adapted); `original_moved` says what to do (answer it from its new place); en and pl.

## Mutation proof

Repair: `/tmp/f115-s09/mutations-repair.log` (script `/tmp/f115-s09/mutate2.py`, 39 mutants, 39 killed; the review round was run before a merge of master). First round: `/tmp/f115-s09/mutations.log`.


`/tmp/f115-s09/mutations.log` (script `/tmp/f115-s09/mutate.py`). The tmp files are not in the repo.
