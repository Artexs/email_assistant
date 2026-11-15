# F102 stage 09 — Card sync [risky]

Part of [`../plan.md`](../plan.md). Read D4, D5, F6, N1 and [`../commands.md`](../commands.md). Needs stages 06 and 08 landed.

`[risky]`: messages to people. Two steps in modules `actions` and `channels` and the server wiring.

## Step 1 — Decisions edit the cards [risky]

- **Goal:** after a decision in any channel, every other Telegram card of that send shows the current result, and an old edit never overwrites a newer state.
- **Files:** `actions/approvals.ts` and `editApproval` (the `onDecided` calls), `channels/card-edits.ts` (`cardEditHooks`), the shared held check, `channels/sender.ts`, the server wiring that builds `ApprovalDeps` (main, and the web wiring once stage 11 uses it), tests.
- **Interfaces:**
  - `approve`, `reject` and `editApproval` call `deps.approvalHooks.onDecided` in their transaction after a change: `approved`, `rejected`, `changed`; `exceptUserId` = the user when `via` is `telegram` (the tap edits its own card).
  - `heldReason(deps, ctx, sendId): Promise<HeldBy | undefined>`: move the check that the Telegram toast uses into one exported `channels` function; the tap, the hook and stage 11 call it.
  - `cardEditHooks(deps: { sendScope })`: `onDecided` turns `approved` into `approved_held` + `heldBy` when `heldReason` names a cause, then calls `queueCardEdits` (stage 06).
- **Decisions:**
  - The sender, for a row with `edit_of_outbox_id`: load the target (same `org_id`, `sent`, a message id) and the send named by the target's dedup key `approval:<sendId>`. Drop the row as `failed` / `stale_edit` when its outcome no longer matches the send: `approved` and `approved_held` need `approved`, `applying` or `applied`; `rejected` needs `rejected`; `changed` needs `expired` / `superseded`; `expired` needs `expired`. Drop it too when a newer `approval_edit` row of the same target is `sent`. Else `channel.edit(chatId, targetMessageId, message)` and mark the row `sent` with the target's message id. No target → `failed` / `no_target`.
  - Edit rows skip the quiet hours (an edit makes no sound) and count in the per-user limit.
  - Channel errors: `bad_request`, `blocked` → `failed` / `edit_failed`, no retry (N1); `soft`, `rate_limited`, `config` → the existing release rules.
  - Logs: row id, kind, error code; never text.
- **Test** (integration, fake channel; owners U1, U2 with sent cards C1, C2 of send S1; `2026-11-20T13:05:00Z`, `Europe/Warsaw`):
  - T1: a web approval of S1 → one sender run edits C1 and C2 with their message ids; text = the stored card text + `⏳ Approved 14:05, sending.`; no buttons.
  - T2: a Telegram approval by U1 → C2 only.
  - T3: with `SEND_SCOPE` `off` → `approved_held` with `heldBy` `scope`, and C2 keeps the Reject button.
  - T4: U1 approves (held) in the panel; the C1 edit waits (rate limited); U1 taps Reject on C1 → the C1 `approved_held` row ends `stale_edit` and never edits C1; C2 shows `✖️ Rejected 14:05.` at the end.
  - T5: at `2026-11-20T22:30:00Z` an edit row goes out in the same run; an `urgent` row of U1 waits.
  - T6: `bad_request` → `failed` / `edit_failed`, not taken again; `soft` → released with a backoff.
  - T7: an edit of S1 (stage 08) → C1 and C2 end with `✏️ Changed in the panel 14:05. …`.
  - T8: T5 of stage 08 still holds: no `onDecided` call for a refused edit.
- **Done when:** T1–T8 pass.

## Step 2 — Version and panel link on the card

- **Goal:** the card of a new version says so, and every card links to the panel when the panel can show it.
- **Files:** `channels/notices/approval.ts` (`approvalViewFor`, the detector), its deps, tests.
- **Decisions:** D5. `version` = `draftVersion`. `panelUrl` = `<WEB_BASE_URL>/approvals?id=<send id>` only when `WEB_BASE_URL` is set and `approvals_page` is on (read once per run); no double slash after a trailing `/`.
- **Test:**
  - T9: flag off → no `panelUrl`; flag on and `WEB_BASE_URL` `https://ea.example.ts.net/` → `https://ea.example.ts.net/approvals?id=<S2>`; `WEB_BASE_URL` empty → no `panelUrl`.
  - T10: the S2 card (version 2) has `✏️ Version 2, edited in the panel.`; a version 1 card does not.
- **Done when:** T9, T10 pass.

## Done when (stage)

- Steps 1 and 2 hold. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s09`).

## Carry-over from stage 05 review

- `panelUrl` sends the panel host name (for example a `*.ts.net` tailnet host) and the send id to Telegram. `docs/code-patterns.md` § "The consent version" says a new field in Telegram content may need a consent text change and a version bump. The consent text lists mail data only. Decide in this stage whether the panel link needs a bump; record the decision (and the reason) in the plan log. If the link is off by default (flag off or no base URL), no bump is needed.
- When `WEB_BASE_URL` is unset, set no `panelUrl` (core renders no link line without it).
- Add a test for a newline in a `panelUrl` (stage 05 test gap TG2): the encoder must refuse it.

## Carry-over from stage 06 review

- No row of kind `approval_edit` can exist before this stage; this stage lands the first caller of `queueCardEdits` and the sender edit branch in ONE commit (a claimed `approval_edit` row would be sent as a new message otherwise).
- The sender must load the target card with `org_id = row.org_id` and `user_id` and fail the row on a mismatch (the database also refuses a cross-organization pointer after the stage 06 rework).
- A test with two owners and `exceptUserId` set for a held approval (stage 06 TG2).
- The edit copies a card text: refuse when the stored text is `[removed]` (retention cleared it): the sender must not show that text.
