# F147 scouts

Three scouts (Sonnet 5.5, thinking medium), started 2026-11-20 at plan base 22188c54. Each packet is copied whole from the job log. A packet is a lead; the plan decisions that depend on it were checked in the code.

## Scout 1

Job: `2026-11-20-f147-scout-1-7f24fc70`

Question:

> How do the five hourly operator notices work (apps/server/src/modules/channels/operator.ts, OperatorNoticeKind)? For each kind: the trigger query, the repeat/dedup rule (hasAuditKey, audit rows: action names, keys), when it clears, where its text comes from (@ea/core textsFor), the job that runs it and its schedule, how operatorSend is built in apps/server/src/main.ts and who else calls it, which tests cover it. Also: which module layer owns channels vs operator in apps/server/src/modules/layers.json, and can operator import channels or the reverse? Context: spec/features/planned/F147-one-operator-alert-path-with-texts-in-core-and-one-locale-type-exist/ticket.md and spec/quality/2026-11-20-pass-2.md finding 8. Answer for the code at HEAD.


Packet:

1. **Only three of the five kinds are hourly** (observed). All five go through `notify()` in `apps/server/src/modules/channels/operator.ts`. `trial_ending` and `auth_error_24h` start only from `run()`. `llm_cap`, `auth_mail_failed` and `send_limit` start from callbacks, and the hourly run also retries `llm_cap` and `send_limit`. `send_limit` also has a catch-up scan in `run()`.
   - Job: `scheduler.add("channels.operator", "0 13 * * * *", ...)` at `main.ts:204`. It runs at minute 13 of each hour. `run()` calls four guarded parts in order: `runOrganizations`, `runAuthErrors`, `runRetries`, `runSendLimits`.

2. **Kinds, triggers, keys and clearing** (observed). Every key is stored as `data.key` of an audit row with `event: "operator.notice"` and `data: { kind, key }` (`auditEvents.operatorNotice`, `audit/repo/events.ts:91`). The row is written after a successful send, in the org of the event. There is no "clear" logic. A condition ends when its trigger query stops matching, or when the key changes.

   | Kind | Trigger | Key | Ends when |
   |---|---|---|---|
   | `trial_ending` | `run`: `plan=="trial"`, `trialEndsAt <= now+3d`. Uses `texts.trialEnds` before the end and `texts.trialEnded` after. | `trial_ending:<org>:<trialEndsAt ms>` | A changed end date gives a new key. The "ended" text reuses the same key, so only one of the two texts is ever sent per end date. |
   | `auth_error_24h` | `run`: `listAuthErrorMailboxesBefore(now-24h)` (`mail/repo/targets.ts:23`): `status='auth_error'`, `status_changed_at <= before`, org not suspended. | `auth_error_24h:<mailbox>:<status_changed_at ms>` | Status leaves `auth_error`. A new episode changes `status_changed_at`, which gives a new key. |
   | `llm_cap` | The triage job calls `capReached(ctx, mailboxId, dayStart, cap)` via `onCapReached` (`main.ts:281`, `main.ts:328`). | `llm_cap:<mailbox>:<dayStart ISO>` | The key changes the next UTC day. |
   | `auth_mail_failed` | `authMailFailed(ctx, userId, kind, code, now)`, called at `main.ts:500` through `onAuthMailFailed`. The web wiring is `authMailFailedHandler` in `web-audit.ts:85`. | `auth_mail_failed:<user>:<code>:<UTC day>` | The key changes the next UTC day. A different code gives a different key. |
   | `send_limit` | `sendLimitReached` from the committer (`onSendLimited`, `main.ts:400`). Also `runSendLimits`: `listSendLimitHolds` (`actions/repo/notify.ts:273`) selects `type='send'`, `status='approved'`, `last_error like 'send_limit:%'` and `next_attempt_at > now`, per non-suspended org. | `send_limit:<mailbox>:<UTC day>` | The key changes the next UTC day. |

3. **Dedup layers** (observed). There are four layers.
   - In-memory sets `doneKeys` and `inFlight` skip repeats in one process.
   - `hasAuditKey` (`audit/repo/audit.ts:45`) checks for an audit row with the same event and `data->>'key'` in the org.
   - A failed send writes no row, and the error is logged once per key through `failedLogged`.
   - Only `llm_cap` and `send_limit` go into the `retries` map on a failed send. `capReached` and `sendLimitReached` return early while the key is in `retries`. `runRetries` resends at the next hourly run. `trial_ending` and `auth_error_24h` need no map because `run()` finds them again by query. `auth_mail_failed` is not retried.

