# F100 plan refresh 1

- Old base: `10e81b9` (2026-11-14 02:33; the `Refresh:` line of `ticket.md`, because `plan.md` had no `Plan base:` line).
- New base: `a6690e4` (`HEAD`, 2026-11-14 11:27).
- Job: `2026-11-14-f100-plan-refresh-c8e6885c` (planner, Opus 5.5).
- The F097 refresh (`spec/features/planned/F097-e2a-offline-lab/plan-refresh-1.md`) has landed. Its stage numbers did not change. Its D38 (new files next to big files) matches what this plan does already. Its D39 (texts after F098) has a twin here: D31.

## Drift output (`scripts/plan-drift.sh spec/features/planned/F100-e3a-measure 10e81b9`)

```
plan base: 10e81b9 2026-11-14 02:33
HEAD:      a6690e4 2026-11-14 11:27
named paths: 135; changed since base: 32; gone: 0
changed: apps/server/src/capability-map.test.ts
changed: apps/server/src/main.ts
changed: apps/server/src/modules/audit/repo.ts
changed: apps/server/src/modules/channels/notices/send-result.ts
changed: apps/server/src/modules/layers.json
changed: apps/server/src/modules/reports/digest.ts
changed: apps/server/src/modules/tenancy/routes.ts
changed: apps/server/src/platform/config.test.ts
changed: apps/server/src/platform/config.ts
changed: apps/server/src/platform/db/schema.ts
changed: apps/server/src/platform/log-fields.ts
changed: apps/server/src/web.ts
changed: apps/server/test/integration/channels-notices.test.ts
changed: apps/server/test/integration/fixtures.ts
changed: apps/server/test/integration/telegram-schema.test.ts
changed: apps/server/test/integration/web-me.test.ts
changed: apps/web/src/components/shell/nav-items.ts
changed: apps/web/src/components/shell/Nav.tsx
changed: apps/web/src/i18n/en.ts
changed: deploy/README.md
changed: packages/core/src/digest/approvals.ts
changed: packages/core/src/digest/notices.ts
changed: packages/core/src/features.test.ts
changed: packages/core/src/features.ts
changed: packages/core/src/index.ts
changed: packages/core/src/notices/kinds.ts
changed: packages/core/src/notices/registry.test.ts
changed: packages/core/src/notices/renderers.ts
changed: packages/core/src/notices/views.ts
changed: packages/core/src/web/index.ts
changed: packages/core/src/web/me.test.ts
changed: packages/core/src/web/me.ts
commits after the base that touch the named paths:
  b6fa717 11-14 11:21 F099 stage 13: security log card in the Account card
  9e120d6 11-14 11:06 F099 s05: notice send_held for sends held by a send limit
  f36f5f8 11-14 11:05 F099 s07.2: GET /api/operator/orgs organization list
  c18c07a 11-14 11:04 F099 stage 12: security log registry, flag and GET /api/security-log
  ae985ae 11-14 11:03 F099 s07.1: tenant-scoped failure and LLM counts for the operator list
  1c56577 11-14 10:57 F099 s04: operator notice send_limit; committer gets the configured send limits
  bb67a4a 11-14 10:55 F099 s04: panel and digest say 'approved, waiting: send limit'; held_timeout names the send limit
  9c3b671 11-14 10:39 F099 s06.3: /api/me carries operator and features
  730f827 11-14 10:39 F099 s03.1: hold a send over a limit in the committer under the mailbox lock
  bd47a38 11-14 10:38 F099 s06.1: operator module in its own layer
  83a070f 11-14 10:19 F099 s02.1: actions.send_started_at column, backfill and partial index
  91b5cf8 11-14 10:13 feat(server): send limit env keys and sendLimits(config) (F099 s01.2)
  17c1b49 11-14 10:12 F098 s01 step 2: locale store, t and tp
  931a573 11-14 10:12 feat(core): pure send-limit rule checkSendLimits (F099 s01.1)
  e7b7a7d 11-14 10:11 F098 s01 step 1: language rule in core
  f00a744 11-14 07:27 F095 s05: README index rows, inbound references to the two pages, prettier
  756f1b7 11-14 02:36 F095 s03: capability pages sync and triage; move rule 7/8 triage text, §4.4 feedback, §4.6 emails flow, §8 mailbox errors
  62e084b 11-14 02:32 F091 s04: draftKinds is the one list of draft kinds
```

The script does not see changes that touch no named path. A manual check found these, which change the stages:

