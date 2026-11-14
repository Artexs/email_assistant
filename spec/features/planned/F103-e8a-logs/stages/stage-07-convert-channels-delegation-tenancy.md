# F103 stage 07 — Convert the rest of channels, delegation and tenancy

Part of [`../plan.md`](../plan.md). Needs stage 05 landed (`telegramErrorFields`, and `sender.ts` and `operator.ts` are converted). May run next to one other conversion stage.

Two steps.

## Step 1 — Convert 21 calls

**Goal.** Every log call in `modules/channels/` outside `telegram/`, and in `modules/delegation/` and `modules/tenancy/`, is an event (D5, D6, D7).

**New field names** (`platform/log-fields.ts`, each only if it is not there yet): number `due`, `overdue`, `reminders`; uuid `item_id`, `approval_set_id`; code `slot`, `command`, `from_plan`, `to_plan`, `enabled`, `actor`.

- `item_id` is the id that `warnSkipped(kind, id, error)` gets: an action, approval set, mailbox, email or row id, all UUIDs; `kind` names which.
- `slot` is `slot.key` of `dueDigestSlot` (a date and time code). `enabled` is a boolean. `actor` is a code: `"system"`, `"cli"` or a user id; check the callers of the tenancy service and name the values you found in the final message.

**Children.** In `delegation/chaser.ts`, per mailbox: `mailboxLog = log.with({ org_id, mailbox_id })` (`org_id` only where `ctx` is in scope).

| File:line                | Old text                                     | Level | Event                       | Fields                                                                                             |
| ------------------------ | -------------------------------------------- | ----- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| notices/index.ts:75      | `notices for org ${orgId} failed`            | error | `notices_org_failed`        | `org_id`, `...errorFields`                                                                         |
| notices/index.ts:79      | `notices failed`                             | error | `notices_failed`            | `...errorFields`                                                                                   |
| notices/run.ts:52        | `notice ${kind} ${id}: skipped`              | warn  | `notice_skipped`            | `kind`, `item_id: id`, `...errorFields`                                                            |
| notices/run.ts:66        | `notice ${kind} queued: outbox ${id}`        | info  | `notice_queued`             | `kind`, `outbox_id`                                                                                |
| digest-job.ts:67         | `digest ${slot.key} queued for user`         | info  | `digest_queued`             | `slot: slot.key`, `user_id`, `outbox_id`                                                           |
| digest-job.ts:78         | `digest for org … user … failed`             | error | `digest_member_failed`      | `org_id`, `user_id`, `...errorFields`                                                              |
| digest-job.ts:82         | `digests failed`                             | error | `digests_failed`            | `...errorFields`                                                                                   |
| callbacks.ts:186         | `tap ${callback.kind} ${id} by user`         | info  | `tap_received`              | `kind`, `user_id`, and `action_id`, `approval_set_id` or `delegation_id` by the callback's variant |
| commands.ts:275          | `telegram: org … suspended: ${name} refused` | info  | `command_refused_suspended` | `org_id`, `command: name`                                                                          |
| commands.ts:282          | `telegram: org … suspended: tap refused`     | info  | `tap_refused_suspended`     | `org_id`                                                                                           |
| routes.ts:46             | `web: telegram getMe failed`                 | warn  | `telegram_get_me_failed`    | `...telegramErrorFields`                                                                           |
| routes.ts:50             | `web: telegram link made for user`           | info  | `telegram_link_made`        | `user_id`                                                                                          |
| delegation/chaser.ts:194 | `chaser …: due N, overdue N, reminders N`    | info  | `chaser_done`               | `mailbox_id`, `due`, `overdue`, `reminders`                                                        |
| delegation/chaser.ts:214 | `chaser …: skipped settings`                 | info  | `chaser_skipped_settings`   | (mailboxLog)                                                                                       |
| delegation/chaser.ts:220 | `chaser …: forced`                           | info  | `chaser_forced`             | (mailboxLog)                                                                                       |
| delegation/chaser.ts:226 | `chaser …: skipped N`                        | info  | `chaser_skipped`            | `count`                                                                                            |
| delegation/chaser.ts:229 | `chaser … failed:`                           | error | `chaser_failed`             | `...errorFields`                                                                                   |
| tenancy/service.ts:105   | `organization … timezone changed by …`       | info  | `org_timezone_changed`      | `org_id`, `actor`                                                                                  |
| tenancy/service.ts:115   | `organization … signature changed by …`      | info  | `org_signature_changed`     | `org_id`, `actor`                                                                                  |
| tenancy/service.ts:219   | `organization … plan A -> B by …`            | info  | `org_plan_changed`          | `org_id`, `from_plan`, `to_plan`, `actor`                                                          |
| tenancy/service.ts:268   | `organization … flag … on/off by …`          | info  | `org_flag_changed`          | `org_id`, `flag`, `enabled`, `actor`                                                               |

