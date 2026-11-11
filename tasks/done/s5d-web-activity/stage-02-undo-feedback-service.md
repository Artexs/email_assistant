# s5d-web-activity — Stage 2

Part of [`../s5d-web-activity.md`](../s5d-web-activity.md). Read that file's "Done when", "Owns", A1–A10, "Facts checked", B1–B15, "Rules for every step", "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 2 — `undoWithFeedback`, `recordWebFeedback`, the callbacks refactor [risky]

One step. The Undo changes a mailbox (the committer moves the mail back); a second path for it would drift from Telegram.

- [x] **2.1 The shared Undo and feedback services (B4, B5)**
  - Goal: the Telegram tap and the web button run one Undo + feedback transaction; the web feedback has one service with the 404 rule inside.
  - Files: create `apps/server/src/modules/triage/undo.ts`, `apps/server/test/integration/triage-undo-feedback.test.ts`; change `triage/feedback.ts`, `triage/index.ts`, `channels/callbacks.ts`.
  - Interfaces:

    ```ts
    // triage/undo.ts
    import { undo, type ActionsScope, type UndoResult } from "../actions";
    export async function undoWithFeedback(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      emailId: string,
      opts: { now: Date; userId: string; scope: ActionsScope }
    ): Promise<UndoResult>;

    // triage/feedback.ts
    export type WebFeedbackResult =
      | { kind: "not_found" }
      | { kind: "saved"; saved: boolean; verdict: FeedbackVerdict; aiCategory: Category };
    export async function recordWebFeedback(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      input: { emailId: string; trueCategory: LabelCategory; userId: string }
    ): Promise<WebFeedbackResult>;
    ```

  - Decisions:
    - `undoWithFeedback`: `const run = async (trx) => { const target = await getLabelTarget(trx, ctx, emailId); if (!target) return { kind: "not_found" }; const undone = await undo(trx, ctx, emailId, opts); if (undone.kind === "started" && target.category !== "unsure") await recordFeedback(trx, ctx, { emailId, verdict: "wrong", source: "undo", userId: opts.userId, skipIfSame: true, keepLabel: true }); return undone; }`; `db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run)` (the pattern of `undo.ts` and `callbacks.ts`). Keep the two comments of `callbacks.ts:134,141` (why one transaction; why `keepLabel` and the `unsure` rule).
    - `recordWebFeedback`: one transaction, joined when `db.isTransaction` (the pattern of `undoWithFeedback`; `trx.transaction()` throws in Kysely, cold review finding 5): `getLabelTarget` → none → `{ kind: "not_found" }`; `!isLabelCategory(input.trueCategory)` (a caller that skipped the schema) → `throw new HardError("not a label category")`; `recordFeedback(trx, ctx, { emailId, trueCategory, source: "web", userId, skipIfSame: true })` → `{ kind: "saved", saved: r.saved, verdict: r.verdict, aiCategory: target.category }`.
    - `triage/index.ts` exports `undoWithFeedback`, `recordWebFeedback`, `type WebFeedbackResult`.
    - `callbacks.ts`: move the `undo` branch above `const target = await getLabelTarget(...)`: `if (callback.kind === "undo") { const result = await undoWithFeedback(deps.db, ctx, callback.emailId, { now: deps.now(), userId: link.userId, scope: deps.actionsScope }); return { answer: result.kind === "not_found" ? NOT_FOUND_TEXT : UNDO_TEXTS[result.kind] }; }`. Remove the now unused imports (`undo`, `Transaction` when unused, `recordFeedback` stays for the other kinds). `channels → triage` exists (fact 12).
    - No log line in either service (the audit rows of `undo()` record the Undo).
  - Test (`triage-undo-feedback.test.ts`, `withRollback`, `createOrgWithMailbox`, `insertTriagedWithActions`; `T = 2026-11-11T10:00:00Z`, `now = T + 1 h`, the scope `{ kind: "synthetic" }` and mail with Message-ID `<a@ea-seed.test>` unless a case says other):
    1. An `info` mail with `move` (`ai_info`) and `mark_read` applied at `T`: `undoWithFeedback` → `{ kind: "started", created: 2 }`; two reverse rows; one feedback row `{ verdict: "wrong", true_category: null, source: "undo", user_id }`; two `action.undo_requested` audit rows with actor = user id. A second call → `already`, still one feedback row.
    2. An `unsure` mail with an applied move → `started`, no feedback row.
    3. A mail with a ✏️ label (age it as in test 9 before the Undo; `insertFeedback(trx, ctx, { emailId, verdict: "wrong", trueCategory: "notification", source: "telegram", userId })`) → `started`, the latest feedback row is still the label (`keepLabel`).
    4. Scope `{ kind: "off" }` → `held`, no reverse row, no feedback row; a paused mailbox (scope `synthetic`) → `held`.
    5. Applied 8 days before `now` → `too_old`; only `logged` rows → `nothing`.
    6. A mail with actions but no triage result (`insertTestEmail` + `insertAction` applied) → `not_found`, no reverse row (the triage check comes first; difference 9).
    7. Another organization's mail and a random UUID → `not_found`, nothing written in either organization.
    8. The caller's transaction: every call in tests 1–7 passes the `withRollback` transaction, where the mail rows exist only; a `started` result therefore proves that the function joined the caller's transaction (a new transaction would not see the mail and would answer `not_found`). No extra test.
    9. `recordWebFeedback`: on an `info` mail `trueCategory: "info"` → `{ kind: "saved", saved: true, verdict: "right", aiCategory: "info" }`, one row with `source: "web"`; the same again → `saved: false`, still one row; before the next write age the rows (`UPDATE triage_feedback SET created_at = created_at - interval '1 minute' WHERE email_id = …`; one transaction gives every row the same `created_at`, cold review finding 4); `trueCategory: "needs_reply"` → `saved: true`, `verdict: "wrong"`, the latest row has `true_category: "needs_reply"`; an `unsure` mail with `trueCategory: "info"` → `verdict: "wrong"`, `aiCategory: "unsure"`; another organization's mail and a random UUID → `not_found`, no row; `trueCategory: "unsure"` and `"delegation"` (cast) → throw `HardError`.
    10. `channels-callbacks.test.ts` passes unchanged.
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; `git diff apps/server/test/integration/channels-callbacks.test.ts` is empty; `grep -n "undo(" apps/server/src/modules/channels/callbacks.ts` finds no direct call of `undo` (only `undoWithFeedback`).
  - Out of scope: the routes (stage 6).