- F092 stages 01–03 (RLS, `64878dc`, `e08f38b`, `a3d7bfd`, `0507fc5`, `00925aa`): `db/migrations/20261114100002_rls_tenant_policies.sql`, `apps/server/test/integration/rls-policy.test.ts`, `web-tenant-scope.test.ts`, `platform/tenant-scope-sites.test.ts`.
- F099 stage 05 migration `db/migrations/20261114100003_outbox_send_held.sql` (a new outbox kind).
- F095 stages 03–08: `docs/capabilities/` (10 pages and the index); the retention table stays in `docs/architecture.md` §7.
- F098 stage 02: `apps/web/src/i18n/pl.ts` (`Record<TextKey, string>`); F098 D2 (`client:only="react"` islands).
- `.agents/limen/styleguide.md` § "Decisions for the owner" (the worker final message section).
- F103 (E8a logs, planned) D19 names F100 files and scripts as seams.

After the refresh, `scripts/plan-drift.sh spec/features/planned/F100-e3a-measure a6690e4` prints `no drift` (exit 0).

## Changes

| Where | What | Why |
| --- | --- | --- |
| plan.md status | `Plan base: a6690e4, refreshed 2026-11-14`. | Refresh rule 6. |
| plan.md D1 | The three new tables get RLS and `tenant_rows` in the stage 04 migration and join `TENANT_TABLES`; the stage 16 list keeps `send_held`. | F092 landed first; `rls-policy.test.ts` case 1 fails for a table with `org_id` outside its list. F099 added `send_held`. |
| plan.md D25 | `/api/me` already carries `features`. | F099 stage 06 (`9c3b671`) did that step of stage 18. |
| plan.md D30 | The F103 seams: field kind lists, `createCliOutput`, `no-console`, when those F103 stages land first. | F103 D19 names F100 stage 07 and `scripts/stats-week.ts`. |
| plan.md D31 (new; Q15) | Telegram texts go into the F098 registry (en, pl) when `packages/core/src/texts/index.ts` exists; panel keys in `en.ts` and `pl.ts`. | F098 D9 and D18; F098 stages 06–11 change every render signature. The same default as F097 D39. |
| plan.md F6 | The flag registry at `a6690e4` (4 keys); the first product reader; the three tests that list every flag. | F099 stage 12 added `security_log`; the lists break with each new key. |
| plan.md F13 | File sizes at `a6690e4`: `approvals.ts` 439, `config.ts` 493, `web.ts` 380, `audit/repo.ts` 320, `commands.ts` 299. | New code goes into new files (styleguide § Size and shape). |
| plan.md F14–F20 (new) | RLS; the outbox kinds; `/api/me` features; the capability pages and their test; `sumLlmCallsByModelSince`, `listAuditEvents`, `APPROVAL_TEXTS.not_found`, `Placeholder`; F098 texts and `pl.ts`; what no landed ticket did yet. | Each read at `a6690e4`. |
| plan.md Done when 9 | Pages per stage, shown by the page steps and the capability-map test. | PD-009 per stage. |
| plan.md Rules for every stage | "Decisions for the owner"; the capability page in the same change; the flag rule (registry order, three tests, `tenancy-and-plans.md`); RLS is the second line; D30, D31. | Styleguide § Prefer, § Decisions for the owner; F092; F099. |
| plan.md Coordinator step C2 | `$C run --rm cli …` after F103 stage 17. | F103 D19 (c). |
| plan.md How to run 3 | Shared files: F098 stages 06–12 (and the spawn text of F098 stages 08–11 when F100 texts land first), F099 stage 10 (nav), F101 (web build), F103 conversion stages, flag stages. | Active and planned tickets that edit the same files. |
| plan.md stage table, Planning progress, Log | Stage 18 smaller; stage 19 is the last pass; refresh lines. | — |
| stage 02 step 1 | `docs/modules.md` §3.2 `port.ts` row renames `fetchBodyText`. | The only doc that names the port method. |
| stage 03 | `sync.md` rule 16 and the CLI row; `createCliOutput` after F103 stage 04; capability-map check. | PD-009; D30. |
| stage 04 step 1 | RLS blocks for the three tables; the newest migration name; why no `GRANT`. | F092 (F14). Substance: schema. |
| stage 04 step 2 | `rls-policy.test.ts`: `TENANT_TABLES` and `seedOrg` rows; case 9; `triage.md` source list; `pl.ts` if a panel text is needed. | F092 test cases 1–7; PD-009; F098 stage 02. |
| stage 05 step 2 | `sync.md` rule "Header capture", entry points, data. | PD-009. |
| stage 05 step 3 | Exact docs: `architecture.md` §7 table row, `retention.md` rule 2 row, rule 8 log line, Data paragraph, entry point row; the log line gains `captured N`. | F095 moved retention behaviour into `retention.md`; the table stays in §7. |
| stage 06 step 2 | `sync.md` rule 6: the flag refresh, entry points, data. | PD-009. |
| stage 07 step 1 | `sync.md` and `architecture.md` §4.1 lines with "every 5 min"; `.env.example` outside the `SEND_LIMIT_*` block; `config.ts` size; D30, D31. | F095 pages; F099 keys. |
| stage 07 step 2 | Flag tests; `latestLlmPause` in a new `audit/llm-pause.ts` (may use `listAuditEvents`); `llmPauseLine` in a new `digest/llm-pause.ts`; `digest-and-notices.md` rules 4 and 9; `triage.md` Limits line. | Sizes; F099 `listAuditEvents`; PD-009. |
| stage 07 step 3 | The known-alerts entry is the one that lists `http_429_quota` (three entries name `triage/pause.ts`). | The old pointer matched three entries. |
| stage 11 | `sumLlmCallsByModelSince` exists but does not fit M7; `listLlmCallRows` stays. | F099 D18. |
| stage 12 step 2 | One mount line in `apiRouters`; `web-tenant-scope.test.ts` walks the route. | F092 stage 03. |
| stage 12 step 3 (new) | Creates `measurement.md`, its index row, the `web-panel.md` rule 7 row. | PD-009: the first stage that a user or operator can call. Substance: a new step. |
| stage 13 step 1 | Flag tests; `REJECT_REASON_TEXTS` and the buttons in a new `digest/action-feedback.ts`; D31. | `approvals.ts` is 439 lines. |
| stage 14 | `APPROVAL_TEXTS.not_found`; `web-tenant-scope.test.ts`; pages `drafts-and-send.md`, `web-panel.md`, `digest-and-notices.md`, `measurement.md`. | `NOT_FOUND_TEXT` is private; F092; PD-009. |
| stage 15 | Flag tests; helper signatures after F098 stage 06; `APPROVAL_TEXTS.not_found`; pages `triage.md`, `digest-and-notices.md`, `measurement.md`. | F098; PD-009. |
| stage 16 step 1 | Flag tests; D31 for the renderer. | F099 stage 12; F098 stage 08. |
| stage 16 step 2 | The CHECK lists (up and down) hold `send_held`; `outbox_send_held_mailbox_check` stays. | F099 stage 05 migration. Substance: migration. |
| stage 17 | Pages `digest-and-notices.md` (kinds table, footer line), `measurement.md`. | PD-009. |
| stage 18 step 1 | Rewritten: only the nav (`navItems`, `Nav.tsx`, `AppShell.tsx`), `nav_stats` in `en.ts` and `pl.ts`; no server change; F099 stage 10 adds `OPERATOR_ITEM` to the same files. | F099 stage 06 did the server part (F16). |
| stage 18 step 2 | `client:only="react"`, `title_stats`; `pl.ts`; a `Card` instead of `Placeholder` (no text prop); `web-panel.md` and `measurement.md` page rows. | F098 D2 and stage 02; F18; PD-009. |
| stage 19 step 1 | The last pass over the pages the stages wrote; `measurement.md` complete. | Pages are written per stage now. |
| questions.md | Q15 (D31), `[important: user-visible]`; Q16 (taps check their flag), `[minor]`, from cold review 2. | Refresh rule 4. |

