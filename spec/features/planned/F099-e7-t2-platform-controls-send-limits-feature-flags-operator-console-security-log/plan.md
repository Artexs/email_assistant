# F099 · E7-T2 Platform controls: plan

> **Status 2026-11-14 — planned.** 15 stages written; cold review pending (see "Cold review"). Builds after F082 and F091 are in `done/`. Nothing is built yet.

Ticket: [ticket.md](ticket.md). Open defaults for the owner: [questions.md](questions.md).

## Planning progress

- [x] Collect: ticket, epic page E07 and its discovery notes §5–§7, §10, §11, `05-execution-plan.md` §2, `decisions.md` PD-044–PD-048, ADR 0027, F087 and F088 (done), F091 (active), F081 (dropped), the code of `actions/{send,committer,repo,transitions}.ts`, `channels/{operator,notice-queue}.ts`, `channels/notices/*`, `tenancy/*`, `audit/repo.ts`, `platform/{http,config}.ts`, `web.ts`, `main.ts`, `composition.ts`, the web shell and Account card, the test helpers.
- [x] Facts checked (probe P1, reference check P2).
- [x] Decisions D1–D32.
- [x] stage-01-send-limit-rule [written]
- [x] stage-02-send-started-column [written]
- [x] stage-03-hold-in-the-committer [written]
- [x] stage-04-visible-wait-and-operator-notice [written]
- [x] stage-05-send-held-notice [written]
- [x] stage-06-operator-module-and-me [written]
- [x] stage-07-operator-org-list [written]
- [x] stage-08-operator-org-detail-and-notices [written]
- [x] stage-09-operator-writes [written]
- [x] stage-10-operator-page [written]
- [x] stage-11-operator-page-writes [written]
- [x] stage-12-security-log-route [written]
- [x] stage-13-security-log-card [written]
- [x] stage-14-docs-and-standards [written]
- [x] stage-15-vps-deploy [written]
- [ ] Cold review (`plan-review-1.md`), fixes logged in "Cold review".

## Input

### Job instruction of 2026-11-14, word for word

> Plan F099: write stages/ for spec/features/planned/F099-*/ (E7-T2 Platform controls: send limits, feature flags, operator console, security log; F087 already built the flag store and the operator route). Follow docs/product/stage-2/05-execution-plan.md §2.3 but do NOT edit spec/build.md or the §2.1 table (the coordinator owns them; report any outside edit in your final message). Use F-numbers from the §2.1 table in Sequenced. Owner rules: no owner checkpoints for confirmation; an owner step only for what needs the owner's hands (real secrets, real money, a phone); small questions get a default in questions.md.

### Owner decisions that bind this plan (`docs/product/stage-2/decisions.md`, owner: "Okay, so go with the default values", 2026-11-13)

- **P1 = PD-044, word for word:** "Send limits: 20 sends per mailbox per rolling hour, 100 per mailbox per rolling 24 h, 5 per recipient per rolling 24 h (env keys with these defaults); over a limit the send waits with reason `send_limit`, the user sees it, the operator gets one notice per mailbox per day. E3 re-checks the numbers on the simulated week."
- **P2 = PD-045:** "Feature flags per organization: registry in `packages/core` (owner epic, remove-by date), table `org_features`, env `FEATURES_OFF` kill list, `isFeatureOn(ctx, flag)`, CLI and console; every new user-visible Stage 2 behaviour ships behind a flag, default off. ADR 0027." F087 built all of it except the console.
- **P3 = PD-046:** "Operator console: page `/operator` and `/api/operator/*` for users in env `OPERATOR_USER_IDS`; ids, codes, counts and dates only; last job runs derived from existing rows; no log reading, no mail content; absorbs F081. ADR 0027."
- **P4 = PD-048:** "Owner security log in the Account card: sign-ins, lockouts, password and 2FA changes, sessions ended, export, delete, DSR (from audit rows)."
- **P5 = ADR 0027** points 1–6 (`docs/decisions/0027-operator-role-and-feature-flags.md`), in particular point 2 ("One operator module … It is the only web code that reads across organizations. Every route has route-matrix tests: a non-operator, also an owner, gets 404"), point 3 ("ids, codes, counts and dates only … no sender addresses, no log reading") and point 4 ("Console writes call the same service functions as the CLIs … and write the same audit rows").
- **P6 = the discovery design input** (`docs/product/stage-2/epics/E07-discovery-notes.md`): §5 send limits ("Counting reads the sent actions of the window (no new counter table). One check in the committer, before the SMTP call, inside the existing send lock."), §7 the console contents.

### Design decisions of this plan (D1–D32)

"Default, owner to confirm" marks a small question that is also in [questions.md](questions.md); the stages do not change with its answer.