(The `notices/`, `digest-job.ts`, `callbacks.ts`, `commands.ts` and `routes.ts` paths are in `modules/channels/`.)

- `notices/run.ts` keeps its once-per-process guard (`warnedRows`).

**Decisions.** D2, D5, D6, D7, D16, D17.

**Test.**

1. Every test that matched an old text matches the event text: `grep -rn "notices for org\|notices failed\|notice .* skipped\|notice .* queued\|digest .* queued\|digest for org\|digests failed\|tap \|suspended:\|getMe failed\|link made\|chaser \|organization .* changed\|organization .* plan\|organization .* flag" apps/server/test apps/server/src --include=*.test.ts`. At least `channels-notices.test.ts`, `channels-digest-job.test.ts`, `channels-callbacks.test.ts`, `channels-commands.test.ts`, `web-telegram.test.ts`, `delegation-chaser.test.ts`, `tenancy-plan.test.ts`, `tenancy-flag-write.test.ts` may match.
2. New case in `channels-notices.test.ts` (or the file that tests `warnSkipped`): a skipped notice writes `notice_skipped` with `kind` and `item_id`, once per row.

**Check.** `bun test apps/server/src/modules/channels apps/server/src/modules/delegation apps/server/src/modules/tenancy apps/server/test/integration/channels-*.test.ts apps/server/test/integration/delegation-*.test.ts apps/server/test/integration/tenancy-*.test.ts apps/server/test/integration/web-telegram.test.ts`.

**Done when.** No `no-restricted-syntax` message in these folders outside `channels/telegram/`; the tests pass.

## Step 2 — Lint level and known alerts

**Files.**

- `eslint.config.js`: in the `error` block, replace the two `channels/sender.ts` and `channels/operator.ts` entries of stage 05 with `"apps/server/src/modules/channels/*.ts"`, `"apps/server/src/modules/channels/notices/**/*.ts"` and `"apps/server/src/modules/channels/fake/**/*.ts"` (any other subfolder of `channels/` except `telegram/` at your base commit too); add `"apps/server/src/modules/delegation/**/*.ts"` and `"apps/server/src/modules/tenancy/**/*.ts"`.
- `log-lint.test.ts`: one case each for `apps/server/src/modules/channels/__log-fixture.ts` (import path `"../../platform/log"`) and `apps/server/src/modules/tenancy/__log-fixture.ts`: an old-form line gives `[2]`.
- `docs/known-alerts.md` and `deploy/README.md` by D17. Known matches at `0a5c2ee`: `known-alerts.md:95` (`web: telegram getMe failed`), `:369`, `:377`, `:478` (`notice … queued`), `:590` (`digest for org`), `:598` (`notices for org`), `:71` (`organization <id> timezone changed`), `:385`, `:393` (`chaser …`). Run the per-row grep for the rest.

**Check.** The per-row grep of D17 finds no old text of this table in either file.

**Done when.** The lint cases pass; the Proof of `plan.md` (`/tmp/f103-s07`) prints `PROOF_OK`; the final message gives the warning count and lists each new field name and each call that was not in the table.

**Out of scope.** `modules/channels/telegram/` (stage 06).
