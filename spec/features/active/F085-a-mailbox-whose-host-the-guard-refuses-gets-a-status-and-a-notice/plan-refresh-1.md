# F085 plan refresh 1 (2026-11-14)

- Old base: `8720bb0` (2026-11-14 13:52).
- New base: `c16849f` (`master` HEAD, 2026-11-14 14:46). The job branch began at `d91e47f`; it was fast-forwarded to `master` first, because F100 stage 16 (`e158d64`) landed in `master` after the drift report of the job instruction.
- Decisions: none changed. Stage count, stage order, scope and owner defaults stay the same. No landed ticket did a step of this plan (`grep host_blocked|HeldBy|hostBlocked` finds nothing in `apps/` or `packages/`).
- Cold review: none. The changes are paths, line numbers, list positions, and a kind list that follows `master`. No interface, step or stage order changed. The job instruction also says: no second cold review.

## Drift at the new base, from the old base

`scripts/plan-drift.sh spec/features/active/F085-a-mailbox-whose-host-the-guard-refuses-gets-a-status-and-a-notice 8720bb0` at `c16849f` (exit 1):

```
plan base: 8720bb0b 2026-11-14 13:52
HEAD:      c16849ff 2026-11-14 14:46
named paths: 80; changed since base: 17; gone: 0
changed: apps/server/src/modules/audit/repo.ts
changed: apps/server/src/modules/channels/commands.ts
changed: apps/server/src/modules/channels/notices/index.ts
changed: apps/server/src/web.ts
changed: apps/server/test/integration/channels-callbacks.test.ts
changed: apps/server/test/integration/channels-commands.test.ts
changed: apps/server/test/integration/mail-repo.test.ts
changed: deploy/README.md
changed: packages/core/src/digest/digest.test.ts
changed: packages/core/src/digest/digest.ts
changed: packages/core/src/digest/index.ts
changed: packages/core/src/notices/kinds.ts
changed: packages/core/src/notices/registry.test.ts
changed: packages/core/src/notices/views.ts
changed: packages/core/src/texts/bot.ts
changed: packages/core/src/texts/digest.ts
changed: packages/core/src/texts/notices.ts
commits after the base that touch the named paths:
  1ede2183 11-14 14:26 F029 stage 02: listMoveCandidates, location guards and matchMoved (F064)
  e158d64a 11-14 14:11 F100 stage 16: weekly report core (flags, notice kind, renderer, digest line) and outbox kind migration
  7ca35eb8 11-14 14:02 F100 s07: auth-error notice no longer claims a fixed retry interval (en, pl)
  4efddb26 11-14 13:52 F100 s07 step 3: deploy README LLM provider budget; known alert points to the pause line
  d3e7a370 11-14 13:52 F100 s07 step 2: LLM pause line in /status and the digest (flag llm_pause_line)
  c757cc51 11-14 13:48 F100 s07 step 1: MAIL_SYNC_EVERY_MIN sets the mail.sync interval (default 2)
  ad06e742 11-14 13:45 F105 stage 04: operators need TOTP (WebSession.twoFactorEnabled, requireOperator and /operator page guard)
  8e7cd8c6 11-14 13:43 F105 s03: 2FA audit rows, one lock row, trusted devices and sessions end at enrolment
  b36ae676 11-14 13:37 F100 stage 12 step 2: GET /api/stats behind stats_page and bun run stats:week
```

After the refresh: `scripts/plan-drift.sh <this folder> c16849f` prints `no drift` and exits 0.

## Changes

