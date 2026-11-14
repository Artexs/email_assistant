# Actions and Undo

> Checked against the code at `1bd5003e`, 2026-11-14.

## What it does now

The committer is the only component that changes a mailbox. The job `actions.committer` runs every 15 s. For each active mailbox it expires stale `ready` originals, claims up to 20 `ready` rows that `ACTIONS_SCOPE` admits, opens one IMAP connection, and applies the rows one at a time. This page covers the mailbox changes (move, flag, mark read, save summary) and the frame that drafts and sends share; the drafts and the send are in `drafts-and-send.md`. A move, flag or mark read can repeat after a crash: the next run finds the mail by identity and writes the result once. A soft error retries without a count; the third hard error ends the action as `failed` and the owners get an `action_failed` notice. The user reverses the changes of a mail for 7 days with the ↩️ Undo button in Telegram or in the web activity list, and the committer applies the reverse rows. A mail that the user moves back by hand is seen by the sync and the job `triage.returned`: it marks the move `undone` and records a wrong verdict.

## Rules

1. **Only the committer changes the mailbox.** The pipeline is plan → policy → committer: planners are pure (`packages/core`), the policy decides inside the triage transaction, and the committer applies one action at a time (`docs/architecture.md` §4.1 rules 3–5; the policy table and the modes are in §4.3). A reverse row of an Undo is a normal action that the committer applies.
2. **Gates for a mailbox change.** A planned `move`, `mark_read` or `flag` is `ready` only when the policy said `apply`: the mode of the mailbox is `assist`, the switch of the type is on, and for `move` and `mark_read` the category has `auto` on and passed go/no-go (`decidePolicy`; the exceptions are in `docs/architecture.md` §4.3: an `unsure` mail moves only with the switch `move_unsure`, a VIP sender's mail is never moved or marked read, and a move needs a mailbox that supports moves). `ACTIONS_SCOPE` (env) is a second gate at the claim: `off` (default) claims no mailbox change, only `save_summary`; `synthetic` claims test mail only (a synthetic `Message-ID` or a sender in `TEST_SENDER_ADDRESSES`); `all` claims the mail of every active mailbox of an organization that is not `suspended`. The scope also decides if an Undo can start (rule 7). A row that the scope holds back stays `ready`; it expires after 24 h (rule 5). Under `off` the committer writes one `info` line for each mailbox and process when it holds `ready` rows back. `SEND_SCOPE` gates the send only (`drafts-and-send.md`).
3. **The committer job.** `actions.committer` runs every 15 s. It visits each active mailbox of every organization that is not `suspended` (`listSyncTargets`; a suspend during the run stops the next mailbox). Per mailbox it first expires stale `ready` originals (rule 5), then counts and claims. A mailbox-change row is claimable when its status is `ready`, `next_attempt_at` is null or past, and `locked_at` is null or older than 10 min. An original `move`, `flag` or `mark_read` also needs `created_at` within 24 h and a mail received within 7 days. A reverse row and `save_summary` have no age limit. The claim takes at most 20 rows (`FOR UPDATE SKIP LOCKED`), oldest mail first, and sets `locked_at`. The committer applies the rows in order and writes the result, the mail location and the audit row of each row in one transaction. The job is always built; `save_summary` rows are applied under every scope. A `send` over a send limit goes back to `approved` and waits (rule 3 of [drafts-and-send.md](drafts-and-send.md)).
4. **Idempotent actions** (moved from `docs/architecture.md` §4.1 rule 6): idempotent actions (move, flag, mark read, save summary) go `ready → applied` with no `applying` status and may repeat (S3, `actions/apply.ts`).
   The committer makes it so (the ensure rule, D5). A move first locates the mail by identity (`docs/architecture.md` §6.1) in the target folder and in the source folder.
   In both: delete the source copy (a leftover of a COPY before a crash), then `applied`. Only in the target: `applied` (the IMAP part was done before a crash).
   Only in the source: move, then `applied`. Nowhere: `failed` with `mail_not_found`. When the source folder is the target (a reverse after the user moved the mail back), it only locates and never deletes.
   After the IMAP call, `emails.folder`, `uid`, `moved_at`, the action status, `applied_at` and the audit row go in one transaction.
   A crash between the IMAP call and that commit leaves the action `ready`; the next run finds the mail in the target and writes the rows without a second IMAP change.
   - Check against the code: a flag or mark-read action does not use the ensure rule. It locates the mail in `emails.folder`, sets or removes the flag (`applyFlag`), and fails with `mail_not_found` when it finds the mail nowhere. Save summary writes the DB only and needs no IMAP.
5. **Retries live on the row that failed** (rule 7 of `docs/architecture.md` §4.1, first paragraph, stays there; the triage part is in [triage.md](triage.md)). The committer (S3; `actions/committer.ts`, `actions/apply.ts`, every 15 s) applies the rule to the action row as follows:
   - **Soft error** (a lost connection, a timeout): the row goes back to `ready` with `next_attempt_at` = now + 5 min and gets no count. The run stops for this mailbox; the rest of its batch is released.
   - **Login error** (`MailAuthError`): the mailbox becomes `auth_error` (the S2 notice), the batch is released with no count.
   - **Host refused** (`HostNotAllowedError` at the committer open, IMAP or SMTP host): the mailbox becomes `host_blocked` (`markHostBlocked`, `sync.md` rule 13), the batch is released with no count.
   - **Hard error:** `attempts` + 1 and a wait of 5 min. At 3 tries the action is `failed` (`status_reason` = `hard_error`) and the linked owners get an `action_failed` notice (rule 9 below).
   - **`mail_not_found`:** the action is `failed` at once, with no count. An original row gets no notice (the user moved or deleted the mail). A reverse row gets a notice.
   - **`bad_payload`** (a move without a known folder key): `failed` at once, no count, with a notice.
   - **Stale claim:** a row with `locked_at` older than 10 min is taken back with no count (the actions are idempotent).
   - **Expiry (D21):** the committer claims an original `move`, `flag` or `mark_read` only within 24 h of `created_at` and only for mail received in the last 7 days.
     At the start of each mailbox run it sets older `ready` originals to `expired` (`status_reason` = `stale`, audit `action.expired`). Reverse rows and `save_summary` never expire.
   - The committer opens one IMAP connection per mailbox per run, and only when it claims a mailbox-changing action. Order per mail: `save_summary`, `flag`, `mark_read`, `move`.
     - Check against the code: a batch that holds a `create_draft` or a `send` also opens the connection (and an SMTP connection when a send is `approved`); a batch of `save_summary` rows opens none. One batch of at most 20 rows (`DEFAULT_BATCH_SIZE`) runs for each mailbox in a tick.
6. **Moved back by the user:** `mail.sync` only sets `emails.returned_at` (when the system moved the mail, `docs/architecture.md` §6.1).
   The job `triage.returned` (every 15 s, no LLM) handles each flagged mail in one transaction. It locks the mail's latest original `move` action (the lock Undo takes too, so the two never both write feedback).
   When the move is `applied` and has no reverse row, or only a `failed` one, it sets the move to `undone` (`status_reason` = `user_moved_back`).
   It writes one feedback row (verdict `wrong`, source `imap_move`) only when there is no reverse row at all, the latest category is not `unsure`, and the latest feedback row has no `true_category` (a ✏️ label stays).
   It always clears `returned_at` and writes the audit row `email.returned`. A mail returned after an Undo gets no row, because the Undo wrote one.
   A second return of the same mail at Interia is not seen: after the first return the row says its source folder and leaves the below-cursor list (D12).
7. **Undo (S3):** the ↩️ button on a digest line (callback `fu:<emailId>`) works per mail. The tap runs `actions.undo()` in one transaction:
   it locks the mail's original actions and, for each `applied` original (`move`, `flag`, `mark_read`) whose `applied_at` is at most 7 days old and that has no reverse row, inserts a reverse row
   (same type and payload, `reverses_action_id` = the original, `ready`) and the audit row `action.undo_requested`. A `ready` original of the mail (a move in a retry wait) becomes `expired` (`status_reason` = `undo`).
   The committer applies the reverse row as the inverse operation (move: ensure the mail in its source folder, `emails.source_folder`; flag: remove `\Flagged`; mark read: remove `\Seen`),
   then sets the original to `undone` and writes the new location in one transaction. A reverse move that stops between the copy and the expunge leaves the mail in both folders;
   `emails.undo_pending_at` tells the sync to store no copy of it meanwhile (D22). An Undo into a `sort` folder (`Oferty`, `Społeczności`, `Rachunki`) is an APPEND transfer, not a COPY (U11, `docs/architecture.md` §6.1).
   A final failure of such an APPEND move (also of the rescue) leaves the mail in both folders; the `action_failed` notice tells the user (ADR 0014).
   The caller (the Telegram handler) writes the feedback row (verdict `wrong`, source `undo`) in the same transaction when at least one reverse row was created and the latest category is not `unsure`.
   The tap answers with a toast only: started, already requested, nothing to undo, too old (7 days), not possible now (`ACTIONS_SCOPE=off` or a paused mailbox: nothing is written), or "not in your account" (the same text as the feedback buttons).
   A move that a committer run holds at the second of the tap still finishes; the line then shows ↩️ again and the user taps again.
   - Check against the code: the same Undo runs from the web activity list (`POST /api/actions/undo`, the ↩️ button of the panel). The tap, the web button and the feedback row go through `undoWithFeedback` (`apps/server/src/modules/triage/undo.ts`), not through the Telegram handler alone. It writes the `undo` feedback row in the same transaction with `skipIfSame` and `keepLabel`, and only when `actions.undo()` answered `started` and the latest category is not `unsure`.
   - Check against the code: the answer "not possible now" (`held`) comes when the mailbox status is not `active`, or when `ACTIONS_SCOPE` does not admit the mail (`synthetic` holds mail that is not test mail too), not only for `off`. Telegram and the web answer "account paused" before this when the organization is `suspended` (`tenancy-and-plans.md`).
   - Check against the code: an APPEND transfer is also the rescue move of a spam folder mail into INBOX (`to` is INBOX and `emails.source_folder` is not INBOX), not only a move into a `sort` folder (`apply.ts`, `byAppend`).
8. **Mailbox settings.** The mode (`shadow` or `assist`), the switches (`move`, `mark_read`, `flag`, `move_unsure`, `create_draft`), the `auto` flag and threshold of each category, and the sync folders change through `bun run mailbox:settings`, or through the owner-only web routes (`PATCH /api/settings/:mailboxId/mode`, `/switches/:name`, `/auto/:category`, `/sync-folders/:key`; the settings page of the web panel). Each mode, switch or `auto` change writes one audit row (`mailbox.mode_changed`, `mailbox.policy_changed`, `mailbox.switch_changed`). `mode assist` sets the switches `move`, `mark_read` and `flag` on and `move_unsure` off, unless `--keep-switches` is given; the switch `create_draft` stays as it is. `auto` on needs the go/no-go gate (precision at least 98% on at least 30 labels, `triage.md`) unless `--force` is given. A change that closes a gate expires the `ready` rows it closes in the same transaction (`closedBy`; the list is in `docs/architecture.md` §4.3): `mode shadow` closes `move`, `mark_read`, `flag` and the sends; `auto` off, or a higher threshold, closes `move` and `mark_read` of that category; a switch off closes its type; `create_draft` off closes the sends.
   - Check against the code: `docs/architecture.md` §4.3 says the settings change only through `bun run mailbox:settings`. The web routes above exist too and call the same functions (`setMode`, `setToolSwitch`, `setCategoryAuto`).
9. **S3 jobs:** `actions.committer` (every 15 s; per active mailbox it expires stale `ready` originals, claims by `ACTIONS_SCOPE`, applies, rules 4 and 5 above)
   and `triage.returned` (every 15 s, always on; turns `returned_at` into feedback, rules 6 and 7 above).
   `channels.notifier` also detects failed actions: one `action_failed` notice per failed action (not for `save_summary`) to the linked owners (dedup `action_failed:<action id>`; `actions.notified_at` is set in the same transaction;
   a row older than 24 h is marked notified with no notice; an original row with `mail_not_found` gets none). The text names the action, the cleaned subject, "tried 3 times" and where the mail is.
   - One `action_failed` notice goes out for a `move`, `flag` or `mark_read` that failed, and for a reverse `create_draft`. A failed `create_draft` original and a failed `send` end in a `send_result` notice instead. The text and the buttons are in [digest-and-notices.md](digest-and-notices.md).

## Entry points

| Kind     | Name                                                                                                                              | Where                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| job      | `actions.committer` (`*/15 * * * * *`)                                                                                            | `apps/server/src/modules/actions/committer.ts`       |
| job      | `triage.returned` (`*/15 * * * * *`, always on)                                                                                   | `apps/server/src/modules/triage/returned.ts`         |
| CLI      | `bun run mailbox:settings` (`show`, `mode`, `auto`, `switch`, `sync-folder`, `expire-ready`)                                      | `apps/server/src/scripts/mailbox-settings.ts`        |
| CLI      | `bun run mailbox:probe-move` (a test mailbox only)                                                                                | `apps/server/src/scripts/mailbox-probe-move.ts`      |
| route    | `POST /api/actions/undo`                                                                                                          | `apps/server/src/modules/triage/routes.ts`           |
| route    | `GET /api/settings/:mailboxId`, `PATCH /api/settings/:mailboxId/mode`, `/switches/:name`, `/auto/:category`, `/sync-folders/:key` | `apps/server/src/modules/config/routes.ts`           |
| Telegram | callback `fu:<emailId>` (the ↩️ button)                                                                                           | `apps/server/src/modules/channels/callbacks.ts`      |
| page     | web activity list (↩️ Undo button)                                                                                                | `apps/web/src/components/activity/ActionButtons.tsx` |
| page     | web settings page (mode, switches, `auto`)                                                                                        | `apps/web/src/islands/SettingsPage.tsx`              |
| function | `createCommitterJob`, `createFolderResolver`                                                                                      | `apps/server/src/modules/actions/committer.ts`       |
| function | `applyAction`                                                                                                                     | `apps/server/src/modules/actions/apply.ts`           |
| function | `ensureMoved`                                                                                                                     | `apps/server/src/modules/actions/move.ts`            |
| function | `undo`                                                                                                                            | `apps/server/src/modules/actions/undo.ts`            |
| function | `expireReady`                                                                                                                     | `apps/server/src/modules/actions/expire.ts`          |
| function | `claimFilterFor`, `scopeAdmits`                                                                                                   | `apps/server/src/modules/actions/scope.ts`           |
| function | `claimActions`                                                                                                                    | `apps/server/src/modules/actions/repo/claims.ts`     |
| function | `expireStaleReady`, `expireReadyOriginals`                                                                                        | `apps/server/src/modules/actions/repo/expiry.ts`     |
| function | `insertReverse`, `lockActionsForUndo`, `lockLatestOriginalMove`, `markUndone`                                                     | `apps/server/src/modules/actions/repo/undo.ts`       |
| function | `undoWithFeedback`                                                                                                                | `apps/server/src/modules/triage/undo.ts`             |
| function | `processReturned`, `createReturnedJob`                                                                                            | `apps/server/src/modules/triage/returned.ts`         |
| function | `setMode`, `setCategoryAuto`, `setToolSwitch`, `closedBy`                                                                         | `apps/server/src/modules/config/service.ts`          |
| function | `buildSettingsView`                                                                                                               | `apps/server/src/modules/config/view.ts`             |
| function | `decidePolicy`                                                                                                                    | `packages/core/src/triage/policy.ts`                 |
| function | `isUndoable`                                                                                                                      | `packages/core/src/digest/undo.ts`                   |

## Data

`actions.status` flow (moved from `docs/architecture.md` §4.6; the `delegations.status` flow stays there for now). The `create_draft` and `send` lines belong to `drafts-and-send.md`.

```
actions.status:  (code map: apps/server/src/modules/actions/transitions.ts; tests compare it with the guards)
                 ready → applied                                      (idempotent: move, flag, mark read, save summary; the ensure rule, rule 4 of this page)
                 ready → expired                                      (stale: older than 24 h; policy_changed; undo; manual)
                 ready → applying → applied | expired                 (create_draft; expired = send_closed: its send ended before the APPEND)
                 ready | applying → failed                            (create_draft: bad_payload, or hard_error after 3 tries; its open sends expire: draft_missing)
                 awaiting_approval → approved → applying → applied    (send: applied at once after the SMTP 250)
                 awaiting_approval → rejected                         (the Reject tap)
                 approved → rejected                                  (the Reject tap on an approved send that no committer holds, or whose lock is stale)
                 awaiting_approval → expired                          (timeout: 48 h after notified_at, request received | draft_missing | not_notified: 7 days after creation, no owner | not_seen: request not received, at the resume of a suspended organization or 48 h after notified_at |
                                                                       policy_changed | delegation_closed)
                 approved → expired                                   (held_timeout: 48 h after the tap, when no committer holds it; or delegation_closed)
                 applied → undone                                     (Undo button, or the user moved the mail back: user_moved_back)
                 logged                                               (policy log_only, for example shadow mode)
                 ready | approved → same status, retry later          (soft error: no count; hard error: attempts + 1)
                 applying → applied                                   (create_draft recovery: Drafts search)
                 applying → ready                                     (create_draft: an error before the APPEND, on a row that the same call set to applying)
                 applying → applying                                  (create_draft APPEND error, or send recovery error: the row stays applying; the next claim tries again)
                 applying → approved                                  (send, a known stage before the content: a soft error without a count, a hard error with attempts + 1)
                 applying → applied | failed                          (send recovery: Sent search, else outcome_unknown)
                 applying → failed                                    (send: smtp_rejected | smtp_error | outcome_unknown; the third hard error before the content: smtp_error)
                 failed → new send row, approved                      ("Send again" after smtp_error | outcome_unknown; the failed row stays failed)
                 create_draft reverse row: ready → applied            (removes the draft after sent | rejected | expired; the original draft becomes undone; failed after 3 hard errors)
                 ready | approved | applying → failed                 (after 3 hard errors; notice to the user)
                 ready → failed                                       (mail_not_found, bad_payload: at once, no count)
                 approved → failed                                    (send: bad_payload, or the third compose error with smtp_error, before the SMTP call)
```

- `actions`: `type` (`move`, `mark_read`, `flag`, `save_summary`, `create_draft`, `send`), `payload`, `status`, `status_reason`, `attempts`, `next_attempt_at`, `locked_at`, `last_error` (no mail text), `provider_result`, `reverses_action_id` (a reverse row of an Undo; unique), `applied_at` (the Undo window counts from it), `notified_at` (set by the `action_failed` detector). The full column list is in `docs/architecture.md` §5.
- `emails`: `folder`, `uid`, `source_folder`, `inbox_uid`, `moved_at` (set by a system move), `returned_at` (set by the sync when the user moves a mail back), `undo_pending_at` (a system move into a synced folder is in flight).
- `mailbox_settings`: `mode`, `tool_switches`, `category_policy`.
- Audit events: `action.applied`, `action.failed`, `action.expired`, `action.undo_requested`, `action.undone`, `email.returned`, `mailbox.mode_changed`, `mailbox.policy_changed`, `mailbox.switch_changed`, `mailbox.folder_created`.

## Limits

- No web list of actions with approve and reject; the panel has the Undo button only: E4-A (F102).
- The transition table `transitions.ts` is data only: no runtime code checks a write against it. Tests compare it with the guards of the writers; a runtime guard is `F068-actions-transitions-runtime`.
- `emails.status = 'done'` is in the CHECK of the table but no code writes it. Check against the code: `grep` finds no write of `done` to `emails.status` in `apps/server/src` or `packages/core/src` (`docs/product/stage-2/06-architecture-review.md` §3.15).
- The Undo window is 7 days (`UNDO_WINDOW_MS`) and a stale `ready` original expires after 24 h. No setting changes them.
- An Undo needs an `active` mailbox and an `ACTIONS_SCOPE` that admits the mail (under `synthetic`: test mail); otherwise the answer is `held` and nothing is written.
- Only moves, flags and mark read can be undone. A sent mail cannot (`drafts-and-send.md`).

## Decisions

- ADR 0003 (plan, policy, commit), ADR 0008 (minimal audit log), ADR 0014 (sync provider sort folders; the APPEND transfer).
- `docs/architecture.md` keeps the flow (§4.1 rules 1–5), the categories (§4.2) and the modes and the policy table (§4.3).

## Tests

- `apps/server/test/integration/actions-committer.test.ts`
- `apps/server/test/integration/actions-apply.test.ts`
- `apps/server/test/integration/actions-move.test.ts`
- `apps/server/test/integration/actions-undo.test.ts`
- `apps/server/test/integration/actions-transitions.test.ts`
- `apps/server/test/integration/actions-expiry.test.ts`
- `apps/server/test/integration/actions-end-to-end.test.ts`
- `apps/server/test/integration/triage-returned.test.ts`
- `apps/server/src/modules/actions/transitions.test.ts`
- `apps/server/src/modules/actions/scope.test.ts`
- `apps/server/src/modules/actions/completeness.test.ts`
