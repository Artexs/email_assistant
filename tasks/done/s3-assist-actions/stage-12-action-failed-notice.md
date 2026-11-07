# s3-assist-actions — Stage 12

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 12 — Notice `action_failed` [risky]

- [x] **12.1 Text, outbox kind and detection (D11)**
  - Goal: after 3 hard errors the owners get one notice per failed action through the S2 outbox; an original `mail_not_found` gives none, a reverse (Undo) `mail_not_found` gives one (Q1 default); a second run makes no second row.
  - Files: change `packages/core/src/digest/notices.ts`, `packages/core/src/digest/notices.test.ts` (`renderActionFailedNotice`), `apps/server/src/modules/channels/repo.ts` (`outboxKinds` + `"action_failed"`), `apps/server/src/modules/channels/notices.ts` (`detectActionFailed`), `apps/server/test/integration/channels-notices.test.ts`, `apps/server/test/integration/channels-outbox.test.ts` (one case: the new kind inserts with `emailId` and fails without).
  - Interfaces:

    ```ts
    // core
    export function renderActionFailedNotice(input: {
      actionType: "move" | "flag" | "mark_read";
      reverse: boolean;
      reason: "mail_not_found" | "bad_payload" | "other"; // mail_not_found only reaches here for a reverse row; bad_payload = an unknown folder key (stage 9.1a guard)
      folderName: string | null /* AI_FOLDER_NAMES[key] for a move */;
      from: string | null;
      subject: string | null;
      synthetic: boolean;
      attempts: number;
    }): OutMessage;
    // channels/notices.ts
    export const ACTION_FAILED_LOOKBACK_MS = 24 * 3_600_000;
    export const ACTION_FAILED_LIMIT = 50;
    ```

  - Decisions:
    - Texts (plain text, no buttons): original move → `⚠️ Could not move a mail to <folder>` / `From: <senderLabel>` / `Subject: <cleanSubject>` / `Tried <attempts> times. The mail stays in INBOX. /status shows the mailbox state.`; original flag → `⚠️ Could not flag a mail`; original mark read → `⚠️ Could not mark a mail read`; reverse move → `⚠️ Undo failed: could not move a mail back to INBOX` … `The mail stays in <folder>: move it by hand.`; reverse flag → `⚠️ Undo failed: could not remove the flag` …; reverse mark read → `⚠️ Undo failed: could not mark a mail unread` …; a reverse with `reason` `mail_not_found` (Q1) → the reverse first line of its type, then From and Subject, then `The mail was not found: it was moved or deleted in the mail client.` instead of the `Tried …` line; a `bad_payload` row (`attempts` 0, no folder name for an unknown key, re-review Rm7) → the first line without a folder (`⚠️ Could not move a mail`), then From and Subject, then `The plan had an unknown folder. The mail stays in INBOX.` instead of the `Tried …` line; `folderName` null in any other case → the first line ends after `a mail` (no folder); `🧪 test` after the first line for synthetic mail (`synthetic` = `isSyntheticMessageId(action.message_id_header)`). The sender, subject and folder name go through the S2 text helpers (`senderLabel`, `cleanSubject`, `cutText`).
    - `detectActionFailed(db, ctx, owners, now)`: `listFailedUnnotified({ limit: ACTION_FAILED_LIMIT })` (no time filter, M11); for each action, one transaction: when `updated_at < now − ACTION_FAILED_LOOKBACK_MS` → only `markNotified(actionId, now)` (too old for a notice; the list stays short); else render the text (`reason` from `status_reason`: `mail_not_found` and `bad_payload` as they are, every other code `other`) and `insertOutbox` per owner (`kind: "action_failed"`, `dedupKey: action_failed:<actionId>`, `emailId`), then `markNotified(actionId, now)`; a dedup conflict (null id) still marks. No owners linked → mark anyway (the notice has nobody to go to; D13 of S2: owners only). Original rows with `status_reason = mail_not_found` are not listed; reverse rows with it are (repo filter, stage 7.1b).
    - Call site: `detectForOrg` after `detectUrgent` (the same `owners` list). Quiet hours apply through the sender (S2 P4).
    - `/status` (stage 13) shows the failed count of the last 24 h, so a user who missed the notice still sees it.
  - Test: `notices.test.ts` (core): the six text shapes contain the verb, the folder, the subject and `Tried 3 times`; a reverse with `reason` `mail_not_found` has the "not found" line and no `Tried` line; `bad_payload` has the first line `⚠️ Could not move a mail` (no folder), the unknown-folder line and no `Tried` line; the subject is cleaned (links → `[link]`); `🧪 test` only for synthetic. `channels-notices.test.ts` (`isolateChannels`, an owner and an assistant linked): (1) a `failed` / `hard_error` move with `notified_at` null → one outbox row for the owner, none for the assistant, `kind` `action_failed`, `email_id` set, text with the subject marker; `actions.notified_at` set; (2) a second `detectNotices` run → no new row; (3) an original `mail_not_found` → no row, `notified_at` stays null; (3b) a reverse `mail_not_found` move → one outbox row with the "not found" text, `notified_at` set; (4) a failed action whose `updated_at` is 30 h old → listed (no time filter), no outbox row, `notified_at` set; (5) a reverse failed move (`hard_error`) → the Undo text; (6) org B's failed action gives org A nothing. `channels-outbox.test.ts`: kind `action_failed` without `email_id` → `23514`.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: a notice per applied move (P4: none), the digest.
