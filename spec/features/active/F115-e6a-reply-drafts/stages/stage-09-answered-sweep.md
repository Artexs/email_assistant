# F115 stage 09 — Answered check and sweep

Part of [`../plan.md`](../plan.md). `[risky]` (exactly-once to people). Needs 07, 08. Checkpoint C1 after this stage (not a stop).

No double reply: the committer checks "already answered" right before a reply send, and a sweep closes open reply drafts whose reason to exist ended.

## Step 1 — Pre-send pass (reply sends only)

- **Goal:** in `applySend`, for kind `reply`, before the copy check of stage 08:
  0. The DB checks first: `newerMailInThread` (mail index; D7, automatic mail does not count) → `newer_mail`; the original's folder ≠ payload `folder` → `original_moved`. Each close is `closeSend(…, notify: true, claimed: true)`; the copy is deleted only if unchanged.
  1. `syncSentHeaders` for the mailbox with the committer's open provider as the `SentFolderReader` (D10; header step only, no text step). Status `flag_off`, `off` or an error → go on with the flags only; log the result code in `reply_send_checked`.
  2. `fetchFlagsIn(<original folder>, [original uid])` and update `email_flags` for that mail (the same writer as the flag refresh).
  3. Answered = `email_flags.answered` or a `listUserAnswers` hit.
  4. Then the stage 08 copy check. Answered and copy unchanged → `expired` / `answered`, `notify: true`, the copy removed; answered and copy missing → `expired` / `sent_by_user`, `notify: true`; answered and copy changed → `draft_changed` (stage 08). Not answered → stage 08 rules.
- **Decisions:** a soft IMAP error in 1–2 → back to `approved`, 5 min, no count. Reason texts for the result notice (en, pl): `answered` "You already answered this mail. Nothing was sent.", `sent_by_user` "It looks like you sent it from your mail client. Nothing was sent.", `newer_mail` "A newer mail arrived in this thread. Nothing was sent.", `original_moved` "The mail left the inbox. Nothing was sent."
- **Test (integration, GreenMail, fake clock):**
  1. Approved reply; the test puts a user reply with `In-Reply-To` = the original in Sent; flag `sent_sync` and the switch on → `answered`, zero SMTP calls, the copy deleted.
  2. The same, and the test also deleted the copy → `sent_by_user`.
  3. `sent_sync` off; the original has `\Answered` on the server → `answered`.
  4. `sent_sync` off, no flag → sent; the card of stage 12 says "I cannot see your sent mail" (a view field `sentVisible: false`, set here in the approval view).
  5. A newer mail in the thread after the tap → `newer_mail`, zero SMTP calls.
  6. A delegation send → no Sent pass (one IMAP session trace without the Sent folder).

## Step 2 — The sweep

- **Goal:** job `replies.sweep` (every 5 min) closes open reply sends (`awaiting_approval`, or `approved` without `locked_at`) with `closeSend(claimed: false)` for: answered (`email_flags` or `listUserAnswers`, DB only, no IMAP), `newer_mail`, `original_moved`, `suspicious` (flagged after the draft), `policy_changed` (switch off, shadow mode). `notify` is false for `awaiting_approval` and true for `approved` (the user tapped Send and waits for a result). At most 200 sends per run, oldest first.
- **Decisions:** D11, D12. The sweep reads no mailbox. Each close is its own transaction with the advisory thread lock (D7). One event line `reply_closed` per close (`action_id`, `reason`).
- **Test (integration):**
  1. An open reply; the test sets `email_flags.answered` → next sweep: `expired` / `answered`, no result notice row. The same for a held `approved` reply → one result notice row.
  2. A newer mail in the thread → `newer_mail`; a newer out-of-office mail (`Auto-Submitted: auto-replied`) → stays open.
  7. A later triage result with `auth_fail` → `suspicious`.
  3. The original's `folder` changed to `Archive` → `original_moved`.
  4. The switch turned off → `policy_changed`; a delegation send of the same mailbox stays open.
  5. An `approved` reply with `locked_at` set → untouched.
  6. Org isolation: an org B send is never closed by org A data.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** Telegram cards (12), the panel (15).

## Carry-over from stage 07

- The drafter job closes an older open reply of the thread only when it writes a draft for a newer mail (`newer_mail`, `closeSend` with `notify: false`, `claimed: false`; `busy` is left to the sweep). A newer mail in the thread that has no open reply and no request does not stop a draft for the older mail. The sweep (`newerMailInThread`) must close such a draft; test it with an older mail drafted first and a newer mail of another category after it.
- A `busy` older reply that the job left (an `applying` send, or an `approved` one under a fresh lock) is yours: the committer or the sweep ends it.
- Notes: `notes/2026-11-18-f115-s07-drafter-job.md`.

## Carry-over from stage 08

- The copy check is in `applySend` as step (1b), before the send commits as `applying` (`copy-check.ts` `checkCopyBeforeSend`, `send.ts` `closeForCopy`). The pre-send pass of this stage goes before it, in the same place: answered and copy unchanged → `answered`; answered and copy missing → `sent_by_user`; answered and copy changed → `draft_changed`. `checkCopyBeforeSend` answers `close` with `draft_missing` for a missing copy; this stage maps it to `sent_by_user` when the mail is answered.
- `ApplyOutcome` `expired` now has the reasons `draft_changed` and `draft_missing`. `closeSend` is called from the committer with `claimed: true` and `ApprovalHooks` from `CommitterDeps.approvalHooks` (wired in `committerDeps`); the sweep has no committer, so it passes its own hooks.
- Result texts: stage 08 added `draft_changed` (en, pl; `SendResultKind`, `views.ts`, `send-result.ts` `EXPIRY_REASONS`). The reasons `answered`, `newer_mail`, `original_moved`, `suspicious` and `sent_by_user` still have none, and `closeSend(notify: true)` of them is skipped with a warning until you add them in the same four places. `draft_missing` says "the draft could not be created": a missing copy is a different cause; give it its own text.
- A reply with no `copy_hash` ends `draft_missing` before the answered pass could say more: keep the answered check first.

## Carry-over from the stage 08 review

- N2: after "edit and send in your mail client" a `draft_missing` end is the likely outcome (the user sent it, or the client dropped the `X-EA-Action-Id` header): its text "Not sent: the draft could not be created" is wrong: write a text that fits.
