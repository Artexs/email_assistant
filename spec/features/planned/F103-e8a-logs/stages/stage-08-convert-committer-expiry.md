# F103 stage 08 — Convert the committer and the expiry job

Part of [`../plan.md`](../plan.md). Needs stage 01 landed. May run next to one other conversion stage (plan § Stages "Order").

Two steps.

## Step 1 — Convert 18 calls

**Goal.** Every log call in `modules/actions/committer.ts` and `modules/actions/expiry.ts` is an event (D5, D6, D7). Behaviour, DB writes and audit rows do not change; only log lines.

**New field names** (`platform/log-fields.ts`, each only if it is not there yet): number `applied`, `failed`, `retry`, `closed`, `sent`, `expired_timeout`, `expired_draft_missing`, `expired_not_notified`, `expired_not_seen`, `expired_held_timeout`; uuid none; code none (`scope`, `config_key` exist).

**Children.** In `committer.ts` `processMailbox` (and in `warnWhenHeldBack`, `warnWhenSendsHeld`, `openFor` when they get `mailboxId`) and in the per-mailbox loop of `expiry.ts`: `const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId })`.

**Errors.** Where the old text printed `label` (`describeError(error)`), the line takes `...errorFields(error)` of the same error. `label` stays where it goes into a DB row (`lastError`, audit data). If only the label string is in scope, pass the error object to the log call's scope (a parameter); never log the label.

| File:line                    | Old text                                                            | Level | Event                      | Fields                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------- | ----- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
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
| expiry.ts:116                | `applied draft … has no folder or kind: no reverse row`             | warn  | `draft_reverse_missing`    | `action_id: draftId`                                                                                                                         |
| expiry.ts:187                | `expiry …: expired N (timeout …, draft_missing …, …)`               | info  | `expiry_done`              | `mailbox_id`, `count: total`, `expired_timeout`, `expired_draft_missing`, `expired_not_notified`, `expired_not_seen`, `expired_held_timeout` |
| expiry.ts:203                | `expiry … failed:`                                                  | error | `expiry_failed`            | `mailbox_id`, `...errorFields`                                                                                                               |

- `committer_done` keeps the old condition (it logs only when a count is above 0). `committer.ts:301` and `expiry.ts:187` start two-line calls.

**Decisions.** D2, D5, D6, D7, D16, D17.

**Test.**

1. Every test that matched an old text matches the event text: `grep -rn "committer \|expiry \|applied draft" apps/server/test apps/server/src --include=*.test.ts`. At least `actions-committer.test.ts`, `actions-expiry.test.ts`, `actions-logs.test.ts` may match.
2. `actions-logs.test.ts` and `actions-send-logs.test.ts` still prove that no line holds a recipient, a subject, a task, a draft text or an SMTP reply.
3. New case in `actions-committer.test.ts` (or the file that runs one committer tick with a fixed `now`): the tick writes `committer_done` with `mailbox_id`, `org_id` and the five numbers.

**Check.** `bun test apps/server/src/modules/actions apps/server/test/integration/actions-committer.test.ts apps/server/test/integration/actions-expiry.test.ts apps/server/test/integration/actions-logs.test.ts apps/server/test/integration/actions-send-logs.test.ts`.

**Done when.** No `no-restricted-syntax` message in the converted files; the tests pass.

## Step 2 — Lint level and known alerts

**Files.** `eslint.config.js`: add `"apps/server/src/modules/actions/committer.ts"` and `"apps/server/src/modules/actions/expiry.ts"` to the `error` block (stage 09 replaces them with the folder); `log-lint.test.ts`: one case: an old-form line with `filePath` `apps/server/src/modules/actions/committer.ts` (import path `"../../platform/log"`) gives `[2]`; `docs/known-alerts.md` and `deploy/README.md` by D17. Known matches at `0a5c2ee`: `known-alerts.md:418–419` (`expiry <mailboxId> failed`, the expiry counts). Run the per-row grep for the rest.

**Check.** The per-row grep of D17 finds no old text of this table in either file.

**Done when.** The lint case passes; the Proof of `plan.md` (`/tmp/f103-s08`) prints `PROOF_OK`; the final message gives the warning count and lists new field names and calls not in the table.

**Out of scope.** `apply.ts`, `drafts.ts`, `send.ts` (stage 09). Any change to retries, statuses or audit data.