**Send limits (lane A)**

- **D1 Send limits are a safety rule, not a feature: always on, no flag.** The three env keys tune them; their texts appear only when a limit holds a send. Reason: a flag that is off would hold sends with no visible reason, and the limit exists to stop bugs everywhere at once. Rejected: a flag `send_limits` default off (P2 asks a flag for new user-visible behaviour; the wait text explains a state the limit makes). Default, owner to confirm (Q1).
- **D2 Keys and windows.** `SEND_LIMIT_MAILBOX_HOUR` (default 20), `SEND_LIMIT_MAILBOX_DAY` (100), `SEND_LIMIT_RECIPIENT_DAY` (5): integers 1–10 000; anything else stops the start (`ConfigError` names the key). Windows are rolling and absolute: a send counts while `send_started_at > now − window` (1 h or 24 h); no calendar day, no time zone, no DST effect. The recipient limit counts per mailbox and address; an address is compared trimmed and lower-cased. Default, owner to confirm (Q2: per mailbox, not per organization).
- **D3 The pure rule in core.** `checkSendLimits({ now, recent, to, limits })` in `packages/core/src/send-limits.ts` returns `{ kind: "ok" }` or `{ kind: "held", limit, until }` with `limit` in `mailbox_hour | mailbox_day | recipient_day`. For a window with `k ≥ cap` counted sends at ascending times `t[0..k−1]`, `until = t[k − cap] + window`: at that instant `cap − 1` sends remain, so the send passes. When several windows hold, the latest `until` wins; on equal `until` the first in the order `mailbox_hour`, `mailbox_day`, `recipient_day`. Reference check P2 gives the test values.
- **D4 What counts.** Rows of `actions` with `type = 'send'`, of the mailbox (through `emails.mailbox_id`), with `send_started_at` in the 24 h window and status `applying`, `applied`, or `failed` with `status_reason = 'outcome_unknown'` (the mail may have gone out). Not counted: `approved` (not started, or put back before the SMTP call), `rejected`, `expired`, and other `failed` reasons (the server refused, or the call never reached the content). Reason: the rule stops mail that reaches people; a send that the server refused reached nobody. Rejected: counting `action.applying` audit rows (a soft retry writes one per try, so a slow server would fill the window).
- **D5 One new column, no counter table.** `actions.send_started_at timestamptz NULL`. `markApplying` sets it to the caller's `now` for a `send` row each time the row enters `applying` (a released and re-claimed send gets the time of its real SMTP try). The migration backfills `send_started_at = coalesce(applied_at, updated_at)` for existing send rows that count (D4), and adds the partial index `actions_send_started_idx ON actions (org_id, send_started_at) WHERE type = 'send' AND send_started_at IS NOT NULL`. Reason: `applied_at` is null for `applying` and `failed` rows, and `updated_at` moves on later writes (Sent copy, retention). The column holds no personal data; E7-T3 lists it as "not personal" in the DSR map.
- **D6 The check sits where the send becomes `applying`, inside one transaction with a lock.** In `applySend` step (2): `pg_advisory_xact_lock(hashtextextended('send_limit:' || <mailboxId>, 0))`, then `listRecentSends` (24 h), then `checkSendLimits`. `ok` → `markApplying` and the `action.applying` audit row as today, in the same transaction. `held` → `releaseAction(toStatus 'approved', nextAttemptAt until, countAttempt false, lastError 'send_limit:<limit>')` and the audit row `action.send_limited` (`reasonCode: 'send_limit'`, data `{ limit, until, mailbox_id }`) in the same transaction; `applySend` returns `{ kind: "retry", soft: false }`, so the batch goes on with its other rows. The advisory lock makes two committers (two processes, or a run that overlaps a slow run) count one after the other: the second sees the first one's `applying` row. Shape copied from `mail/repo.ts:173` (`mailbox_limit:` lock). The code lives in a new file `actions/send-limit.ts`; `send.ts` (516 lines, over the size rule, F091 D20) only calls it.
- **D7 The recovery of an `applying` send never checks the limit.** It sends nothing (`recoverSend`).
- **D8 A hold counts no attempt and keeps the approval clock.** A send held past 48 h after the tap ends `expired` / `held_timeout` through the existing expiry job; the `held_timeout` text adds "the send limit" (stage 04). The recipient window is 24 h, so only a send approved more than 24 h before its hold can reach this.
- **D9 The soft-error cap still counts from the tap.** A send held longer than 6 h that then gets a soft SMTP error fails at once with the soft-cap text; the user can tap "Send again". Reason: a hold is rare, and moving the cap needs a second column. Default, owner to confirm (Q3).
- **D10 The operator notice `send_limit`.** `CommitterDeps.onSendLimited?: (ctx, hit: { mailboxId, limit, until, at }) => void`, called after the hold transaction commits, never awaited for errors. `main.ts` wires it to `operator.sendLimitReached(ctx, hit)` in `channels/operator.ts`: kind `send_limit`, key `send_limit:<mailboxId>:<UTC date of at>`, text `Mailbox <mailboxId> of org <orgId> hit the send limit <limit> at <at ISO>; its sends wait until <until ISO>.` The existing dedup (`operator.notice` audit row with `data.key`) makes it one per mailbox per UTC day.
- **D11 What the user sees.** (a) Panel and digest: `ActionView` gets `waiting?: "send_limit"`, set when `status = 'approved'`, `last_error` starts with `send_limit:` and `next_attempt_at` is not null; the send phrase is then `approved, waiting: send limit`. An auth-error release sets `next_attempt_at` to null, so it never shows this phrase. (b) Telegram: a new notice kind `send_held`, one per mailbox per UTC day per owner (dedup key `send_held:<mailboxId>:<YYYY-MM-DD of now>`), queued by a detector that finds held sends (`status = 'approved'`, `last_error LIKE 'send_limit:%'`, `next_attempt_at > now`). View `{ mailboxId, address, limit, waiting, nextAt, now, timeZone }`. Text (exact, stage 05): `⏸ Sends from <address> wait: <limit text>. <waiting> waiting; the next one goes out at about <HH:MM>.` Limit texts name the window, not the number: `mailbox_hour` → `the hourly send limit of this mailbox is reached`, `mailbox_day` → `the daily send limit of this mailbox is reached`, `recipient_day` → `the daily limit for one recipient is reached`. No numbers in the view: `channels` does not read the send-limit config.
- **D12 Clocks.** All times come from the committer's `now` (fixed clocks in tests). `send_started_at` is the `now` of the call, not SQL `now()`.

