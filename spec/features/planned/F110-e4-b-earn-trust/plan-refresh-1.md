# F110 plan refresh 1

- Old base: `9341d9f0` (2026-11-15 05:40). New base: `17b2a369` (`HEAD`, 2026-11-15 17:38).
- Job: refresh, no scouts. Landed since the base (coordinator list): F102 to stage 17, F103 to 18, F104 to 12, F114 to 08 (release scripts, `db:check-migrations`, drill), F116 to 10, F117 to 13 and 16, F119 to 14, F113 to 15, F109 stage 06 and 11; v0.1.0 runs on the VPS.

## Drift output (`/tmp/coord/drift-F110.txt`)

```
plan base: 9341d9f0 2026-11-15 05:40
HEAD:      17b2a369 2026-11-15 17:38
named paths: 36; changed since base: 7; gone: 0
changed: apps/server/src/openapi-routes.test.ts
changed: deploy/backup.sh
changed: deploy/README.md
changed: packages/core/src/digest/digest.test.ts
changed: packages/core/src/digest/digest.ts
changed: packages/core/src/digest/local-time.ts
changed: packages/core/src/web/settings.ts
commits after the base that touch the named paths:
  3733aeed 11-15 15:27 F114 stage 08 review: restore.sh needs exactly one result line of credentials:check; README note on down -v
  f7e00a46 11-15 14:56 F114 stage 08: credentials:check, restore.sh reads its result line, VPS lost runbook, capability pages
  988cdca5 11-15 14:17 F102 stage 16: remind now (remindNow and POST /api/delegations/:id/remind)
  4767333f 11-15 13:49 F114 stage 07: README names the drill set of check-logging
  5d378f85 11-15 13:42 F114 stage 06 step 3: release checklist, README Release section, migrations rules, operations page
  5170c738 11-15 13:13 F103 stage 18 review fixes: pin vlagent mounts, url, network and disk cap; logs.sh level, unbuffered, root
  dd1eef9a 11-15 12:43 F103 stage 18: log store (Compose profile ops), deploy/logs.sh, testmail remote runs in cli
  5791b645 11-15 12:10 F102 stage 14: lint fixes in the delegate tests
  576f4283 11-15 12:10 F102 stage 14 step 2: delegates routes (list, add, change)
  cb8ced0b 11-15 12:00 F103 stage 17: log drivers split (server json-file, others local), cli Compose service, check-logging drivers and one-off doc check
  489ff792 11-15 10:03 F114 stage 04 step 4: docs for status file, ping, disk and backup checks
  10c0ba78 11-15 09:59 F114 stage 04 step 1: backup.sh writes status file and pings
  93f0adb7 11-15 08:41 F103 s13: docs for the final log rules; capability page logs.md
  9b68a77b 11-15 08:29 F114 stage 02: SLO config, lateMin, three database checks and their readers
  3a6f5bf5 11-15 07:19 F103 s12: roots and testmail log events; lint error for root files and testmail; web_on carries no origin
  938a8294 11-15 07:18 F102 s11: approve, reject and edit routes of the approvals page
  76a86032 11-15 07:11 F119 stage 14: docs for company sign-in (web-panel, tenancy, account data, ADR 0026 amendment, runbook, alerts, code patterns)
  494edee4 11-15 07:01 F103 s10 review: review-10 notes, stage 13 carry-over, README rescan wording
  6d9f29ae 11-15 06:59 F117 stage 09: OAuth secret store, Connect and Reconnect, public callback route (303)
  bc4347a7 11-15 06:39 F102 s10: approvals read API (list, detail) and approvalsWaiting in /api/me
  d07955b4 11-15 06:17 F103 s10: mail folder log events; MailHostLookupError; lint error for modules/mail; canary tests per line
  d95775cf 11-15 06:17 F104 stage 09: Sent switch in the settings view, PATCH sent-sync route and mailbox:settings sent-sync
  5ecce6ee 11-15 06:10 F103 s09: apply, drafts and send log events; lint error for the actions folder; log-event tests per line
  1d39bc51 11-15 05:34 F109 stage 06: attachment line in the urgent notice and the digest (flag attachment_line), consent text and version bump for attachment names
```

## Changes (stage · what · why)

