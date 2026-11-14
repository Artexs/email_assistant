# F103 stage 07 — Convert the rest of channels, delegation and tenancy

Part of [`../plan.md`](../plan.md). Needs stage 05 landed (`telegramErrorFields`; `sender.ts` and `operator.ts` converted). May run next to one other conversion stage.

Two steps.

## Step 1 — Convert 22 calls

**Goal.** Every log call in `modules/channels/` outside `telegram/`, and in `modules/delegation/` and `modules/tenancy/`, is an event (D5, D6, D7).

**New field names** (each only if missing): number `due`, `overdue`, `reminders`; uuid `item_id`, `approval_set_id`; code `slot`, `command`, `from_plan`, `to_plan`, `enabled`, `actor`.

- `item_id` is the id that `warnSkipped(kind, id, error)` gets (an action, approval set, mailbox, email or row id, all UUIDs); `kind` names which.
- `slot` is `slot.key` of `dueDigestSlot` (a date and time code). `enabled` is a boolean.
- `actor` is a code. Values at `560e74e7`: `"system"`, `"cli"`, `"e2e-seed"` or a user id. Check the callers of the tenancy service at your base; name the values in the final message. A value that can hold free text is a question.

**Child.** `delegation/chaser.ts`, per mailbox: `mailboxLog = log.with({ org_id, mailbox_id })` (`org_id` only where `ctx` is in scope).

File, old text (start) → event: fields. Levels stay.

- `channels/notices/index.ts`: `notices for org ${orgId} failed` → `notices_org_failed`: `org_id`, `...errorFields`
- `channels/notices/index.ts`: `notices failed` → `notices_failed`: `...errorFields`
- `channels/notices/run.ts`: `notice ${kind} ${id}: skipped` → `notice_skipped`: `kind`, `item_id`, `...errorFields`
- `channels/notices/run.ts`: `notice ${kind} queued: outbox ${id}` → `notice_queued`: `kind`, `outbox_id`
- `channels/notices/send-held.ts`: `notice send_held ${id}: skipped: unknown send limit text` → `notice_skipped`: `kind: "send_held"`, `item_id: mailbox.id`, `reason: "unknown_send_limit"`
- `channels/digest-job.ts`: `digest ${slot.key} queued for user` → `digest_queued`: `slot`, `user_id`, `outbox_id`
- `channels/digest-job.ts`: `digest for org … user … failed` → `digest_member_failed`: `org_id`, `user_id`, `...errorFields`
- `channels/digest-job.ts`: `digests failed` → `digests_failed`: `...errorFields`
- `channels/approval-taps.ts`: `tap ${callback.kind} ${id} by user` → `tap_received`: `kind`, `user_id`, and `action_id`, `approval_set_id` or `delegation_id` by the variant
- `channels/commands.ts`: `telegram: org … suspended: ${name} refused` → `command_refused_suspended`: `org_id`, `command`
- `channels/commands.ts`: `telegram: org … suspended: tap refused` → `tap_refused_suspended`: `org_id`
- `channels/routes.ts`: `web: telegram getMe failed` → `telegram_get_me_failed`: `...telegramErrorFields`
- `channels/routes.ts`: `web: telegram link made for user` → `telegram_link_made`: `user_id`
- `delegation/chaser.ts`: `chaser …: due N, overdue N, reminders N` → `chaser_done`: `mailbox_id`, `due`, `overdue`, `reminders`
- `delegation/chaser.ts`: `chaser …: skipped settings` → `chaser_skipped_settings`: (mailboxLog)
- `delegation/chaser.ts`: `chaser …: forced` → `chaser_forced`: (mailboxLog)
- `delegation/chaser.ts`: `chaser …: skipped N` → `chaser_skipped`: `count`
- `delegation/chaser.ts`: `chaser … failed:` → `chaser_failed`: `...errorFields`
- `tenancy/service.ts`: `organization … timezone changed by …` → `org_timezone_changed`: `org_id`, `actor`
- `tenancy/service.ts`: `organization … signature changed by …` → `org_signature_changed`: `org_id`, `actor`
- `tenancy/service.ts`: `organization … plan A -> B by …` → `org_plan_changed`: `org_id`, `from_plan`, `to_plan`, `actor`
- `tenancy/service.ts`: `organization … flag … on/off by …` → `org_flag_changed`: `org_id`, `flag`, `enabled`, `actor`

- Levels stay. `notices/run.ts` keeps its once-per-process guard (`warnedRows`).
- The tap line moved from `callbacks.ts` to `approval-taps.ts` after the first base; `send-held.ts` is new (F099).

**Decisions.** D2, D5, D6, D7, D16, D17.

**Test.**

1. Tests that matched an old text match the event text (at least `channels-notices.test.ts`, `channels-digest-job.test.ts`, `channels-callbacks.test.ts`, `channels-commands.test.ts`, `web-telegram.test.ts`, `delegation-chaser.test.ts`, `tenancy-plan.test.ts`, `tenancy-flag-write.test.ts` may).
2. `channels-notices.test.ts` (or the file that tests `warnSkipped`): a skipped notice writes `notice_skipped` with `kind` and `item_id`, once per row.

**Done when.** No `no-restricted-syntax` message in these folders outside `channels/telegram/`; the tests pass.

## Step 2 — Lint level and known alerts

- `eslint.config.js` `error` block: replace the stage 05 entries with `modules/channels/*.ts` and every subfolder of `channels/` except `telegram/` at your base (`notices/`, `fake/`); add `modules/delegation/**` and `modules/tenancy/**` (with its `repo/`).
- `log-lint.test.ts`: an old-form line at `modules/channels/__log-fixture.ts` and at `modules/tenancy/__log-fixture.ts` gives `[2]`.
- Docs by D17. Known quotes: `web: telegram getMe failed`, `notice … queued`, `digest for org`, `notices for org`, `organization <id> timezone changed`, `chaser …`.

**Done when.** No old text of the table in either doc; the Proof (`/tmp/f103-s07`) prints `PROOF_OK`; the final message gives the warning count, new field names and calls not in the table.

**Out of scope.** `modules/channels/telegram/` (stage 06).
