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

## Mutation proof

`/tmp/f115-s09/mutations.log` (script `/tmp/f115-s09/mutate.py`). The tmp files are not in the repo.