**Operator console (lane B)**

- **D13 A new module `operator` in a new top layer.** `apps/server/src/modules/operator/` (`index.ts`, `service.ts`, `routes.ts`); `layers.json` gets a fifth layer `["operator"]`. It may import every lower module's index. `operatorRoutes` moves from `tenancy/operator-routes.ts` to `operator/routes.ts` (git mv, then edit); `featureStatesOfAll` stays in `tenancy`. Reason: ADR 0027 point 2; the console reads six modules. Rejected: routes in `web.ts` (a composition root with business reads).
- **D14 Reads per organization through tenant-scoped functions.** The operator service lists organizations with `listOrganizations`, then calls tenant-scoped repository functions with `{ orgId }` for each. No new repository function without `TenantContext`. Reason: the tenant-filter rule stays whole, and the number of organizations is small (pilot; at most about 20 per server before the E8 load test). Cost: about 9 queries per organization for the list. Rejected: cross-organization aggregate queries (each one a new exception in `docs/code-patterns.md` § Data access).
- **D15 Ids, codes, counts and dates only.** No organization name, no mailbox address, no user e-mail address or name, no mail text, no log text. Mailboxes are shown by id and status. The operator maps ids to customers with `org:status` on the server.
- **D16 Routes.** All under `/api/operator`, guarded by `requireOperator` (F087):
  - `GET /orgs` → `OperatorOrgList` (stage 07);
  - `GET /orgs/:orgId` → `OperatorOrgDetail` (stage 08); a path id that is not a UUID or an unknown id → 404 `{ error: "not_found" }` (the path-id rule of `config/routes.ts`);
  - `GET /notices?days=N` (1–30, default 7) → `OperatorNotices` (stage 08);
  - `GET /flags` (F087, unchanged);
  - `POST /orgs/:orgId/plan` and `POST /orgs/:orgId/flags` (stage 09).
