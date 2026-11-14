# F103 stage 07 — Convert actions

Part of [`../plan.md`](../plan.md). Needs stage 01 landed. May run next to one other conversion stage (plan § Stages "Order").

Two steps.

## Step 1 — Convert 40 calls

**Goal.** Every log call in `modules/actions/` is an event (D5, D6, D7). Behaviour, DB writes and audit rows do not change; only log lines.

**New field names** (`platform/log-fields.ts`): number `max_attempts`, `applied`, `failed`, `retry`, `closed`, `sent`, `held`, `expired_timeout`, `expired_draft_missing`, `expired_not_notified`, `expired_not_seen`, `expired_held_timeout`; code `action_type`, `send_stage`.

**Children.** In `committer.ts` `processMailbox` (and in `warnWhenHeldBack`, `warnWhenSendsHeld`, `openFor` when they get `mailboxId`): `const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId })`. In `apply.ts`, `send.ts`, `drafts.ts`: one `actionLog = log.with({ action_id: action.id })` per function that handles one action, or the field `action_id` on the call when the function logs once.

**Errors.** Where the old text printed `label` (`describeError(error)`), the line takes `...errorFields(error)` of the same error. `label` stays where it goes into a DB row (`lastError`, audit data). If only the label string is in scope, pass the error object to the log call's scope (a parameter); never log the label.

| File:line                    | Old text                                                            | Level | Event                      | Fields                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------- | ----- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| apply.ts:57, :228, :326      | `action …: applied ${type}` / `applied move`                        | debug | `action_applied`           | `action_id`, `action_type`                                                                                                                   |
| apply.ts:74, :112            | `action …: ${label}, try N of M`                                    | warn  | `action_retry`             | `action_id`, `attempts: action.attempts + 1`, `max_attempts`, `...errorFields`                                                               |
| apply.ts:109                 | `action …: failed hard_error`                                       | warn  | `action_failed`            | `action_id`, `reason: "hard_error"`                                                                                                          |
| apply.ts:156                 | `action …: failed ${reason}`                                        | warn  | `action_failed`            | `action_id`, `reason`                                                                                                                        |
| apply.ts:361                 | `action …: no provider for ${type}`                                 | error | `action_no_provider`       | `action_id`, `action_type`                                                                                                                   |
| committer.ts:167             | `committer: ACTIONS_SCOPE=off, N mailbox actions wait in mailbox …` | info  | `committer_actions_held`   | `mailbox_id`, `count`, `scope: "off"`, `config_key: "ACTIONS_SCOPE"`                                                                         |
| committer.ts:182             | `committer …: SEND_SCOPE=…, N approved sends wait`                  | info  | `committer_sends_held`     | `mailbox_id`, `count`, `scope: sendScope.kind`, `config_key: "SEND_SCOPE"`                                                                   |
| committer.ts:199, :281       | `committer …: login failed, status is now auth_error`               | warn  | `committer_auth_error`     | (mailboxLog)                                                                                                                                 |
| committer.ts:201             | `committer …: ${describeError}; the next tick tries again`          | warn  | `committer_soft_error`     | `...errorFields`                                                                                                                             |
| committer.ts:203             | `committer …: open failed:`                                         | error | `committer_open_failed`    | `...errorFields`                                                                                                                             |
| committer.ts:294, :339, :364 | `committer …: release failed:`                                      | error | `committer_release_failed` | `...errorFields(releaseError)`                                                                                                               |
| committer.ts:301             | `committer …: applied N, failed N, retry N[, closed N][, sent N]`   | info  | `committer_done`           | `applied`, `failed`, `retry`, `closed`, `sent` (always all five numbers)                                                                     |
| committer.ts:315             | `committer …: expired N stale actions`                              | warn  | `committer_stale_expired`  | `count`                                                                                                                                      |
| committer.ts:337             | `committer …: sync folders failed:`                                 | error | `committer_folders_failed` | `...errorFields`                                                                                                                             |
| committer.ts:362             | `committer …: facts failed:`                                        | error | `committer_facts_failed`   | `...errorFields`                                                                                                                             |
| committer.ts:373             | `committer …: close failed:`                                        | warn  | `committer_close_failed`   | `...errorFields`                                                                                                                             |
| committer.ts:389             | `committer … failed:`                                               | error | `committer_failed`         | `...errorFields`                                                                                                                             |
| drafts.ts:105                | `action …: failed ${reason}`                                        | warn  | `action_failed`            | `action_id`, `reason`                                                                                                                        |
| drafts.ts:125                | `action …: ${label}, try N of M`                                    | warn  | `action_retry`             | `action_id`, `attempts`, `max_attempts`, `...errorFields`                                                                                    |
| drafts.ts:228                | `applied create_draft`                                              | debug | `action_applied`           | `action_id`, `action_type: "create_draft"`                                                                                                   |
| drafts.ts:257                | `closed create_draft (send_closed)`                                 | info  | `action_closed`            | `action_id`, `action_type: "create_draft"`, `reason: "send_closed"`                                                                          |
| drafts.ts:329                | `applied create_draft (reverse)`                                    | debug | `action_reversed`          | `action_id`, `action_type: "create_draft"`                                                                                                   |
| expiry.ts:116                | `applied draft … has no folder or kind: no reverse row`             | warn  | `draft_reverse_missing`    | `action_id: draftId`                                                                                                                         |
| expiry.ts:187                | `expiry …: expired N (timeout …, draft_missing …, …)`               | info  | `expiry_done`              | `mailbox_id`, `count: total`, `expired_timeout`, `expired_draft_missing`, `expired_not_notified`, `expired_not_seen`, `expired_held_timeout` |
| expiry.ts:203                | `expiry … failed:`                                                  | error | `expiry_failed`            | `mailbox_id`, `...errorFields`                                                                                                               |
| send.ts:122                  | `action …: failed ${reason} (stage …, code …)`                      | warn  | `send_failed`              | `action_id`, `reason`, `send_stage: stage`, `code` (the response code or the provider code; leave out when none)                             |
| send.ts:246                  | `action …: sent copy failed:`                                       | warn  | `send_copy_failed`         | `action_id`, `...errorFields`                                                                                                                |
| send.ts:272                  | `action …: ${label}, try N of M`                                    | warn  | `send_retry`               | `action_id`, `attempts`, `max_attempts`, `...errorFields`                                                                                    |
| send.ts:309                  | `action …: send retry (stage …, code …)`                            | warn  | `send_retry`               | `action_id`, `send_stage`, `code`                                                                                                            |
| send.ts:353                  | `action …: no sender for send`                                      | error | `send_no_sender`           | `action_id`                                                                                                                                  |
| send.ts:368                  | `the draft is not applied; the send waits`                          | warn  | `send_waits_for_draft`     | `action_id`                                                                                                                                  |
| send.ts:424                  | `applied send`                                                      | debug | `action_applied`           | `action_id`, `action_type: "send"`                                                                                                           |
| send.ts:464                  | `action …: recovery ${label}, try N of M`                           | warn  | `send_recovery_retry`      | `action_id`, `attempts`, `max_attempts`, `...errorFields`                                                                                    |
| send.ts:509                  | `applied send (recovered)`                                          | debug | `send_recovered`           | `action_id`                                                                                                                                  |