4. **Texts** (observed). `textsFor(deps.locale ?? "en").operator` (`operator.ts:~70`) gives the texts. The table is `operatorTexts` in `packages/core/src/texts/operator.ts`, an `OperatorTexts` interface with `en` and `pl`. Its methods are `trialEnds`, `trialEnded`, `authError24h`, `llmCap`, `authMailFailed` and `sendLimit`.
   - The locale comes from `config.OPERATOR_LOCALE` and is typed `UserLocale` (`packages/core/src/tenancy.ts:12`).
   - The SLO path is separate. `operator/slo-texts.ts` has its own `AlertLocale` (`slo-texts.ts:21`) and its own `locale === "pl"` logic. It does not use `textsFor`. This is the second locale type and second text source that F147 targets.

5. **operatorSend** (observed). `main.ts:189-196`: `operatorChat = operatorChatId(config)` (`platform/config-ops.ts:101`). `operatorSend` is `null` when the chat is null. Otherwise it is an async function that throws `"telegram is off"` when the `telegram` runtime is null, else calls `telegram.sendDirect(operatorChat, text)`. `telegram` is a `let` that is set later.
   - Callers: `createOperatorNotices({ send: operatorSend })` (`main.ts:200`) and the SLO tick `runSloTick({ send: operatorSend, locale: config.OPERATOR_LOCALE })` (`main.ts:225`). That job is `ops.slo` on `"30 */5 * * * *"`, every 5 minutes at second 30.
   - When `send` is null, the notice code logs `operator_notice_unsent` with `warn` and still writes the audit row (see the test "send null").

6. **Layers** (observed). In `layers.json`, `channels` is in layer 4 (`["reports","channels","testmail"]`) and `operator` is in layer 5 (`["operator","privacy","trust"]`). Operator may import `channels` and channels may not import operator. `operator/service.ts:23` and `operator/slo-checks.ts:19` already import `../channels`. A grep for `../operator` in `modules/channels` finds nothing. The only same-layer edge for `channels` is `channels -> reports`. The operator notices therefore stay in channels (or lower) unless the dependency is passed from a composition root.

7. **Tests** (observed by listing, not run).
   - `apps/server/test/integration/channels-operator.test.ts` is the main suite.
     - `hourly run` covers `trial_ending` (before the end, after the end, locale `pl`), `auth_error_24h` (25 h vs 23 h, new episode, suspended org), a failed send then retry, and send `null`.
     - `capReached` and `sendLimitReached` cover per-day dedup, a send that never resolves, a failed send retried by the hourly run, the hourly catch-up, and "the text holds no @".
     - `authMailFailed` covers the per-user, per-code, per-day key, send `null`, and a send that throws.
     - `log events` covers log-field contents and per-part failures of `run()`.
   - `packages/core/src/texts/operator.test.ts` pins the en and pl texts. `texts/index.test.ts:34-40` pins the arguments of `operator.llmCap`, `operator.authMailFailed` and `operator.sendLimit`.
   - `apps/server/src/main.test.ts:40-48` is a source-level pin that `operatorSend` is shared by `ops.slo` and `channels.operator`.
   - `operator/slo-texts.test.ts` covers the SLO texts. `operator-reads.test.ts` and `web-operator-detail.test.ts` read the `operator.notice` rows.

Checks: `channels-operator.test.ts` covers dedup, retry, `send` null and the log fields for all five kinds. It does not cover the SLO path, which does not use these texts. `main.test.ts` covers the wiring only as a regex on the source text.

## Scout 2

Job: `2026-11-20-f147-scout-2-be04b57d`

Question:

> How do the service-level operator alerts work (apps/server/src/modules/operator/slo-job.ts, slo-texts.ts, slo-checks.ts) and what is the ops_alerts table (migration, columns, unique keys, RLS/org_id or global, retention, open/close/repeat rules, send-first-mark-second order)? List the five alert kinds, their check functions, how texts are rendered (AlertLocale, which locale is used and from where), the job schedule, and the tests that cover them. Could a new alert kind be added by a registry entry, or is the kind list a CHECK constraint in SQL? Context: spec/features/planned/F147-one-operator-alert-path-with-texts-in-core-and-one-locale-type-exist/ticket.md and spec/quality/2026-11-20-pass-2.md finding 8. Answer for the code at HEAD.