- **D17 Last job runs and failures, from existing rows.** Last sync = newest `mailboxes.last_synced_at`; last triage = newest `triage_results.created_at`; last digest = newest `digests.sent_at`; last send = newest `actions.applied_at` of an applied send; last notice = newest `outbox.sent_at`. Failures of the last 24 h: failed sends (`actions` type `send`, status `failed`, `updated_at` in 24 h), failed outbox rows (status `failed`, `created_at` in 24 h; the outbox has no failure time, and a row lives at most 24 h), mailboxes in `auth_error` with `status_changed_at`.
- **D18 LLM calls today.** "Today" is the quota day of the LLM cap (`quotaDayStart(now, QUOTA_TIMEZONE)` from `@ea/core`). Per model: calls, tokens in, tokens out from `llm.call` audit rows; cost = `costPerMail(model, tokensIn, tokensOut, now)` (linear in tokens: `packages/core/src/triage/cost.ts:28`); a model without a price adds its calls to `unpricedCalls` and no cost. E3a may replace this with its stats command (PD-066).
- **D19 The notice list (absorbs F081).** The `operator.notice` audit rows of every organization in the last N days, newest first, at most 200: `{ orgId, kind, key, at }`. The key holds ids and dates only (`channels/operator.ts`). E8b SLO alerts use the same frame, so they appear here without a change.
- **D20 Writes call the CLI's service functions.** `POST /orgs/:orgId/plan` calls `setOrgPlan` with the hooks of `org:plan` (`onSuspended: cancelPendingOutboxOfOrg`, `onResumed: resumeHook(db)`), injected from `web.ts` as `planHooks`; `POST /orgs/:orgId/flags` calls `setOrgFeature`. Actor = the operator's user id. The audit rows go into the target organization, as for the CLI. No "clear" of a flag (F087 D12 stays). Bodies are `@ea/core/web` schemas (stage 09).
- **D21 Operator writes work while the operator's own organization is suspended.** `SUSPENDED_WRITE_ALLOW` gets `{ method: "POST", path: /^\/api\/operator\// }` (F087 D15 note). The operator acts on other organizations; its own plan does not matter.
- **D22 The page `/operator`.** A static Astro page with one island. The server answers non-operators the normal 404 page for every path that matches `/^\/operator(\/|$)/i` (Probe P1: the guard on `c.req.path` covers `/operator`, `/operator/`, `/operator/index.html`, `/%6Fperator`, `/./operator`, `/settings/../operator`). The data is behind the API guard anyway; this hides the page. The nav shows the item "Operator" only when `me.operator` is true. The page reloads its data every 60 s with the panel's `useResource` pattern, plus a "Reload" button.
- **D23 `/api/me` gets `operator: boolean` and `features: string[]`.** `features` lists the registry keys that are on for the organization (`featureStates`); `z.array(z.string())` so a web build never fails on a new key. This is the web read path that F087 D22 left to the first web feature; E3a and later epics use it. `operator` comes from an injected `isOperator(userId)` (the `OPERATOR_USER_IDS` set of `webDeps`), so `tenancy` reads no config.
- **D24 The operator stays a member of an organization** (F087 D17). TOTP for operators comes with E7-T6 (PD-043); this plan adds nothing for it.

**Security log (lane C)**

- **D25 One registry of security events.** `securityEvents` in `packages/core/src/security-log.ts`: audit event code → kind key. First entries: `web.login` → `sign_in`, `web.login_locked` → `locked`, `web.password_set` → `password_set`, `web.password_changed` → `password_changed`, `web.sessions_revoked` → `sessions_ended`, `web.other_sessions_revoked` → `other_sessions_ended`. E7-T6 adds the 2FA events, E7-T3 the export, delete and DSR events (one entry each, plus a web text). A server test fails when a registry code is not a value of `auditEvents`.
- **D26 Who sees it.** Owners only (`requireOwner`: an assistant gets 403 `owner_only`). Behind the flag `security_log` (registry: epic `E7-T2`, remove-by `2027-03-01`, default off): off → 404 `{ error: "not_found" }`. The Account card shows the section only when `me.role === "owner"` and `me.features` holds `security_log`.
- **D27 What it shows.** The newest 50 rows of registry events of the organization from the last 90 days, newest first. Each row: `at`, `kind`, `actor` (`{ kind: "member", name }` for a user id of a member, `{ kind: "former_member" }` for another user id, `{ kind: "operator" }` for `cli`, `{ kind: "system" }` for `system`), and `lockedUntil` (ISO or null, from `data.locked_until` of `locked`). No IP, no e-mail address, no user id. Web events of a user land in the user's oldest organization (`web.ts` `auditWebEvent`), so an owner sees the members whose oldest organization is this one.
- **D28 The audit read is one function.** `listAuditEvents(db, ctx, { events, since, limit })` in `audit/repo.ts` (newest first, by `created_at` then `id`); the security log and the operator notice list both use it. The index `audit_log_org_event_created_idx (org_id, event, created_at)` serves it.

**Build and order**

