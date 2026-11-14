# F097 plan refresh 2

- Old base: `54b715b` (2026-11-14 11:00; the `Plan base:` line of `plan.md`).
- New base: `072e3c9` (`HEAD`, 2026-11-14 11:27).
- Job: `2026-11-14-f097-plan-refresh-2-abf4ac91` (planner, Opus 5.5).

## Drift output (`scripts/plan-drift.sh spec/features/active/F097-e2a-offline-lab 54b715b`)

```
plan base: 54b715b 2026-11-14 11:00
HEAD:      072e3c9 2026-11-14 11:27
named paths: 126; changed since base: 9; gone: 0
changed: apps/server/src/composition.ts
changed: apps/server/src/main.ts
changed: apps/server/test/integration/fixtures.ts
changed: apps/server/test/integration/org-flag-cli.test.ts
changed: apps/server/test/integration/tenancy-features.test.ts
changed: apps/server/test/integration/web-operator.test.ts
changed: packages/core/src/features.test.ts
changed: packages/core/src/features.ts
changed: packages/core/src/index.ts
commits after the base that touch the named paths:
  c18c07a 11-14 11:04 F099 stage 12: security log registry, flag and GET /api/security-log
  1c56577 11-14 10:57 F099 s04: operator notice send_limit; committer gets the configured send limits
  bb67a4a 11-14 10:55 F099 s04: panel and digest say 'approved, waiting: send limit'; held_timeout names the send limit
```

## Changes

- plan.md status line: `Plan base: 072e3c9, refreshed 2026-11-14`.
- plan.md F13: F099 stage 12 landed the flag `security_log` (`c18c07a`); no later F099 stage adds a flag (stages 06–11, 13–15 checked: none edits `features.ts`).
- plan.md F21: line numbers of the three flag-list tests; `web-operator.test.ts` case 4 title now says "four keys per row" (F099 made the number count the flags); case 6 `toHaveLength(4)` added (it also counts flags; the old plan missed it); registry order at `072e3c9`.
- plan.md How to run 3: the "not next to F099 stage 12" rule for stage 04 is gone (F099 stage 12 landed).
- plan.md History: refresh 2 line.
- stage 01: `triageScope` in `main.ts:45-56` → `main.ts:46-57` (F099 s04 added the `sendLimits` import).
- stage 04 intro: `features.ts` was edited by F099 stage 12 (landed), no longer a pending shared file.
- stage 04 step 1: `review_command` goes after `security_log` in all lists; `web-operator.test.ts` case 4 title becomes "five keys per row", the other organization's list has five `false`; case 6 `toHaveLength(5)`; line numbers updated.

No stage changed in substance (no new interface, schema, migration, step or order). No cold review.

## Facts checked, no change needed

- `actionsScope` still in `apps/server/src/composition.ts:24`; F099 s04 only added `sendLimits` and `onSendLimited` to `committerDeps`, which this plan does not use.
- `createOrgWithMailbox` still exported at `apps/server/test/integration/fixtures.ts:53` (F18, stage 03); F099 only added `lastError` to `insertAction`.
- `packages/core/src/index.ts` gained `export * from "./security-log"`; stage 05 adds `./sim` the same way. `packages/core/src/sim/` does not exist yet.
- `features.test.ts` still checks `featureKeys.slice(0, 3)`; stage 04 test 4 still fits.
- `packages/core/src/texts/index.ts` does not exist at `072e3c9` (only `locale.ts`); D39 stays conditional as written.
- `main.ts` has no `CommandDeps` line numbers in stage 04; the Telegram runtime is still built by `createTelegramRuntime` in `main.ts`.