Packet:

1. **A new kind is not a registry entry alone.** The kind list lives in five places:
   - `ops_alerts.kind` has a SQL CHECK: `CHECK (kind IN ('slo_sync_lag','slo_urgent_latency','slo_llm_errors','slo_disk','slo_backup_age'))` in `db/migrations/20261115140001_ops_alerts.sql:6`. A new kind needs a new dbmate migration that replaces the CHECK.
   - `SLO_KINDS` in `packages/core/src/ops/kinds.ts` is the TS list. Its comment says the CHECK holds the same codes. I found no test that compares the two.
   - `slo-texts.ts`: `Words.facts` is `Record<SloKind, …>` in both `english` and `polish`, and `TEST_FACTS` and `TEST_IDS` are `Record<SloKind, …>`. The compiler forces an entry in each. `IDS_OF` is `Partial`, so an entry there is optional.
   - `apps/server/src/main.ts:~213` holds the check list `sloChecks: SloCheckEntry[]` (`{kind, run}`). The code does not force an entry per kind. `main.test.ts:61` is a source-level pin of the wiring.
   - `docs/known-alerts.md#<kind>` is the runbook anchor in every text. The kind must have a section there.
   - `slo-job.ts` itself needs no change. It loops over the entries it receives, sorted by `SLO_KINDS` order.
   - Observed.

2. **The five kinds, their checks and their text facts** (all observed, `slo-checks.ts`):

   | Kind | Check function | Fact keys | Ids shown |
   |---|---|---|---|
   | `slo_sync_lag` | `checkSyncLag(db, now, cfg, startedAt)` | `mailboxes`, `max_lag_min` | mailbox UUIDs |
   | `slo_urgent_latency` | `checkUrgentLatency(db, now, cfg, startedAt, testMail, logger)` | `mails`, `max_wait_min` | mail UUIDs |
   | `slo_llm_errors` | `checkLlmErrors(db, now, cfg)` | `calls`, `failed`, `pct`, `quota_orgs` | org UUIDs |
   | `slo_disk` | `checkDisk(statfs, cfg)` | `free_pct`, `free_gb` | none |
   | `slo_backup_age` | `checkBackupAge(readFile, now, cfg)`, returns `null` when `BACKUP_STATUS_FILE` is empty | `age_h`, `failed`, `missing` | none |

   - A reading is `{check: {kind, state: firing|between|clear, facts}, ids}`. `MAX_IDS` is 5.
   - Sync lag and urgent latency return `between` for the first 10 minutes after a start (`SLO_START_GRACE_MS`).
   - The disk check clears only 5 points and 0.5 GB above its open values.

3. **Texts: `AlertLocale` is a local type, `"en" | "pl"`** (`slo-texts.ts:7`). `sloAlertText(input)` is a pure function.
   - The text has four parts: line 1 is the state (`ALERT` / `STILL OPEN` / `RESOLVED` / `TEST`, or the Polish equivalents). Line 2 is the facts in words. Line 3 is up to five ids, left out for `resolved`. The last line is `Runbook: docs/known-alerts.md#<kind>`.
   - The locale comes from `config.OPERATOR_LOCALE` (`platform/config-ops.ts:32`, `z.enum(["en","pl"]).default("en")`). `main.ts:225` passes it as `deps.locale` to `runSloTick`. `sloAlertText` defaults to `"en"` when it gets none.
   - `ops-alert-test.ts:38` and `alerts-service.ts` also pass it.
   - Two other locale types exist outside the alert path:
     - `UserLocale` in `packages/core/src/tenancy.ts:12`. The operator notices in `packages/core/src/texts/operator.ts` use it, with the same `OPERATOR_LOCALE` (`main.ts:201`).
     - `StyleLocale` in `replies/style-form.ts:25`, a third `"pl" | "en"` type.
   - The alert texts live in the server module `operator/slo-texts.ts`, not in `@ea/core`. Observed.

4. **Schedule:** `scheduler.add("ops.slo", "30 */5 * * * *", …)` at `main.ts:223`, every 5 minutes at second 30. It is listed in `start/jobs.test.ts:20`.
   - It runs with no tenant scope. The checks read every organization that is not `suspended`.
   - The repeat interval is `cfg.repeatH` hours (6 h by default per `docs/capabilities/operations.md`).
   - Observed.