- **D29 Polish texts.** New web strings are keys in `apps/web/src/i18n/en.ts`. If `apps/web/src/i18n/pl.ts` exists at build time (E7-T1 landed), the stage adds the Polish key too and follows the rules E7-T1 wrote into `docs/code-patterns.md` § Web app. New notice and operator texts are English only (E7-T1 adds Polish notice texts by locale).
- **D30 Lanes.** Lane A 01→05, lane B 06→11, lane C 12→13 (after 06: it needs `me.features`); 14 after all; 15 last. Lanes may run at the same time; they share only export lines in `packages/core/src/index.ts`, `packages/core/src/web/index.ts`, `apps/web/src/i18n/en.ts` and `docs/diagrams/module-graph.*`. On a land conflict the coordinator resumes the worker to merge `master` and re-prove (`spec/build.md` rule). Stages 02 and 05 add a migration: never two migrations in build at once, in any ticket.
- **D31 No owner checkpoint** (job instruction). Review jobs before the land: stages 02, 03, 05 (migrations, sending to people), 06, 07, 08, 09 (operator auth and cross-organization reads and writes), 12 (security log, tenant and role filter).
- **D32 VPS stage is the coordinator's** (`spec/build.md`: VPS, ssh and deploy steps are pre-approved). It sets `OPERATOR_USER_IDS` to the pilot owner's user id (a user id is not a secret) and turns `security_log` on for the pilot organization (P2: "on for the pilot first"). Default, owner to confirm (Q4).

## Differences found at collect (2026-11-14)

- The ticket row says "feature flags". F087 built the store, the CLI, the kill list and `GET /api/operator/flags`. What is left for this ticket: the console view and switch, and the web read path (`/api/me` features, D23).
- The discovery note says "inside the existing send lock". No send lock exists: a send row is claimed with `FOR UPDATE SKIP LOCKED` and the claim commits at once. D6 adds a per-mailbox advisory lock in the `markApplying` transaction.
- The discovery note says "the Telegram card shows 'waiting: send limit'". The approval card is edited only after a tap (`renderNoticeEdit`); nothing edits it later. D11 uses a new notice kind instead of a late card edit.
- F081 (dropped, absorbed) asked "store the text, or build it from the kind and the key". D19 shows kind and key; the key holds ids and dates.
- `actions/repo.ts` (1758 lines) and `mail/repo.ts` are split by F091 (active). The stages name F091's files (`actions/repo/lifecycle.ts`, `sends.ts`, `reads.ts`, `notify.ts`; F091 plan D9, D10). The ticket builds after F091.
- `docs/capabilities/` does not exist yet (E1, F095, builds it). Stage 14 updates it only if it exists.

## Facts checked (2026-11-14)

- **P1 Page guard (probe `.probe-f099/probe.ts`, deleted after; Hono 4.13.16, `@hono/bun` `serveStatic`, Bun 1.4.4).** A middleware before `serveStatic` that tests `c.req.path` against `/^\/operator(\/|$)/i` answers for `/operator`, `/operator/`, `/operator/index.html`, `/%6Fperator`, `/%6fperator/`, `/OPERATOR`, `/./operator`, `/settings/../operator`, `/operator/index%2Ehtml`. Without the guard `serveStatic` serves `dist/operator/index.html` for all of these except `/OPERATOR`. `/operator%2F`, `//operator` and `/operator.html` serve no file in both cases. Astro `output: "static"` with the default `build.format` writes `dist/<page>/index.html`.
- **P2 Reference check of D3 (`.probe-f099/limits.ts`, deleted after).** With `now = 2026-11-20T10:00:00Z` and the default limits: 20 sends at −50…−31 min → held `mailbox_hour` until `10:10:00Z`; 19 sends → ok; one send at exactly −60 min plus 19 later → ok; 100 sends at −23 h + i × 13 min → held `mailbox_day` until `11:00:00Z`; 5 sends to `a@x.test` at −10, −8, −6, −4, −2 h and a new send to ` A@X.test ` → held `recipient_day` until `2026-11-21T00:00:00Z`; the same with a new send to `b@x.test` → ok; at `now = 10:10:00Z` the 20-send case → ok. Stage 01 uses these values.
- The `send` path (read at `5d3817b`): `applySend` commits `markApplying` and the `action.applying` audit row in one transaction before the SMTP call (`actions/send.ts`, step 2); `releaseAction` keeps `last_error` when `lastError` is not passed and sets `next_attempt_at` as given; the auth-error release sets `next_attempt_at` to null (`send.ts` `sendFailed`). `claimableWhere` skips a row whose `next_attempt_at` is in the future and an `approved` send older than `APPROVAL_TTL_MS` (48 h) (`actions/repo.ts:404–420`).
- `transitions.ts` row `E12` (`approved → approved`, `releaseAction`, send) lists the reasons of a release; a new reason is one more string there.
- Operator notices: `createOperatorNotices` dedups by an `operator.notice` audit row with `data.key`, written after a successful send or log line; `capReached` is the model for a callback that never throws (`channels/operator.ts`).
- Web events: `auditWebEvent` writes `web.login`, `web.password_set`, `web.password_changed`, `web.login_locked` (data `locked_until`), `web.sessions_revoked`, `web.other_sessions_revoked` with `actor` = the user id, in the user's oldest organization (`apps/server/src/web.ts:52–83`).
- `audit_log` has the index `audit_log_org_event_created_idx (org_id, event, created_at)` (`db/migrations/20261104000001_triage.sql:118`).
- `costPerMail` is `(tokensIn × inputPerM + tokensOut × outputPerM) / 1e6` for the price valid at `at`, null for an unknown model (`packages/core/src/triage/cost.ts:28–42`). `quotaDayStart` and `QUOTA_TIMEZONE` are in `packages/core/src/triage/quota-day.ts`.
- `org:plan` passes `{ onSuspended: cancelPendingOutboxOfOrg, onResumed: resumeHook(db) }` to `setOrgPlan` (`apps/server/src/scripts/org-plan.ts`); `resumeHook` lives in `composition.ts`.
- `createApp` order: `requireSession` → `requireTenant` → `api.use("/operator/*", requireOperator)` → `refuseSuspendedWrites` (`platform/http.ts:358–362`). F087 P2 showed the prefix guard covers every path form of `/api/operator/*`.
- The newest migration is `20261113110001_org_features.sql`; the outbox CHECK change model is `20261111000001_delete_mailbox.sql` (`docs/code-patterns.md` § Add a notice kind).
- The log-field allow list (`platform/log-fields.ts`) has `org_id`, `mailbox_id`, `action_id`, `user_id`, `count`, `kind`, `reason`, `status`, `flag`; no `until` or `limit` field.