- **02** · The reader reads only `classifier-*.json` files with `role: "classifier"`; other files are skipped without a warning. New test 10. Step 2 names the three committed files. · `evals/results/gate` now also holds `extractor-…-vsent-v1.json` (F116 s06, another schema) and a `classifier-v3` file (F109 s11, not shipped). The old Step 2 assert ("every committed file, no warning") could not hold.
- **03** · The outbox kind list comes from `20261115150001_outbox_sent_missing.sql` (was `20261115130001_approval_edit.sql`). New decision: the migration passes `bun run db:check-migrations`; new-column CHECKs inline; the `memberships` composite FK and the quiet pair check need a `-- contract: v<running release>` line with a reason (Q17). · F104 s11 changed the kind list; F114 s06 added the contract check, which flags `ADD CONSTRAINT` on an old table.
- **05** · The OAuth connect (`applyOAuthGrant` in `mail/oauth/apply.ts`) calls the same `onConnected` hook for a new mailbox; a reconnect queues nothing. New test 5. · F117 s09 added a second connect path that does not pass `connectMailbox`: without it, an OAuth mailbox gets no history check.
- **08** · The re-gate log line is the event `trust_regate_done` with count fields `stamped`, `regranted`, `paused` in `platform/log-fields.ts`. · F103 made every log line an event with allow-listed fields; stage 26 reads the event by name.
- **16** · Test 7 includes the F109 attachment line (`📎`, between subject and `💬`). · F109 s06 added the line to `digest.ts`; the 4096-character limit must hold with it.
- **18** · The `local-time.ts` functions already take an optional `QuietHours`; `lateMin` too. New decision: the F114 urgent SLO check passes the hours of the user of the mail's first urgent outbox row (`UrgentCandidate.quiet`); M5 keeps the default (Q18). New test 6; later tests renumbered 7–10. · F114 s02 added `lateMin` with the fixed default: per-user quiet hours would fire false `slo_urgent_latency` alerts.
- **26** · Runbook rewritten as a release: `docs/release-checklist.md` steps 1–7 (CHANGELOG lines, `db:check-migrations`, tag), `deploy/release.sh v<x.y.z>` (backup, disk, build, migrate, verify inside), one-off commands in `cli`, check 3 by `deploy/logs.sh --event trust_regate_done`, 30-minute watch with `ops:alerts`, rollback by `deploy/rollback.sh` after the outbox SQL. The manual `pre-f110` image tag is gone. · F114: every VPS deploy is a release; `deploy/README.md` § Update is now § Release; F103: one-off commands run in `cli`.
- **plan.md** · Status line base `17b2a369`; F1 updated; two rules (migration check; log events and CLI output); log line; word trims in Input and How to run. **questions.md** · Q17, Q18 added (minor). **ticket.md** · Refresh line names the new base (the coordinator task asked for it).

## Checked, no change needed

- `apps/server/src/openapi-routes.test.ts`: still the route check of stage 11. `apiRouters` now takes `extras` with `sendScope`; `apiPublicRouters` is new for public routes. The trust routes are authenticated, so they go in `apiRouters`.
- `packages/core/src/web/settings.ts`: `noGoBodySchema` is still `{ error: "no_go", gate }` (stage 04 extends it). `settingsViewSchema` gained `sentSync` (F104 s09): no overlap with F110 keys.
- `packages/core/src/digest/digest.ts`: the `💬` line, the footer order and `DIGEST_MAX_LINES = 15` are as stage 16 and 17 assume.
- `packages/core/src/digest/digest.test.ts`: exists; the stage 16 and 17 checks hold.
- `deploy/backup.sh`: it writes a status file and pings (F114 s04); `release.sh` calls it, so stage 26 no longer calls it.
- `deploy/README.md`: § Release and § Roll back a release replace § Update (stage 26 changed).
- `categoryPolicySchema` (`packages/core/src/triage/settings.ts`) is unchanged and non-strict: the rollback note of stage 26 holds.
- `outbox` rows carry `user_id` (stage 18 SLO decision). `listUrgentCandidates` skips mail with `backfilled_at`, so history mail (stage 05 sets it) never counts in the SLO.
- The Dockerfile still copies `evals/cases` only (stage 02 adds the gate folder). `emails.skip_reason` still has no check constraint.
- No landed ticket did a step of this plan: no `trust` module, no `history_checks`, no `quiet_start`, no `report_channel` at `HEAD`.
- No F110 stage adds a Compose test (master CI lesson on Compose renderings does not apply).

## Not verified

- `backfillMailbox` and the history job on an OAuth (XOAUTH2) mailbox: stage 06 tests a password mailbox only. The stage 05 worker checks the session path at `HEAD`.

## Review fixes (review 2, `plan-review-2.md`: FAIL, 1 blocking, 8 notes; all fixed, none rejected)

- **B1** · Stage 05: the `history` path opens through `openMailboxProvider` with `oauthTokens` from the composition root, not `loadImapOptions`; an auth refusal is the typed result `auth_refused`; test 7 (OAuth mailbox, `auth.kind` is `oauth`, rows stored). Stage 06: `refreshFlags` uses the same opener; an auth refusal ends the check at once as `no_result` / `auth_refused` (no retries); test 4a. `interfaces.md`: `no_result_reason` gains `auth_refused` (stage 03 check list and stage 14 text read it from there).
- **N1** · Stage 04 flag-off grant is `by: "real_labels"` (`interfaces.md` `CategoryGrant.by` gains it). Stage 08 evidence check: only a newer `no-go` file for the key (D8), only for `evidence`, `recommended`, `regate`; test 8a.
- **N2** · Stage 16 test 7 asserts all 15 items stay listed.
- **N3** · Stage 16: no `💬` line → the suffix gets its own `💬 <suffix>` line; `unsure` shows one percent only; test 8.
- **N4** · Stage 18: SLO uses the user of the sent row that gave `noticeAt`; no sent row → the smallest `lateMin` over pending rows' users; test 6 extended.
- **N5** · Stage 08 adds code field `run` (`start` | `job`) to `trust_regate_done`; stage 26 check 3 reads the `run=start` line.
- **N6** · Stage 26 Before 3: the checklist contract-mark rule does not apply to the expand-only stage 03 mark; no stop.
- **N7** · Stage 20 out of scope: OAuth report mailboxes are in scope (XOAUTH2 through `openMailboxProvider`).
- **N8** · `plan.md` facts heading names `17b2a369`.