5. **`ops_alerts`** (observed, migration plus `alerts-repo.ts`):
   - Columns:
     - `id` bigint identity PK
     - `kind` text with the CHECK above
     - `opened_at` timestamptz NOT NULL
     - `open_sent_at`, `last_sent_at`
     - `notice_count` int, default 0, CHECK >= 0
     - `resolved_at`, `resolved_sent_at`
     - `facts` jsonb, default `'{}'`, CHECK that it is an object
   - Keys: `CREATE UNIQUE INDEX ops_alerts_active_kind ON ops_alerts (kind) WHERE resolved_sent_at IS NULL` allows one active incident per kind. A second index covers `opened_at DESC`.
   - Global, with no `org_id` and no RLS. The migration has none. It is listed in `NO_PERSONAL_TABLES` and `EXPORT_MAP` (`export: false`), not in `TENANT_TABLES`. `code-patterns.md:195` names this as an exception to the `TenantContext` rule, an owner decision of 2026-11-15.
   - Retention: none. `operations.md:85` says "Rows stay (no retention)". Only the restore drill clears the table.
   - `factsJson` checks that facts have at most 20 keys, snake_case keys and finite number values. Otherwise it throws `HardError`.
   - Open, close and repeat rules:
     - The pure function `nextAlertStep` (`packages/core/src/ops/alert-step.ts`) returns `none`, `open`, `repeat`, `resolve` or `silent_close`.
     - No row and `firing` gives `open`. No row otherwise gives `none`.
     - A row with `resolved_at` set gives `resolve` again until the resolved notice is sent.
     - A row never sent that reads `clear` gives `silent_close`. If it does not read `clear`, it gives `open` again.
     - A sent row that reads `clear` gives `resolve`. Otherwise it gives `repeat` once `now - last_sent_at >= repeatMs`, else `none`.
     - `between` keeps an open alert as it is.
     - `openAlert` inserts with `ON CONFLICT (kind) WHERE resolved_sent_at IS NULL DO NOTHING` and rereads the existing row.
     - `resolveAlert` sets `resolved_at` and, when silent, also `resolved_sent_at`.
     - `markAlertSent` writes `open_sent_at`, `last_sent_at` and `notice_count + 1` for `open`, `last_sent_at` and the count for `repeat`, and `resolved_sent_at` for `resolved`. It also writes `facts`.
   - Send first, mark second (`slo-job.ts` `applyReading`/`deliver`):
     - `deliver` calls `deps.send(text)` first. On a throw it logs `slo_alert_send_failed`, returns false, and writes no mark. The next tick tries again.
     - With `send === null` (no operator chat), the `slo_alert_sent` info line counts as the send, and the mark is written.
     - On `open` the row is created before the send, with no send mark. On `resolve` the row's `resolved_at` is set before the send, and `resolved_sent_at` only after it. A crash between send and mark repeats one notice and loses none.
     - A check that throws, or a state error, logs `slo_check_failed` and skips that kind only.

6. **Tests** (observed by listing, not run):
   - `apps/server/src/modules/operator/slo-texts.test.ts` (164 lines): text rendering.
   - `apps/server/src/modules/operator/slo-host-checks.test.ts` (175 lines): the disk and backup checks.
   - `apps/server/test/integration/ops-slo-job.test.ts` has these cases:
     - Cases 1–6 cover open, repeat after 6 h, resolve, failed send, silent close.
     - Case 7 covers no send.
     - Cases 8, 8b–8e cover a check that throws, a check that is off, kind order, a state error, no tenant scope.
     - Cases 9 and 11 cover real readings and `ops:alert-test` (11b covers no chat).
     - Cases 9, 9b, 9c in the second block cover disk and backup in the tick.
   - `apps/server/test/integration/ops-alerts-repo.test.ts`: cases 1–5 cover the repository. Case 6 checks no `org_id`, the closed kind list and the facts object CHECK. Case 7 checks the app role's rights.
   - `packages/core/src/ops/alert-step.test.ts`: `nextAlertStep`.
   - `apps/server/src/main.test.ts:40-67`: source-level pin of the wiring. The job and the operator notices share one `operatorSend`, and the check list holds the disk and backup entries.
   - `apps/server/src/platform/config.test.ts:775`: `OPERATOR_LOCALE`.
   - `apps/server/src/start/jobs.test.ts`: the job list.
   - `privacy-dsr-match.test.ts` and `privacy-export-map.test.ts` cover the table maps.

