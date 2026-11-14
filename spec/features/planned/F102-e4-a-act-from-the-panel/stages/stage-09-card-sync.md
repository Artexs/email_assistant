# F102 stage 09 — Card sync [risky]

Part of [`../plan.md`](../plan.md). Read D4, D5, F6, N1 and [`../commands.md`](../commands.md). Needs stages 05 and 08 landed (and 06 through 08).

`[risky]`: messages to people. Two steps in module `channels` and the composition roots.

## Step 1 — Queue and send card edits [risky]

- **Goal:** after a decision in any channel, every other Telegram card of that send shows the result and loses its buttons.
- **Files:** module `channels` (a new file for the hook, `sender.ts`, the outbox repository), the places that build `ApprovalDeps` (server main, web wiring, the approval CLI), tests.
- **Interfaces:** `cardEditHooks(db): ApprovalHooks` in `channels`; the composition roots pass it wherever `approve`, `reject` or `editApproval` run. `noApprovalHooks` stays only in tests that do not test cards.
- **Decisions:**
  - `onDecided` (same transaction) reads every outbox row of the organization with dedup key `approval:<sendId>`:
    - `sent` with a text and an `external_message_id`, user ≠ `exceptUserId` → one `approval_edit` row through `queueNotice`: same user, the target's locale and channel, dedup `approval_edit:<target id>`, `edit_of_outbox_id` = target, view = `{ original: target.text, outcome, at, timeZone, heldBy? }`;
    - `pending` → `failed`, `error_code = answered_elsewhere` (the card never goes out);
    - `sending` → nothing (accepted race: its buttons answer by the DB state).
  - Sets (`approval_set:` cards) get no edit (Q15 default: the set tap answers with counts).
  - The sender: a row with `edit_of_outbox_id` loads its target (same `org_id`, status `sent`, a message id), renders the view, calls `channel.edit(chatId, targetMessageId, message)`, then marks the row `sent` with the target's message id. No target → `failed` / `no_target`.
  - Edit rows skip the quiet hours (an edit makes no sound) and count in the per-user limit.
  - Errors: `bad_request` and `blocked` → `failed` / `edit_failed`, no retry (N1); `soft`, `rate_limited`, `config` → the existing release rules.
  - Log lines: row id, kind, error code; never the text.
- **Test** (integration, fake channel; owners U1 and U2 of O1 with linked chats; cards C1 (U1) and C2 (U2) of send S1, both `sent`; now `2026-11-20T13:05:00Z`, `Europe/Warsaw`):
  - T1: a web approval of S1 → two `approval_edit` rows; one sender run → two `edit` calls with the message ids of C1 and C2; each text = the stored card text + `⏳ Approved 14:05, sending.`; no buttons.
  - T2: a Telegram approval by U1 → one row, for C2 only.
  - T3: C2 `pending` at the web approval → C2 `failed` / `answered_elsewhere`; one edit row (C1).
  - T4: at `2026-11-20T22:30:00Z` (quiet time) an edit row goes out in the same run; an `urgent` row of U1 waits.
  - T5: the fake channel throws `bad_request` → the row `failed` / `edit_failed`; the next run does not take it. `soft` → released with a backoff.
  - T6: an edit of S1 (stage 08) → outcome `changed` on C1 and C2.
  - T7: a rejection → outcome `rejected`; a held approval (`SEND_SCOPE` `off`) → `approved_held` with `heldBy` `scope`.
  - T8: `onDecided` twice for S1 → still one row per card (dedup).
  - T9: a target row of organization O2 is never used for O1 (the query and the sender check `org_id`).
- **Done when:** T1–T9 pass.

## Step 2 — Version and panel link on the card

- **Goal:** the card of a new version says so, and every card links to the panel when the panel can show it.
- **Files:** `channels/notices/approval.ts` (`approvalViewFor` and the detector), its deps, tests.
- **Decisions:** D5. `version` = `draftVersion` of the draft. `panelUrl` = `<WEB_BASE_URL>/approvals?id=<send id>` only when `WEB_BASE_URL` is set and `approvals_page` is on for the organization (read once per detector run); a trailing `/` of the base URL gives no double slash.
- **Test:**
  - T10: flag off → the view has no `panelUrl`; flag on and `WEB_BASE_URL` = `https://ea.example.ts.net/` → `panelUrl` = `https://ea.example.ts.net/approvals?id=<S2>`.
  - T11: the card of S2 (version 2) holds the line `✏️ Version 2, edited in the panel.`; a version 1 card does not.
  - T12: `WEB_BASE_URL` empty → no `panelUrl`, also with the flag on.
- **Done when:** T10–T12 pass.

## Done when (stage)

- Steps 1 and 2 hold. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s09`).