No change to the outcome, the scope, the stage count (19), the stage order, the stage waits or any decision D1–D29. The F097 interfaces this plan uses are the same as in the F097 refresh (`TestMailRule`, `mailKindFilter(kind, rule)`, the `review` source and `triage_feedback_source_check`, `reviewMessage(deps, link)` in `channels/commands.ts`, `wilsonInterval` in `packages/core/src/triage/metrics.ts`).

## Facts checked that needed no change

- `mail/port.ts`, `mail/imap/{mapper,client}.ts`, `mail/fake/index.ts`, `mail/sync.ts` (609 lines), `mail/jobs.ts` (91), `mail/tools.ts` (310), `mail/repo/{emails,retention,mailboxes}.ts`, `channels/callbacks.ts` (393) and `channels/commands.ts` did not change since `10e81b9`. Names: `stripNul`, `cleanOrNull` (private), `bodyTextFromSource`, `toMessageMeta`, `withExistingFolder`, `guard`, `renderSeedMessage`, `existingFolder`, `stripTags`, `toMeta`, `userMove`, `failOn`, `fetchSince` (`sync.ts:440`), `auditMailbox` (`tools.ts:115`), `syncOne`, `createMailSyncJob`, `markSynced`, `insertEmail`, `mailKindFilter` (`mail/repo/emails.ts:11`, no rule parameter yet), `clearMailHeaders`, `normalizeMessageId` (`sync-rules.ts:9`).
- `scheduler.add("mail.sync", "*/5 * * * *", mailSync.run)` at `main.ts:96`; the resume text "The next sync runs within 5 minutes…" at `commands.ts:238`; `statusMessage` at `commands.ts:81` with the `LLM:` line at `:119`; `CommandDeps.operatorContact`.
- `SoftCode` and `ConfigCode` in `platform/llm/errors.ts` hold the members that stage 07 lists.
- `emails_id_org_key UNIQUE (id, org_id)`; `actions (id, org_id)` is referenced by other tables; `triage_feedback_source_check` is in `20261104000001_triage.sql` and no later migration changes it (F097 stage 03 will); `delete_mailbox` (now with the scope check) still deletes the mailbox, so the cascade of stage 04 test 7 holds.
- `feedbackSources` at `packages/core/src/triage/categories.ts:31`, tested in `settings.test.ts:8`; `packages/core/src/web/activity.ts:66` parses it.
- `getOrganization`, `listMailboxes`, `goNoGoFor` (`triage/gate.ts:11`), `listLabeledResults` (`triage/repo.ts:297`), `buildRealReport` (`triage/eval-real.ts:50`), `parseCategoryPolicy`, `listSenderRules`, `matchSender`, `parseQuery` (`platform/http.ts:178`), `approvalEdit`, `renderSendResult`, `renderNoticeEdit`, `encodeCallback`, `parseCallback`, `getSend`, `lockSend`, `auditEvents`, `formatClock`, `localToInstant`, `localDateTime`, `nextLocalDate`, `isQuietTime`, `costPerMail`, `recordLlmCall`, `isFeatureOn`, `setOrgFeature`, `featureStates`, `buildDigestMessage` (callers `channels/commands.ts:190`, `channels/digest-job.ts:41`), `DigestRequest`, `DigestJobDeps`, `renderDigest`, `queueNotice`, `barCategories`, `THRESHOLDS`, `isMoveTarget`, `moveTargets`, `parseDigestTimes`, `findOutboxByDedup`, `getMembership`, `warnSkipped`, `NoticeDeps`, `categoryTag`, `senderLabel`, `cleanSubject`, `MESSAGE_MAX_CHARS`, `recordFeedback`, `listActionsForEmails` exist with the names the stages use.
- Test helpers: `createOrgWithMailbox` (`fixtures.ts:53`), `insertTestEmail` (`:83`), `insertAction` (gained only `lastError`), `createFakeMailProvider`, `describeMailProviderContract`, `apps/server/test/wait-for.ts`, `telegram-helpers.ts`, `web-helpers.ts`; the test files the stages extend exist (`mail-sync`, `mail-backfill`, `imap-contract`, `imap-sync-greenmail`, `mail-jobs`, `mail-check`, `mailbox-backfill-cli`, `retention-job`, `retention-clear`, `channels-commands`, `channels-callbacks`, `channels-notices`, `reports-digest`, `actions-approvals`, `delegation-repo`, `telegram-schema`).
- `apps/web`: `activity.astro` mounts its island with `client:only="react"` and `App titleKey`; `useResource(load, { pollMs })`; `api(path, schema)`; `components/ui/table.tsx`; `test:unit` runs `apps/web/src/lib` and `apps/web/src/i18n`; `lucide-react` is the icon set.
- Scripts: `mailbox-audit.ts` (`loadConfig`, `configureMailHosts`, `assertAppRole`, `createSecretBox`), `triage-cost.ts` exist; `stats:week` and `mailbox:signals` are free names.
- ADR 0028 exists (`docs/decisions/0028-autonomy-evidence-without-user-labels.md`).
- `docs/modules.md` §3.2, §3.5, §3.7, §3.8, §3.10, §4, §5 and `docs/architecture.md` §5 data model exist with those numbers.
- No landed ticket did a step of this plan except the `/api/me` `features` field (F20).

## Review

The refresh changed stages in substance (stage 04 migration and tests, stage 16 migration, the new step 3 of stage 12, new page steps, D31), so a cold review ran: [plan-review-2.md](plan-review-2.md), job `2026-11-14-f100-plan-review-refresh-1-36cdb752`, candidate `a7e99f3`: PASS, 0 blocking, 12 notes. N1–N9 and N11 are fixed (plan.md § Cold review, review 2 table): `measurement.md` edits only when it exists (stages 14, 15); D31 keys on the F098 section file and gives the right helper signatures; `architecture.md` §6.1 line and case-insensitive greps (stages 07, 19); the capability-test wording; stages 07 and 18 get a review job; the stale `tenancy-and-plans.md` flag lines; taps check their flag (D21, D22, Q16); stage 04 case 1 uses a second mail; F100's flag stages never at once. N10 (stages 07 and 14 large) is accepted with a split point in How to run 2. N12 (`spec/build.md:38` says "needs refresh") is an outside edit for the coordinator.
