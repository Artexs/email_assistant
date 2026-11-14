# F103 stage 09 — Convert apply, drafts and send

Part of [`../plan.md`](../plan.md). Needs stage 08 landed (the lint entry of the folder). May run next to one other conversion stage (plan § Stages "Order").

Two steps.

## Step 1 — Convert 22 calls

**Goal.** Every log call in `modules/actions/apply.ts`, `drafts.ts` and `send.ts` is an event (D5, D6, D7). Behaviour, DB writes and audit rows do not change; only log lines.

**New field names** (`platform/log-fields.ts`, each only if it is not there yet): number `max_attempts`; code `action_type`, `send_stage`.

**Children.** In `apply.ts`, `send.ts`, `drafts.ts`: one `actionLog = log.with({ action_id: action.id })` per function that handles one action, or the field `action_id` on the call when the function logs once.

**Errors.** Where the old text printed `label` (`describeError(error)`), the line takes `...errorFields(error)` of the same error. `label` stays where it goes into a DB row (`lastError`, audit data). If only the label string is in scope, pass the error object to the log call's scope (a parameter); never log the label.

| File:line               | Old text                                       | Level | Event                  | Fields                                                                                                           |
| ----------------------- | ---------------------------------------------- | ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| apply.ts:57, :228, :326 | `action …: applied ${type}` / `applied move`   | debug | `action_applied`       | `action_id`, `action_type`                                                                                       |
| apply.ts:74, :112       | `action …: ${label}, try N of M`               | warn  | `action_retry`         | `action_id`, `attempts: action.attempts + 1`, `max_attempts`, `...errorFields`                                   |
| apply.ts:109            | `action …: failed hard_error`                  | warn  | `action_failed`        | `action_id`, `reason: "hard_error"`                                                                              |
| apply.ts:156            | `action …: failed ${reason}`                   | warn  | `action_failed`        | `action_id`, `reason`                                                                                            |
| apply.ts:361            | `action …: no provider for ${type}`            | error | `action_no_provider`   | `action_id`, `action_type`                                                                                       |
| drafts.ts:105           | `action …: failed ${reason}`                   | warn  | `action_failed`        | `action_id`, `reason`                                                                                            |
| drafts.ts:125           | `action …: ${label}, try N of M`               | warn  | `action_retry`         | `action_id`, `attempts`, `max_attempts`, `...errorFields`                                                        |
| drafts.ts:228           | `applied create_draft`                         | debug | `action_applied`       | `action_id`, `action_type: "create_draft"`                                                                       |
| drafts.ts:257           | `closed create_draft (send_closed)`            | info  | `action_closed`        | `action_id`, `action_type: "create_draft"`, `reason: "send_closed"`                                              |
| drafts.ts:329           | `applied create_draft (reverse)`               | debug | `action_reversed`      | `action_id`, `action_type: "create_draft"`                                                                       |
| send.ts:122             | `action …: failed ${reason} (stage …, code …)` | warn  | `send_failed`          | `action_id`, `reason`, `send_stage: stage`, `code` (the response code or the provider code; leave out when none) |
| send.ts:246             | `action …: sent copy failed:`                  | warn  | `send_copy_failed`     | `action_id`, `...errorFields`                                                                                    |
| send.ts:272             | `action …: ${label}, try N of M`               | warn  | `send_retry`           | `action_id`, `attempts`, `max_attempts`, `...errorFields`                                                        |
| send.ts:309             | `action …: send retry (stage …, code …)`       | warn  | `send_retry`           | `action_id`, `send_stage`, `code`                                                                                |
| send.ts:353             | `action …: no sender for send`                 | error | `send_no_sender`       | `action_id`                                                                                                      |
| send.ts:368             | `the draft is not applied; the send waits`     | warn  | `send_waits_for_draft` | `action_id`                                                                                                      |
| send.ts:424             | `applied send`                                 | debug | `action_applied`       | `action_id`, `action_type: "send"`                                                                               |
| send.ts:464             | `action …: recovery ${label}, try N of M`      | warn  | `send_recovery_retry`  | `action_id`, `attempts`, `max_attempts`, `...errorFields`                                                        |
| send.ts:509             | `applied send (recovered)`                     | debug | `send_recovered`       | `action_id`                                                                                                      |

- The `code` of `send_failed` and `send_retry` is an SMTP response number or a provider code; both pass the code kind. Never the SMTP reply text.

- `send.ts:122` starts a two-line call.

**Decisions.** D2, D5, D6, D7, D16, D17.

**Test.**

1. Every test that matched an old text matches the event text: `grep -rn "action .*: \|send retry\|sent copy failed\|no sender\|no provider" apps/server/test apps/server/src --include=*.test.ts`. At least `actions-logs.test.ts`, `actions-send-logs.test.ts`, `actions-send.test.ts`, `actions-drafts.test.ts`, `actions-apply.test.ts` may match.
2. `actions-logs.test.ts` and `actions-send-logs.test.ts` still prove that no line holds a recipient, a subject, a task, a draft text or an SMTP reply.
3. New case in `actions-send.test.ts`: a send that fails with an `SmtpSendError` whose reply text holds `MARKER-SMTP` writes `send_retry` or `send_failed` with `send_stage` and `code`, and no captured line holds `MARKER`.

**Check.** `bun test apps/server/src/modules/actions apps/server/test/integration/actions-*.test.ts`.

**Done when.** No `no-restricted-syntax` message in the converted files; the tests pass.

## Step 2 — Lint level and known alerts

**Files.** `eslint.config.js`: replace the `committer.ts` and `expiry.ts` entries of stage 08 with `"apps/server/src/modules/actions/**/*.ts"` in the `error` block; `log-lint.test.ts`: one case: an old-form line in `apps/server/src/modules/actions/__log-fixture.ts` (import path `"../../platform/log"`) gives `[2]`; `docs/known-alerts.md` and `deploy/README.md` by D17. Run the per-row grep; no known match at `0a5c2ee`.

**Check.** The per-row grep of D17 finds no old text of this table in either file.

**Done when.** The lint case passes; the Proof of `plan.md` (`/tmp/f103-s09`) prints `PROOF_OK`; the final message gives the warning count and lists new field names and calls not in the table.

**Out of scope.** Any change to retries, statuses or audit data.