| Where | What | Why |
| --- | --- | --- |
| plan.md status line | `Plan base: c16849f, refreshed 2026-11-14` | the new base |
| plan.md D6 | the re-check runs every `MAIL_SYNC_EVERY_MIN` minutes (2, 3 or 5, default 2; `mailSyncCron`, `platform/config.ts:441`) | F100 stage 07 (`c757cc5`) is in `master` now; the old text said "every 5 min today, not in `master`". The decision (re-check at each run, no flap guard, texts name no interval) is the same |
| plan.md D17 | `channels/repo.ts:368` → `:372` (`noticeKindSchema.parse` in `claimDueOutbox`) | the line was off at the old base too |
| plan.md § Facts | `outbox_kind_check` has 13 kinds; the newest file that sets it is `20261114140001_weekly_report_kind.sql`; it is also the newest migration; no later file touches the `mailboxes.status` CHECK | F100 stage 16 added the kind `weekly_report` and the second notice-kind migration |
| plan.md § Facts | `noticeKinds` has 13 entries, the last `weekly_report`; `authErrorView` line 103; renderer `auth_error` line 79; the CHECK test compares sorted lists; `queuedBy` (lines 39–43) names `weekly_report` | F100 stage 16 |
| plan.md § Facts | `textsFor` at c16849f (`POLISH_MESSAGES_ON = false`, `texts/index.ts:81`, was cited as `:75`), and what F098 stage 12 changes when it lands before stage 02 (`textsFor(locale) = textTables[locale]`, null → Polish, fixture users `locale: "en"`, the registry `pl ≠ en` check) | F098 stage 12 comes before stage 02 (job instruction); the plan's English assertions keep their meaning in both states |
| plan.md § Facts | `commands.ts`: `approvedText` 125 → 130, `statusText` 171 → 176, `switchMailboxes` 229 → 234 | F100 stage 07 (`syncEveryMin`, the pause line) |
| plan.md § Facts | `digest.ts`: `DigestMailbox.status` line 20 → 22; `mailboxLine` lines 93–110; the F100 footer lines (`llmPause` first, `handled` last) do not read the mailbox status | F100 stages 07 and 16 |
| plan.md § Facts | `mail/jobs.ts` did not change; the interval comes from `mailSyncCron` | F100 stage 07 |
| plan.md § Not verified | removed the item "F100 stage 07 does not move `run()`" | now verified: `mail/jobs.ts` is the same at c16849f as at 8720bb0 |
| plan.md § How to run 1 | the drift command uses `spec/features/active/…` and `c16849f`; the folder is already active | the folder moved before this job |
| plan.md § How to run 6 | F100 stages 15 and 17 (not 13–17) edit `commands.ts` / `callbacks.ts`; F100 stage 07 no longer listed for `mail/jobs.ts`; stage 02 shares `channels/notices/index.ts` with F100 stage 17 | F100 stages 07, 13, 14, 16 landed |
| plan.md § Log | one refresh line | record |
| stage 01, 1.1 | `DigestMailbox.status` at line 22; `mailboxLine` lines 93–110 and the footer lines of F100 stay as they are | F100 stages 07 and 16 |
| stage 01, 1.1 | no edit of `digest/index.ts`: it has `export * from "./approvals"` | the old text asked the worker to check it |
| stage 01, 1.1 tests | the `line(...)` helper is near line 236 (was "near 200"); the Polish case goes through the `polish(...)` helper (near line 377) in the test "mailbox lines, footer and shadow mode" (near line 412) | F100 stages 07 and 16 added tests above it; the old text did not name the Polish helper |
| stage 01, 1.2 | `NoticeTexts.hostBlocked` goes after `authError` (line 13), before `sendHeld` and the new `weekly` block; `BotTexts` line numbers 33, 43, 57, 73, 84–85 | F100 stage 16 added `weekly`; line numbers help the worker |
| stage 01, 1.2 | a note: after F098 stage 12 the `pl` texts reach users; the tests read `textTables` directly | F098 stage 12 comes before stage 02 |
| stage 02, files | `host_blocked` is the last entry of `noticeKinds`, `noticeViewSchemas`, `noticeRenderers` and the registry `cases`, after `weekly_report`; `auth_error` case near line 138 (was 136), renderer line 79; F098 stage 12 `pl ≠ en` check | F100 stage 16 put `weekly_report` after `send_held` |
| stage 02, migration | the newest migration at c16849f is `20261114140001_weekly_report_kind.sql` (was `20261114130001_two_factor.sql`) | F100 stage 16 |
| stage 02, migration | the `up` list is 13 kinds + `host_blocked` (14); the `down` list is the 13 kinds with `weekly_report` | the old SQL had the 12-kind list of `20261114100003_outbox_send_held.sql` and would have dropped `weekly_report` |
| stage 02, migration | new steps (b)–(d): read the list from the newest file that sets `outbox_kind_check` and from the live job DB, both must equal `noticeKinds` without `host_blocked`; never a fixed list; do not touch `outbox_send_held_mailbox_check`; do not assume the file stays the last migration | job instruction; a later kind ticket (for example F104 stage 11) copies the list |
| stage 02, check | `ls db/migrations \| tail -1` must name the new file before `db:rollback` | `db:rollback` rolls back the newest file only |
| stage 02, files | `cancelPendingOutbox` line 457, its union at line 460; `detectors` line 29; `queuedBy` unchanged; F100 stage 17 edits `notices/index.ts` | the plan cited 457 in D7 and 460 in the stage: both are right (function and union) |
| stage 02, docs | add only `host_blocked` to the `outbox` row of `docs/architecture.md` §5; `weekly_report` is F100 stage 19's | F100 stage 16 did not write the docs |
| stage 02, final message | name the kind list found in step (b) | proof of the list |
| stage 03, 3.1 | `switchMailboxes` line 234 and its current skip shape (lines 243–246); `changeLines(..., deps.syncEveryMin)` stays; test "an auth_error mailbox stays auth_error" line 476 → 517 | F100 stage 07 |
| stage 03, 3.2 | `statusText` line 176, `approvedText` line 130; test "status, late sync and never synced" line 262 → 264; approvals `auth_error` case lines 208–210 | F100 stage 07 |
| stage 04, 4.1 | `mail/jobs.ts`: F100 stage 07 did not change it; `run()` starts at line 76; F103 or F104 may change it | the old text expected F100 stage 07 to change it |
| stage 04, 4.1 | `mailboxRemoved` at line 23 of `audit/repo.ts`; the F105 2FA events do not change | F105 stage 03 |
| stage 07, 7.1 | the `outbox` row count: "the twelve kinds of rule 5" becomes the count of the rule 5 table after the edit; report a gap to `noticeKinds` (`weekly_report` of F100 stage 19) | the old "thirteen kinds" is wrong after F100 stage 16 |
| stage 07, 7.2 | `docs/modules.md` `mailbox:password` line 386 → 387 | docs moved |