## Not verified

- F091's final file names. Its plan D9 and D10 name them; the stages say "the file that holds `<function>` after F091". A worker who finds another layout follows the function, not the file name, and says so in the final message.
- That the F086 layer lint accepts a fifth layer with one module. Stage 06 checks it: `bun run lint` and `apps/server/src/modules/layers.test.ts` pass.
- The cost of the per-organization reads (D14) at 20 organizations. Stage 07 measures the time of `GET /orgs` with 3 organizations in its test and reports it; the docs stage writes the bound.
- The Telegram text width of `send_held` on a phone: stage 15 does not send one on the VPS (no limit is reached there). The unit test fixes the text.

## Done when

1. `checkSendLimits` follows D3 with the P2 values. Shown by: `packages/core/src/send-limits.test.ts` (stage 01).
2. A send over a limit stays `approved` with `next_attempt_at = until`, `last_error = send_limit:<limit>`, one `action.send_limited` audit row and no SMTP call; at `until` it goes out. Shown by: `apps/server/test/integration/actions-send-limit.test.ts` (stage 03).
3. Two committers at once never pass a limit. Shown by: the two-connection case of `actions-send-limit.test.ts` (stage 03).
4. `send_started_at` is set by `markApplying` for sends and backfilled; each new repository function filters by `org_id`. Shown by: `actions-send-started.test.ts` (stage 02).
5. The panel and the digest phrase say `approved, waiting: send limit`; the operator gets one `send_limit` notice per mailbox per UTC day. Shown by: `packages/core/src/digest/would-do.test.ts` (stage 04), `channels-operator.test.ts` (stage 04).
6. Each owner gets one `send_held` notice per mailbox per UTC day with the exact text. Shown by: `packages/core/src/notices/*.test.ts`, `channels-notices.test.ts`, the registry and CHECK tests (stage 05).
7. A non-operator, also an owner, gets 404 on every `/api/operator/*` route and on the `/operator` page in every path form of P1. Shown by: `web-operator.test.ts`, `web-operator-page.test.ts` (stages 06–09).
8. `/api/me` has `operator` and `features`. Shown by: `web-me.test.ts` (stage 06).
9. The operator reads the organization list, the detail of one organization and the notice list, with ids, codes, counts and dates only. Shown by: `web-operator.test.ts` key-set assertions (stages 07, 08).
10. The operator changes a plan and a flag; the audit rows equal the CLI's except the actor. Shown by: `web-operator-writes.test.ts` (stage 09).
11. The `/operator` page and the Account card section build and show their data. Shown by: `bun run web:build` and the `apps/web/src/lib/*.test.ts` of stages 10, 11, 13.
12. `GET /api/security-log`: 404 with the flag off, 403 for an assistant, the newest 50 registry rows of 90 days for an owner, no e-mail address or user id in the body. Shown by: `web-security-log.test.ts` (stage 12).
13. On the VPS: the migrations ran, the start log shows the send limits and `operator ids: 1`, the pilot organization has `security_log` on. Shown by: stage 15 checks.

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, the ticket, this file and your stage file first. Build only your stage.
- Format only the files of your stage: `bunx prettier --write <files>`. Never the whole repo (S2 incident: a builder ran the repo-wide formatter).
- Log lines are events (`docs/code-patterns.md` § Logs): `log.info("send_limited", { action_id, mailbox_id, kind })`. Fields only from `platform/log-fields.ts`; do not add a field for a time or an address. Errors through `...errorFields(error)`. An old-form line that you do not touch stays.
- Logs, audit rows, operator notices, CLI output, API error bodies and test names hold ids, codes, counts and times. Never an organization name, a user name or e-mail address, a recipient address, a mail text or a secret. The `send_held` view holds the mailbox address (the user's own address, like `auth_error`); it never reaches a log line.
- The repo is public: no real name, address or user id in a file. Test addresses end in `@x.test`.
- Template literals for strings with variables; `const` / `let` only. Comments name a rule or an ADR, not a bare code (`docs/code-patterns.md` § Style).
- A test with a time passes a fixed `now` (`2026-11-20T10:00:00Z` unless the stage says another), never `Date.now()` in an assertion.
- All test files of one `bun test` call run in one process, one file after another; other tests commit rows too. A test that reads across organizations asserts on its own organization ids, never on a total count. A test that calls `configureFeatures` with a non-empty kill list resets it with `configureFeatures({ off: [] })` in `afterEach`.
- A stage that changes a type or a required field fixes every caller and test in the same stage, so all checks pass at its commit.
- After F091, `actions/repo/index.ts` and `mail/repo/index.ts` list names (F091 D11): a new repository function is exported from its file, listed in `repo/index.ts`, and, if another module uses it, in the module `index.ts`.
- A new or removed import between two modules: run `bun run graph:modules` and commit `docs/diagrams/module-graph.{md,json}`.
- Web: every visible string is a key in `apps/web/src/i18n/en.ts` through `t()`; D29 for `pl.ts`. shadcn components only from the shadcn CLI; reuse the ones in `apps/web/src/components/ui/`. No new dependency.
- Commit by explicit path (`git add <paths>`), never `git add -A`.
- Only stages 02 and 05 add a migration; after a migration run `bun run db:types` against the job's own DB. No stage changes `bun.lock` or the dependencies of a `package.json`. If you think you need a dependency, stop and ask.
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or another ticket.
- A gap or a deviation is a question in your final message, not a choice.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows. `test:int:ci` needs no lock: each job has its own DB (`CLAUDE.md`). No stage runs `test:e2e`.

Server and core stages (01–09, 12; NN = the stage number):

```
mkdir -p /tmp/f099-sNN && bun run lint > /tmp/f099-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f099-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f099-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f099-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages (10, 11, 13): the same chain with `&& bun run web:build > /tmp/f099-sNN/web.log 2>&1` before `&& echo PROOF_OK`.

Stage 14 (docs only; `<files>` = the files the stage changed):

```
mkdir -p /tmp/f099-s14 && bunx prettier --check <files> > /tmp/f099-s14/prettier.log 2>&1 && bun run lint > /tmp/f099-s14/lint.log 2>&1 && bun run test:unit:ci > /tmp/f099-s14/unit.log 2>&1 && echo PROOF_OK
```

Stage 15 has its own checks (stage file).

## User checkpoints

None (owner rule 2026-11-14: no checkpoints for confirmation). The review jobs of D31 replace them.

## User steps

None needs the owner's hands. The coordinator runs:

| #   | Step                                                                                                       | When                          |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------------------------- |
| C1  | `bun run db:migrate` on the shared dev database (main checkout, no other migration running).               | after stage 02 and stage 05 land |
| C2  | Stage 15 on the VPS (migrate, deploy, `OPERATOR_USER_IDS`, `security_log` on for the pilot).                | after stage 14 lands          |

Optional for the owner, after stage 15: open `/operator` in the signed-in browser and look.

## Review

- A review job before the land for stages 02, 03, 05, 06, 07, 08, 09, 12 (D31). Model: the board's reviewer (`spec/build.md` § TRACK: `claude-sonnet-5-5`, high). Other stages land on the worker's proof.
- Review spawn (after the worker job is done; `<B>` = the job's branch, `NN` and `<slug>` from the stage list):

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --review --detached --branch <B> --label "review s<NN> · F099" \
  "Review F099 stage NN on <B> against spec/features/active/F099-e7-t2-platform-controls-send-limits-feature-flags-operator-console-security-log/plan.md and stages/stage-NN-<slug>.md. Check that every numbered test exists and asserts what the stage says, the log and data rules, the tenant filter of every new repository function, and every decision the stage cites. Stages 03: try to send over a limit with two committers or a crash between the hold and the commit. Stages 06–09: try to reach /api/operator/* or /operator as a non-operator by any path form, and look for a name, address or mail text in an operator answer. Stage 12: try to read another organization's rows or an assistant's view. Quote file and line for each finding."
```

## Stages

| #   | Stage                                                                                                                  | Size       | Lane | Mark                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | ---- | ------------------------------------- |
| 01  | [Send-limit rule and config](stages/stage-01-send-limit-rule.md) — `checkSendLimits` in core, three env keys           | ~220 lines | A    |                                       |
| 02  | [Send start column](stages/stage-02-send-started-column.md) — migration, `markApplying`, `listRecentSends`              | ~200 lines | A    | `[risky]` migration                   |
| 03  | [Hold in the committer](stages/stage-03-hold-in-the-committer.md) — lock, count, hold, audit, callback                  | ~300 lines | A    | `[risky]` sending to people           |
| 04  | [Visible wait and operator notice](stages/stage-04-visible-wait-and-operator-notice.md) — phrase, `held_timeout` text, `send_limit` notice, wiring | ~220 lines | A    |                                       |
| 05  | [Notice `send_held`](stages/stage-05-send-held-notice.md) — core kind, renderer, migration CHECK, detector              | ~300 lines | A    | `[risky]` migration, sending to people |
| 06  | [Operator module and `/api/me`](stages/stage-06-operator-module-and-me.md) — module move, layer, page guard, suspended writes, `operator` and `features` | ~260 lines | B    | `[risky]` auth                        |
| 07  | [Organization list](stages/stage-07-operator-org-list.md) — `GET /api/operator/orgs`, tenant-scoped reads              | ~300 lines | B    | `[risky]` cross-tenant read           |
| 08  | [Organization detail and notices](stages/stage-08-operator-org-detail-and-notices.md) — `GET /orgs/:orgId`, `GET /notices`, `listAuditEvents` | ~300 lines | B    | `[risky]` cross-tenant read           |
| 09  | [Operator writes](stages/stage-09-operator-writes.md) — plan and flag changes                                          | ~250 lines | B    | `[risky]` cross-tenant write          |
| 10  | [Operator page](stages/stage-10-operator-page.md) — `/operator`, list, detail, notices, nav                             | ~300 lines | B    |                                       |
| 11  | [Operator page writes](stages/stage-11-operator-page-writes.md) — plan dialog, flag switches                            | ~250 lines | B    |                                       |
| 12  | [Security log route](stages/stage-12-security-log-route.md) — registry, flag, `GET /api/security-log`                   | ~250 lines | C    | `[risky]` security, tenant filter     |
| 13  | [Security log card](stages/stage-13-security-log-card.md) — Account card section                                       | ~180 lines | C    |                                       |
| 14  | [Docs and standards](stages/stage-14-docs-and-standards.md)                                                            | ~150 lines | —    |                                       |
| 15  | [VPS deploy](stages/stage-15-vps-deploy.md) — coordinator only                                                         | —          | —    | `[risky]` real system                 |

Order: lane A 01 → 02 → 03 → 04 → 05; lane B 06 → 07 → 08 → 09 → 10 → 11; lane C 12 → 13, started after 06 lands. 14 after 05, 11 and 13; 15 after 14. Stage 08 needs `listAuditEvents`: if stage 12 lands first, stage 08 reuses it; else stage 08 adds it and stage 12 reuses it (both stage files say so).

## How to run (coordinator)

1. Before the first spawn: F082 and F091 are in `spec/features/done/`. Move the ticket: `git mv spec/features/planned/F099-e7-t2-platform-controls-send-limits-feature-flags-operator-console-security-log spec/features/active/`, commit (the worktrees see only committed files).
2. Spawn one stage (NN = two digits, `<slug>` from the stage list):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F099-sNN <slug> · F099" \
     "Implement F099 stage NN. Read spec/features/active/F099-e7-t2-platform-controls-send-limits-feature-flags-operator-console-security-log/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f099-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

3. Before stage 02 or 05: no other migration stage of any ticket is in build.
4. When the job finishes: read its final message and `/tmp/f099-sNN/*.log`. For the stages of § Review, spawn the review job and wait for it; a finding → `limen continue <job-id> "<fix>"` with the same engine flags, then review again (at most 2 rounds, then the owner decides).
5. Land: `limen land <job-id> --yes --keep-open` (stage 15: the coordinator closes the ticket with `limen ticket done` after its checks). Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`. After stage 02 and stage 05: step C1.
6. Land stage N of a lane before you spawn stage N+1 of that lane. Lanes run at the same time (D30).
7. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass. A check with no proof at all → `limen continue`.

## Cold review

Pending.

## Log

- 2026-11-14: planned by a `--role planner` job (Opus 5.5). Probe P1, reference check P2.
