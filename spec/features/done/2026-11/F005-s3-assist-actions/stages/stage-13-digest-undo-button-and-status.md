# s3-assist-actions — Stage 13

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 13 — Digest ↩️ button, the Undo tap, `/status` lines [risky]

- [x] **13.1 Core: the `undo` callback and the third digest button (D14, P4)**
  - Goal: a digest line whose mail has an undoable action gets `↩️ n`; the button data parses back to `{ kind: "undo", emailId }`; the message limits hold.
  - Files: change `packages/core/src/digest/callback.ts`, `callback.test.ts`, `digest.ts`, `digest.test.ts`, `notices.ts` (`feedbackButtons` gets an optional `undo?: string` text and appends the button), `apps/server/src/modules/reports/digest.ts`, `apps/server/test/integration/reports-digest.test.ts`.
  - Interfaces: `FeedbackCallback` gets `| { kind: "undo"; emailId: string }`; `encodeCallback` → `fu:<emailId>`; `parseCallback` accepts `fu`. `DigestItem` gets `undoable: boolean`. `feedbackButtons(emailId, category, texts: { right: string; edit: string; undo?: string })`.
  - Decisions:
    - The renderer appends `↩️ n` after `✏️ n` when `item.undoable`; the row packing stays 2 lines per row (at most 6 buttons per row, 45 per message) [the Telegram limits are not verified: stage 16 sends a 15-line digest with 45 buttons and the dev run records the result; if Telegram refuses it, the fallback is one line per row].
    - `reports/digest.ts`: `undoable: isUndoable(actions.get(row.email_id) ?? [], request.now)`; `wouldDo` keeps `describeActions` (now `done: …` for applied actions, `undone: …` after an Undo).
    - An on-demand digest (`/digest`) shows the same buttons; the tap works on any digest message as long as the window holds.
  - Test: `callback.test.ts`: `fu` round trip, 39 bytes (`fu:` + a 36-character uuid); a forged `fu:not-a-uuid` → null. `digest.test.ts`: an undoable item → 3 buttons with data `fr:`, `fe:`, `fu:`; a non-undoable → 2; an `unsure` undoable (moved to `AI/Manual`) → `fe:` and `fu:` only; 15 undoable lines → 45 buttons in 8 rows, each data ≤ 64 bytes, text ≤ 4096. `reports-digest.test.ts`: a mail with an `applied` move 1 h ago → `undoable` true in the rendered keyboard; with a reverse row → false; applied 8 days ago → false.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the handler (13.2).

- [x] **13.2 The Undo tap, the feedback row, `/status` and `/help` lines**
  - Goal: a tap on ↩️ starts the Undo of the mail's actions after the tenant check and writes one feedback row (`wrong`, source `undo`); `/status` shows the actions scope and the counts.
  - Files: change `apps/server/src/modules/channels/callbacks.ts`, `apps/server/src/modules/channels/commands.ts`, `apps/server/src/modules/channels/texts.ts`, `apps/server/src/modules/channels/telegram/runtime.ts` (`TelegramRuntimeDeps.actionsScope: ActionsScope` from the `actions` index: the Undo tap needs the `all` scope's mailbox address), `apps/server/test/integration/channels-callbacks.test.ts`, `apps/server/test/integration/channels-commands.test.ts`.
  - Interfaces: `CommandDeps` and the callback deps get `actionsScope: ActionsScope`. Texts in `callbacks.ts`: `UNDO_TEXTS = { started: "↩️ Undo started: the mail goes back within a minute.", already: "Undo was already requested for this mail.", nothing: "Nothing to undo.", too_old: "Too old to undo (7 days).", held: "Undo is not possible now: mailbox changes are off or the mailbox is paused.", not_found: "This mail is not in your account." }`.
  - Decisions:
    - `handleCallback`, kind `undo`: `getLabelTarget` (undefined → `not_found` text, no leak); `result = undo(db, ctx, emailId, { now, userId: link.userId, scope: deps.actionsScope })` (`held` → the `held` text, no rows: M9, Q5 default); when `result.kind === "started"` and `target.category !== "unsure"` → `recordFeedback({ emailId, verdict: "wrong", source: "undo", userId: link.userId, skipIfSame: true, keepLabel: true })` (`keepLabel`, stage 11: a ✏️ label with a true category stays the latest feedback row, m14); answer = the text of the kind; no `edit` (the digest keyboard stays: a second tap answers `already`).
    - `/status`: after the triage line: `Actions: <off | test mail only (ACTIONS_SCOPE=synthetic) | real mail of the test mailbox (ACTIONS_SCOPE=all)> · last 24 h: applied <a>, undone <u>, failed <f>` (from `actionsScope.kind`; `countActionsSince(now − 24 h)` counts only mailbox actions, not `save_summary`, m15). Per mailbox the `Mode:` line is unchanged (`assist` shows when set).
    - `/help`: one more line: `↩️ under a digest line undoes what the system did to that mail (7 days).` `LINKED_TEXT` follows.
    - The runtime passes `actionsScope` from `main.ts` (stage 15); the tests pass it directly.
  - Test: `channels-callbacks.test.ts` (org A owner linked; a mail with an `applied` move and `mark_read`; org B's mail; `actionsScope: { kind: "all", mailboxAddress: <the fixture mailbox address> }` unless said otherwise): (1) `fu:<id>` → toast `started`, two reverse rows, one feedback row (`wrong`, `undo`, the user id); (2) again → `already`, no new feedback row; (3) an `unsure` mail with an applied `AI/Manual` move → reverse rows, no feedback row; (4) a mail with `logged` rows only → `nothing`, no rows; (5) applied 8 days ago → `too_old`; (5b) scope `off` → the `held` text, no reverse row, no feedback row; (5c) the latest feedback row is a ✏️ label with `true_category` → `started`, reverse rows, no new feedback row; (6) org B's id and a random uuid → the `not_found` text, no rows. `channels-commands.test.ts`: `/status` has `Actions: off · last 24 h: applied 0, undone 0, failed 0` with scope `off`; with two applied and one failed action in the window the counts show; an applied `save_summary` does not change `applied`; `/help` has the ↩️ line.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: the urgent notice (no Undo button, D14), a web route (S5).