## Facts checked that needed no change

- Files unchanged since `8720bb0`: `mail/jobs.ts`, `mail/status.ts`, `mail/routes.ts`, `mail/connect.ts`, `mail/remove.ts`, `mail/check.ts`, `mail/repo/mailboxes.ts`, `mail/repo/targets.ts`, `mail/index.ts`, `mail/port.ts`, `mail/host-guard.ts`, `mail/imap/client.ts`, `mail/imap/smtp.ts`, `mail/open.ts`, `channels/repo.ts`, `channels/callbacks.ts`, `channels/notices/sync.ts`, `channels/notices/auth-error.ts`, `channels/notices/registry.test.ts`, `actions/committer.ts` (399 lines), `actions/expiry.ts`, `actions/undo.ts`, `operator/service.ts`, `scripts/org-status-lines.ts`, `scripts/mailbox-check.ts`, `packages/core/src/web/mailboxes.ts`, `web/operator.ts`, `digest/approvals.ts`, `digest/notices.ts`, `digest/notices.test.ts`, `digest/approvals.test.ts`, `texts/approvals.ts`, `texts/index.ts`, `texts/index.test.ts`, `packages/core/src/index.ts`. Their line numbers in the plan stay true.
- `mail/repo/index.ts` changed (F029: `listMoveCandidates`), and it still does not export `mailboxStatusSchema` (stage 03 adds the export).
- `channels-callbacks.test.ts`: the cases (5a) line 553, (7) line 616, (8) line 668 did not move (F100 stage 07 added one line at 1253).
- `mail-repo.test.ts`: the describe `mail repository: mailboxes` (line 96) exists; F029 added other describes.
- `telegram-schema.test.ts`: `held_no_mailbox` line 282, the local `insert` helper line 264, the CHECK test line 396.
- `apps/server/src/web.ts`: `countMailboxes` (line 155) is still the banner count; F100 stage 12 added `GET /api/stats` only.
- `deploy/README.md`: `## Login error (\`auth_error\`)` line 77, `held_timeout` line 389, operator organizations line 483: the same text as at the old base.
- `docs/architecture.md` line 457 (the guard sentence), `docs/known-alerts.md` line 47 and the "Until F085 lands" sentence, `docs/code-patterns.md` line 128, `docs/capabilities/sync.md` rules 2, 4, 12, 13 and the `F085-…` limit line 93, `drafts-and-send.md` lines 45, 55, 97, `actions-and-undo.md` line 23.
- `texts/bot.ts`: every key that stage 01 names exists; `switch.resumedExplain` now takes the sync minutes (F100 stage 07), and no F085 text uses it.
- `texts/digest.ts`: the `mailbox` block (lines 14–20) has the same shape; `llmPause`, `handled` and `wouldHandle` are new keys outside it.
- Flags: F100 stage 16 adds `weekly_report` and `handled_share` to `packages/core/src/features.ts`. The plan names no flag and no flag count (D15: no flag), so nothing changed.
- No landed ticket did a step of this plan.
