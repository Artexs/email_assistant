# F103 stage 07: channels, delegation and tenancy log lines (notes for later stages and reviewers)

## Facts found while building

- `chaser_skipped` in the stage table says field `count`. The old text printed `result.skipped`, which is the string `"gate"` or `"settings"`, not a count. The event carries `reason: result.skipped` (a code, closed set).
- `notices/weekly-report.ts` called `warnSkipped("weekly_report", "<org id>:<week start>", error)`. That id is not a UUID, so `item_id` would be dropped. `warnSkipped(kind, id, error, dedup = id)` now takes the dedup key apart from the logged id. The weekly call logs `item_id` = organization id and dedups on `<org id>:<week start>`. Test: `notices/run.test.ts`.
- `notices/send-held.ts` logs `notice_skipped` with `reason: "unknown_send_limit"` on every tick (15 s) for a hold with an unknown limit text. It has no `warnedRows` guard today and the old line had none. Kept as it was; a guard is a behaviour change outside this stage.
- `channels-notices.test.ts` joined console arguments with `args.join(" ")`. It now uses `util.format`, so a raw error object shows its fields.
- Text-format lines start with the context fields: a line written inside an HTTP request has `request_id=<uuid>` after the event (see `web-telegram.test.ts`).

## `actor` values at this base (callers of `updateOrganizationSettings`, `setOrgPlan`, `setOrgFeature`)

- `"cli"`: `scripts/org-flag.ts`, `scripts/org-plan.ts`, `scripts/org-break-glass.ts` (break-glass lines are other events, not in this stage).
- `"e2e-seed"`: `scripts/e2e-seed.ts` (`setOrgPlan`).
- a user id (Better Auth UUID): web route `PATCH /organization` (session user id) and the operator console (`operator/service.ts`, the operator's user id).
- `"system"` is not an actor of these four writes at this base. Tests pass `"test"`, `"operator"`, `"actor-1"`; all pass the code rule.
- A value with a space, an `@` or `://` is dropped and counted (`tenancy-logs.test.ts`, last test).

## New field names

- UUID: `approval_set_id`, `item_id`. Number: `due`, `overdue`, `reminders`. Code: `slot`, `command`, `from_plan`, `to_plan`, `enabled`, `actor`.

## Lint level

- The `error` block now lists `modules/channels/**/*.ts` (it replaces the `sender.ts`, `operator.ts` and `telegram/**` entries), `modules/delegation/**/*.ts` and `modules/tenancy/**/*.ts`. `no-restricted-syntax` warnings in `apps/server/src`: 123 (416 at `560e74e7`), 0 errors.

## Mutation checks (each run alone; logs in /tmp/f103-s07/mut/, runner /tmp/f103-s07/mutate.py, sources restored with `git checkout`)

Each mutation failed at least one test (count in brackets):

- `notices_org_failed` and `notices_failed`: `error: error.message` (4, 2). `warnSkipped`: logged id from the dedup key (1), dedup key ignored (1), once-per-process guard removed (8), `error.message` (2). `notice_queued` without `outbox_id` (1). `send_held` skip without `item_id` or `reason` (2, 2).
- `digest_queued` without `slot` (1). `digest_member_failed` without `user_id` (1). `digests_failed` with `error.message` (1).
- `tap_received`: set id logged as `action_id` (2); without `user_id` (2). `command_refused_suspended` and `tap_refused_suspended` without `org_id` (2, 2).
- `telegram_get_me_failed`: `error.message` (1); a fixed `error` value (1). `telegram_link_made` without `user_id` (1).
- Chaser: plain `log` instead of the child (8); `overdue` and `reminders` swapped (2, after test 8d2 was added); `error.message` (2); `chaser_skipped` without `reason` (2); `chaser_forced` removed (2).
- Tenancy: timezone line without `actor` (1); plan names swapped (1); `enabled` inverted (2).
- Lint: tenancy (2), delegation (2) or channels (10) removed from the `error` block.
- Field kind: `item_id` moved to the code list (1).
- All changed and new integration files also pass with `.env` moved away and only `DATABASE_URL` set (`/tmp/f103-s07/env-unset.log`: 211 pass).
