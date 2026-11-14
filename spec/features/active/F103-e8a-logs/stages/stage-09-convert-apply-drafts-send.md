# F103 stage 09 — Convert apply, drafts and send

Part of [`../plan.md`](../plan.md). Needs stage 08 landed (the lint entries of the folder). May run next to one other conversion stage.

Two steps.

## Step 1 — Convert 22 calls

**Goal.** Every log call in `modules/actions/apply.ts`, `drafts.ts` and `send.ts` is an event (D5, D6, D7). Behaviour, DB writes and audit rows do not change.

**New field names** (each only if missing): number `max_attempts`; code `action_type`, `send_stage`.

**Children.** One `actionLog = log.with({ action_id: action.id })` per function that handles one action, or the field `action_id` on the call when the function logs once.

**Errors.** As stage 08: `...errorFields(error)` of the same error; `label` stays only in DB rows; never log the label.

File, old text (start) → event: fields. Levels stay.

- `apply.ts`: `action …: applied ${type}` / `applied move` (×3) → `action_applied`: `action_id`, `action_type`
- `apply.ts`: `action …: ${label}, try N of M` (×2) → `action_retry`: `action_id`, `attempts: action.attempts + 1`, `max_attempts`, `...errorFields`
- `apply.ts`: `action …: failed hard_error` → `action_failed`: `action_id`, `reason: "hard_error"`
- `apply.ts`: `action …: failed ${reason}` → `action_failed`: `action_id`, `reason`
- `apply.ts`: `action …: no provider for ${type}` → `action_no_provider`: `action_id`, `action_type`
- `drafts.ts`: `action …: failed ${reason}` → `action_failed`: `action_id`, `reason`
- `drafts.ts`: `action …: ${label}, try N of M` → `action_retry`: `action_id`, `attempts`, `max_attempts`, `...errorFields`
- `drafts.ts`: `applied create_draft` → `action_applied`: `action_id`, `action_type: "create_draft"`
- `drafts.ts`: `closed create_draft (send_closed)` → `action_closed`: `action_id`, `action_type: "create_draft"`, `reason: "send_closed"`
- `drafts.ts`: `applied create_draft (reverse)` → `action_reversed`: `action_id`, `action_type: "create_draft"`
- `send.ts`: `action …: failed ${reason} (stage …, code …)` → `send_failed`: `action_id`, `reason`, `send_stage`, `code` (response code or provider code; left out when none)
- `send.ts`: `action …: sent copy failed:` → `send_copy_failed`: `action_id`, `...errorFields`
- `send.ts`: `action …: ${label}, try N of M` → `send_retry`: `action_id`, `attempts`, `max_attempts`, `...errorFields`
- `send.ts`: `action …: send retry (stage …, code …)` → `send_retry`: `action_id`, `send_stage`, `code`
- `send.ts`: `action …: no sender for send` → `send_no_sender`: `action_id`
- `send.ts`: `the draft is not applied; the send waits` → `send_waits_for_draft`: `action_id`
- `send.ts`: `applied send` → `action_applied`: `action_id`, `action_type: "send"`
- `send.ts`: `action …: recovery ${label}, try N of M` → `send_recovery_retry`: `action_id`, `attempts`, `max_attempts`, `...errorFields`
- `send.ts`: `applied send (recovered)` → `send_recovered`: `action_id`

- Levels stay. The `code` of `send_failed` and `send_retry` is an SMTP response number or a provider code; both pass the code kind. Never the SMTP reply text.

**Decisions.** D2, D5, D6, D7, D16, D17.

**Test.**

1. Tests that matched an old text match the event text (at least `actions-logs.test.ts`, `actions-send-logs.test.ts`, `actions-send.test.ts`, `actions-drafts.test.ts`, `actions-apply.test.ts` may).
2. `actions-logs.test.ts` and `actions-send-logs.test.ts` still prove that no line holds a recipient, a subject, a task, a draft text or an SMTP reply.
3. `actions-send.test.ts`: a send that fails with an `SmtpSendError` whose reply text holds `MARKER-SMTP` writes `send_retry` or `send_failed` with `send_stage` and `code`, and no captured line holds `MARKER`.

**Done when.** No `no-restricted-syntax` message in the three files; the tests pass.

## Step 2 — Lint level and known alerts

- `eslint.config.js`: replace the stage 08 entries with `modules/actions/**/*.ts` in the `error` block.
- `log-lint.test.ts`: an old-form line at `modules/actions/__log-fixture.ts` gives `[2]`.
- Docs by D17 (no known quote at the first base; run the per-row grep).

**Done when.** No old text of the table in either doc; the Proof (`/tmp/f103-s09`) prints `PROOF_OK`; the final message gives the warning count, new field names and calls not in the table.

**Out of scope.** Retries, statuses, audit data.