- The `code` of `send_failed` and `send_retry` is an SMTP response number or a provider code; both pass the code kind. Never the SMTP reply text.
- `committer_done` keeps the old condition (it logs only when a count is above 0).

**Decisions.** D2, D5, D6, D7, D16.

**Test.**

1. Every test that matched an old text matches the event text: `grep -rn "action .*: \|committer \|expiry \|applied draft\|send retry\|sent copy failed" apps/server/test apps/server/src --include=*.test.ts`. At least `actions-logs.test.ts`, `actions-send-logs.test.ts`, `actions-committer.test.ts`, `actions-expiry.test.ts`, `actions-send.test.ts`, `actions-drafts.test.ts` may match.
2. `actions-logs.test.ts` and `actions-send-logs.test.ts` still prove that no line holds a recipient, a subject, a task, a draft text or an SMTP reply.
3. New case in `actions-committer.test.ts` (or the file that runs one committer tick with a fixed `now`): the tick writes `committer_done` with `mailbox_id`, `org_id` and the five numbers.

**Check.** `bun test apps/server/src/modules/actions apps/server/test/integration/actions-*.test.ts`.

**Done when.** No `no-restricted-syntax` message in `modules/actions/`; the tests pass.

## Step 2 — Lint level and known alerts

**Files.** `eslint.config.js` (add `"apps/server/src/modules/actions/**/*.ts"` to the `error` block); `log-lint.test.ts` (one case: an old-form line in `apps/server/src/modules/actions/__log-fixture.ts`, import path `"../../platform/log"`, gives `[2]`); `docs/known-alerts.md` (D17: entries that quote `committer …`, `expiry …`, `action …` lines).

**Check.** `grep -n "committer <\|expiry <\|action <" docs/known-alerts.md` shows no heading with an old text.

**Done when.** The lint case passes; the Proof of `plan.md` (`/tmp/f103-s07`) prints `PROOF_OK`; the final message gives the warning count and lists new field names and calls not in the table.

**Out of scope.** Any change to retries, statuses or audit data.