Checks: `ops-alerts-repo.test.ts` case 6 covers the closed SQL kind list; it misses any link between the SQL CHECK and `SLO_KINDS`. `slo-texts.test.ts` covers English and Polish rendering through `sloAlertText`. `main.test.ts` only matches source text. Nothing checks that `main.ts` holds one check entry per `SLO_KINDS` value. I ran none of these.

## Scout 3

Job: `2026-11-20-f147-scout-3-e3f095a8`

Question:

> Where are locale union types defined and used: UserLocale (packages/core/src/tenancy.ts), AlertLocale (apps/server/src/modules/operator/slo-texts.ts), DocsLocale (packages/core/src/site.ts), ShotLocale (apps/docs/src/shots.ts), and any other 'en' | 'pl' union or locale list in non-test code? Can apps/docs import @ea/core (package.json deps, tsconfig)? How are texts organized in packages/core/src/texts/ (textsFor shape, per-locale files, the en/pl completeness tests), and is there a packages/core/src/texts/operator.ts or similar today? Context: spec/features/planned/F147-one-operator-alert-path-with-texts-in-core-and-one-locale-type-exist/ticket.md and spec/quality/2026-11-20-pass-2.md finding 8. Answer for the code at HEAD.


Packet:

1. Canonical type: `packages/core/src/tenancy.ts:10-12` has `userLocales = ["pl","en"] as const`, `UserLocale`, and `userLocaleSchema`. It is also exported from `@ea/core/web` (`packages/core/src/web/index.ts:42`). — observed
2. Duplicate literal unions, non-test:
   - `AlertLocale` (`apps/server/src/modules/operator/slo-texts.ts:7`), exported by `operator/index.ts:25` and used in `slo-job.ts:9` and `alerts-service.ts:6`.
   - `DocsLocale` (`packages/core/src/site.ts:7`).
   - `ShotLocale` (`apps/docs/src/shots.ts:12`), with `SHOT_LOCALES = ["en","pl"]` at line 28.
   - `Lang` (`apps/docs/src/security/subprocessor-view.ts:5` and `apps/docs/src/pricing.ts:34`) and `DemoLang` (`apps/docs/src/demo-video.ts:9`).
   - Inline unions: `apps/docs/src/ui-text.ts:12`, `flagged-text.ts:142`, and the `lang` props in docs components `Subprocessors`, `ClaimsTable`, `PricePlan`, `DemoVideo`, `CostTable`.
   - `apps/web/src/layouts/Public.astro:10`, `apps/web/e2e/demo/record.ts:113`, and `apps/web/e2e/lib/demo/notice.ts:23`.
   - Config enum `z.enum(["en","pl"])` for `OPERATOR_LOCALE` at `apps/server/src/platform/config-ops.ts:32`. — observed
3. apps/docs can import `@ea/core`: `apps/docs/package.json` has `"@ea/core": "workspace:*"` (and `@ea/web`), and `apps/docs/src/autonomy-evidence.ts`, `changelog-page.ts` and `demo-video.ts` already import it. — observed
4. Core texts: `packages/core/src/texts/index.ts` defines `CoreTexts` (`locale: UserLocale` plus one sub-table per area). `textTables: Record<UserLocale, CoreTexts>` is built from per-area modules, and `textsFor(locale)` (line 126) returns `textTables[locale]`. Each area file exports `<Area>Texts` and `<area>Texts = { en, pl }` (for example `operatorTexts`). Large areas split into `*-en.ts` and `*-pl.ts` (`approvals`, `bot`, `notices`). — observed
5. An operator file already exists: `packages/core/src/texts/operator.ts` (47 lines), with `OperatorTexts` and `operatorTexts`. It covers six Telegram notices: `trialEnds`, `trialEnded`, `authError24h`, `llmCap`, `authMailFailed`, `sendLimit`. It is wired as `CoreTexts.operator`. The five SLO alert texts (`sloAlertText`) are not in core. — observed
Checks: `packages/core/src/texts/index.test.ts` covers that each locale has a table, every text is non-empty, both locales have the same keys, and Polish lines hold no double colon. `operator.test.ts` exists beside the texts (not read). `operator/slo-texts.test.ts` covers the server-side alert texts. I read none of these tests in detail, so they may miss the other copies of the locale type.

