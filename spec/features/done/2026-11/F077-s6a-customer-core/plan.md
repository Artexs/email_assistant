> **Status 2026-11-12 — in progress in Limen (ticket F077).** Left: stages 6–18, one Limen worker job per stage, landed with `limen land --keep-open`. The old `run-task` flow, its worktree and its pipeline mode are not used (user decision 2026-11-12).

# S6a Customer core: scopes, consent, plan state, retention

Scope: the S6 master plan `tasks/active/s6-pre-sale.md` (findings 1 and 2, P3, D1–D6, D29, D31 (frame, trial, cap and `auth_error` events), "Rules for every step"). Also replaces the Limen tickets `spec/features/planned/F031-actions-scope-removal/` and `spec/features/planned/F027-retention-job/` (the old `actions-scope-removal.md` and `retention-job.md`, moved by the Limen migration `67cca12`; stage 18.5 closes them). Needs: S5 (done). No user step blocks the build (the scope change of 2026-11-12 dropped U0; master plan § "Scope change": local production on the home VPS, no outside customers; S6a stays whole, P17).
Build: Limen worker jobs (standing models in `spec/build.md`), one per stage, each in its own worktree and DB from `scripts/limen-prepare.sh`. Not `run-task`.

## Goal

A second organization can run next to the pilot: every mailbox is processed without `TEST_MAILBOX_ADDRESS`, the existing modes are the consent for changes, the operator can pause a customer, the number of mailboxes is limited, and stored texts expire after the documented periods.

## Done when

- `TRIAGE_LLM_SCOPE=all`, `ACTIONS_SCOPE=all` and `SEND_SCOPE=all` do not read `TEST_MAILBOX_ADDRESS` (grep in `apps/server/src/modules`, `apps/server/src/{main,composition,web}.ts` and `packages/core/src`: only `modules/mail/tools.ts`, `modules/mail/imap/probe-*.ts`, `modules/testmail/**` and `platform/config.ts` name it). Test: two organizations with one mailbox each, both get triage.
- In a `shadow` mailbox, every action row of a mailbox-changing type (`move`, `mark_read`, `flag`, `create_draft`, `send`) is `logged`, never `ready` (the DB-only `save_summary` is `ready` in every mode, §4.3); in an `assist` mailbox a move or mark-read is applied only for the categories with `auto` on, a flag or draft only with its switch on, a send only after a tap (existing tests stay green; one new test per gate, stage 2).
- `organizations.plan`, `trial_ends_at`, `max_mailboxes`, `resumed_at` exist, with the check `plan <> 'trial' or trial_ends_at is not null`; every organization that exists at migration time is `active`; `org:plan` changes them with an audit row; `org:create --plan`; `org:status` prints the D3 fields (ids and counts only).
- A `suspended` organization gets no sync, triage, `triage.returned`, action, send, chaser reminder, digest or notice (one test per job, with a second `active` organization that still gets its work in the same tick). The approval expiry and the retention job still run for it. The committer refuses a send whose approval is older than 48 h (any plan). Telegram taps and commands answer "account paused" and change nothing. Every web write route answers `403 org_suspended` except sign-out, password change and delete organization (route matrix test).
- Back from `suspended`: `resumed_at` is set; mail with `received_at < resumed_at − 24 h` that the sync stores before `resumed_at + 24 h` is `skipped` with `suspended_backlog`; the sync-late notice counts from `resumed_at` (tests with a fixed clock).
- Connect refuses the mailbox above `max_mailboxes` with `mailbox_limit` (web and CLI); the IMAP check runs outside the lock; two connects at once give one success and one `mailbox_limit` (advisory lock, D6).
- Operator notices (D31): with `OPERATOR_TELEGRAM_CHAT_ID` set, the trial-ends-in-3-days, daily-cap and 24 h `auth_error` events reach that chat with ids only; without it they are `warn` lines (tests).
- Before the deploy to the home VPS: the mailbox list of D2 is in the log (ids, status, mode), and every mailbox that is not the pilot mailbox is paused or removed by the user.
- The retention job clears each text of the `docs/architecture.md` §7 table after its period, also for a paused mailbox, a suspended organization and under `TRIAGE_LLM_SCOPE=off` (one test per row, fixed clock); a repeat run changes nothing.
- The panel shows "Trial ends on <date>" to owners in `trial`, and the paused banner with `OPERATOR_CONTACT` in `suspended`; the S5b scope badges show the new meaning (no "test mailbox only" text).
- `docs/architecture.md` §4.3, §7 and §8, `deploy/README.md` and `docs/code-patterns.md` describe the new rules.

## Owns (from the master plan)

- Decisions D1 (scopes), D2 (consent by mode, the mailbox list before the deploy), D3 (plan state, `org:plan`, `org:status`), D4 (`suspended` in every job, taps, web writes, resume), D5 (retention job), D6 (mailbox limit), D29 (`OPERATOR_CONTACT`), D31 (operator notices frame; S6b and S6f add events).

## Plan

> **How this plan is organised (as S5a):** the master plan `tasks/active/s6-pre-sale.md` holds D1–D33 and the "Rules for every step". This file holds what is specific to S6a: the collect results, the user's answers (S1–S4), the S6a design decisions (A1–A30), the rules, the stage list. Each stage is a file in `s6a-customer-core/stage-NN-<slug>.md` with every step's Goal, Files, Interfaces, Decisions, Test, Check, Done when, Out of scope, so that `run-task` **skips its `planner` call**. Written with the `plan-task` skill (handoff `~/.pi/agent/notes/2026-11-12-handoff-s6a-plan.md`).
>
> **A gap that the build finds = stop.** If a stage file does not answer a question, decide from this file ("Input", A1–A30, the master plan D1–D33) when it answers the gap; else ask the user. Never guess a rule of `suspended`, the scopes or the retention periods.

### Planning progress

The resumed session reads this file, then continues at the first unticked item.

- [x] Collect (2026-11-12): the handoff, the master plan, the segment sketch, `retention-job.md`, `actions-scope-removal.md`, `tasks/README.md`, `docs/code-patterns.md`, `docs/architecture.md` §4.3, §4.6, §7, §8, the S5a plan shape, and the code: `actions/{scope,committer,repo,constants,undo}.ts`, `triage/{jobs,service}.ts`, `mail/{repo,jobs,connect,connect-request,routes}.ts`, `channels/{notices,digest-job,sender,repo,commands,callbacks,port}.ts`, `channels/telegram/runtime.ts`, `tenancy/{repo,service,routes}.ts`, `audit/repo.ts`, `platform/{config,http}.ts`, `main.ts`, `composition.ts`, `web.ts`, `packages/core/src/web/{me,mailboxes}.ts`, `apps/web/src/{i18n/en.ts,lib/scope-text.ts,lib/errors.ts,components/shell/*}`, the migrations, the integration fixtures, `scripts/{org-create,job-run-args}.ts`. Differences: "Differences found at collect".
- [x] Task moved to `active/` (2026-11-12).
- [x] S6a questions sent; the user answered "proceed" (taken as the defaults, 2026-11-12); recorded as S1–S4.
- [x] Design decisions A1–A30 (2026-11-12).
- [x] Stage files written (16 files, 2026-11-12; 18 after the cold review split; `[written]` in the stage list).
- [x] Cold review (2026-11-12, `reviewer` subagent, Opus, high): VERDICT FAIL; blocker 0, major 5, minor 13, question 3. The full report is in the session; the fix list is below.
- [x] Cold review findings fixed (2026-11-12; result in "Cold review result" below). The session was paused once by the user in the middle and resumed ("Yes, continue, finish it now.").
- [x] `bunx prettier --check` on the plan files; commit and push on `master` (2026-11-12).
- [x] The user's OK ("ok", 2026-11-12, together with the scope change; the two open questions took the defaults).

### Input

The user's words (word for word):

- 2026-11-12: "Read /home/artek/.pi/agent/notes/2026-11-12-handoff-s6a-plan.md and follow its "Start here" section. So the plan is prepared and right now I have to implement it, right?"
- 2026-11-12, after the agent sent the S6a questions with defaults: "Okay, so this is planning session. If so, then proceed." — The agent took this as "go with the defaults" for S1–S4. The end summary names the four defaults again, so the user can change them before the OK.
- 2026-11-12, mid-session: "Stop it when you can and then tell me current status and progress and idea for this conversation." Then: "Yes, continue, finish it now."
- Earlier words that set S6 (master plan "Input"): "Go with defaults" (P1–P15), "ok" (the master plan).

**Size.** 18 stages; 11 `[risky]` (1, 2, 4, 6, 7, 8, 9, 10, 12, 13, 14). About 2 800 changed lines with tests.

### Differences found at collect (2026-11-12, against the handoff "Current state" and "Key data")

1. At the start: `master` = `origin/master` = `866c1bc`; only the other session's files were uncommitted. **During this session the other session merged the Limen migration into `master` (`67cca12`, then `99c5a4c`):** the old `tasks/planned/*` and `tasks/done/*` files moved to `spec/features/<lane>/F<NNN>-<slug>/` (`plan.md` is the old task file), and `CLAUDE.md` § Work keeps the old `tasks/` flow only for the S6 family. So `retention-job.md` is now `spec/features/planned/F027-retention-job/plan.md`, `actions-scope-removal.md` is `F031-actions-scope-removal/`, and the S6a follow-ups are Limen tickets (stage 17.2). `CLAUDE.md` no longer holds the Git mode lines; `tasks/README.md` § "Git mode" still applies to S6. The handoff claims about `scope.ts`, `triage/jobs.ts:46,67`, `config.ts:78,116-121`, `LLM_DAILY_CAP`, the mailbox statuses, `organizations` columns and the last migration are correct.
2. **More files read `TEST_MAILBOX_ADDRESS` for the scopes than the handoff lists:** `web.ts:78` (`scopeEnvOf`), `packages/core/src/web/{mailboxes,me}.ts` (`ScopeEnv.testMailboxAddress`, the badge reasons `test_mailbox_only` and `other_mailbox`), `modules/mail/{views,routes}.ts`, `apps/web/src/lib/scope-text.ts`, and the `/status` texts in `modules/channels/commands.ts:55-67` ("real mail of the test mailbox"). Stages 1 and 3 change them.
3. **The 48 h approval rule of D4 exists already:** `claimableWhere` in `actions/repo.ts` claims an `approved` send only when `approved_at >= now − APPROVAL_TTL_MS` (48 h, `actions/constants.ts:5`), and the expiry job ends it as `held_timeout` (test `actions-repo.test.ts` "15b"). Stage 6 adds only a test for a suspended-then-resumed organization; no new code.
4. **D3's literal SQL `plan … default 'trial'` breaks every insert without `trial_ends_at`:** the check `plan <> 'trial' or trial_ends_at is not null` then fails for `createOrganizationWithOwner` and every test fixture (`fixtures.ts:createOrgWithMailbox`). A7 sets the column default to `'active'`; the CLIs set `trial` explicitly. The end summary names this change.
5. **The operator notices cannot use the `outbox`:** an `outbox` row needs `org_id` and `user_id` of a member (`20261106000001_telegram.sql:44-65`), and the operator chat is not a member. A19 uses a direct send, deduplicated by an audit row.
6. **The digest counts every `email.skipped` row as "older than 7 days"** (`reports/digest.ts:122`, `packages/core/src/digest/digest.ts:148`). A backlog skip would show the wrong text, so stage 9 splits the count by `reason_code`.
7. **Two places read `emails.body_text` after triage:** the draft quote (`actions/drafts.ts:52`) and the approval view (`channels/notices.ts:386`). The retention job never clears the body of `processing` mail, and of `pending` mail only after 7 days (A23); a draft of a cleared mail quotes nothing (`quoteOriginal` writes "> (no text)", A24).
8. VPS state not checked (it needs the user's fresh yes). No test run in this plan session.

### User decisions (2026-11-12, "proceed" = the defaults)

- **S1 Consent text in the connect form.** One line above the connect button: "Your mail goes to our AI provider to sort it. Nothing in the mailbox changes until you set the mode to assist." The provider name is not in the text: production uses Vertex AI EU only after S6d, and S6e writes the legal text. Key `connect_consent` in `en.ts`.
- **S2 Settings in `suspended`.** No web write works, except sign-out, password change (and "sign out everywhere", the Better Auth session routes) and, from S6c, "delete organization".
- **S3 Mail from before the pause.** No urgent notice goes out for it: the backlog rule skips it, and the urgent look-back starts at `resumed_at` (A16).
- **S4 Session.** Subagents yes; the cold review by the `reviewer` subagent (Opus, high); one approval at the end; this plan is committed on `master`.

### Facts checked (2026-11-12, from the code; no outside library is new in S6a)

- **F1** `listSyncTargets` (`mail/repo.ts:870`) = `listMailboxTargets(db, { statuses: ["active"] })`. Its callers: `mail/jobs.ts:62` (sync), `triage/jobs.ts:55`, `actions/committer.ts:383`, `triage/returned.ts:83`, `delegation/chaser.ts:204`. `actions/expiry.ts:197` calls `listMailboxTargets` with `active`, `paused`, `auth_error`.
- **F2** `listLinkedChats` (`channels/repo.ts:150`) has two callers: `channels/notices.ts:716` (`detectNotices`) and `channels/digest-job.ts:73` (`scheduleDigests`). `claimDueOutbox` (`channels/repo.ts:277`) is the sender's claim across organizations.
- **F3** The jobs in `main.ts`: `mail.sync`, `platform.heartbeat`, `triage.worker`, `actions.committer`, `actions.expiry`, `delegation.chaser`, `triage.returned`, `channels.notifier` (notice detection + outbox sender), `channels.digest`. The Telegram polling runs the commands and taps (`channels/telegram/bot.ts` → `createUpdateHandlers` in `channels/commands.ts:266`).
- **F4** Web write routes (all under `api` after `requireTenant`, `platform/http.ts:290-294`): `POST /channels/telegram/link`, `DELETE /channels/telegram/link`, `PATCH /settings/:mailboxId/mode`, `PATCH /settings/:mailboxId/switches/:name`, `PATCH /settings/:mailboxId/auto/:category`, `PATCH /settings/:mailboxId/sync-folders/:key`, `POST /rules`, `DELETE /rules/:id`, `POST /mailboxes`, `POST /mailboxes/:id/password`, `POST /mailboxes/:id/pause`, `POST /mailboxes/:id/resume`, `DELETE /mailboxes/:id`, `PATCH /organization`, `PATCH /me/digest-times`, `POST /onboarding/keep-mode`, `POST /feedback`, `POST /actions/undo`. The Better Auth paths (`/api/auth/*`) are mounted outside `api` (`http.ts:282`).
- **F5** `recordAuditOnce` (`audit/repo.ts`) dedups by `(org_id, event)` only; a dedup by key needs a new function (A19).
- **F6** `outbox.text` is `NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4096)`; `delegations.task_summary` is `NOT NULL`; `actions.payload` is `jsonb NOT NULL DEFAULT '{}'`; `triage_results.fields` is `jsonb NOT NULL DEFAULT '{}'`; `emails.subject`, `from_address`, `body_text` are nullable; `to_addresses`, `cc_addresses` are `text[] NOT NULL DEFAULT '{}'`; `emails.skip_reason` has no CHECK. `delete_mailbox` writes `[removed]` into `outbox.text` (`docs/architecture.md` §7).
- **F7** `emails.thread_key` comes from Message-ID headers (`mail/sync-rules.ts:32`), not from the subject: retention keeps it.
- **F8** `organizations` has the lock helper `lockOrganization` (`FOR NO KEY UPDATE`, `tenancy/repo.ts`). The integration tests that need two committed transactions create the organization outside `withRollback` and delete it in `finally` (`mail-connect.test.ts:301-320`).
- **F9** `TriageScope` today: `{ kind: "synthetic" } | { kind: "all"; mailboxAddress }` (`triage/jobs.ts:25`); `claimEmails` takes `syntheticOnly`.

### Not verified (the stage that checks it)

- `pg_advisory_xact_lock(hashtextextended(text, 0))` on our Postgres 17: standard since Postgres 11; stage 10 test 3 (two concurrent connects) proves it.
- That a foreign-key cascade from `organizations` deletes `audit_log` rows for the `app` role in the test cleanup: the existing tests do it (`mail-connect.test.ts:318`); stage 10 uses the same pattern.
- That a grammY API method takes an `AbortSignal` as its last argument (`bot.api.sendMessage(chatId, text, other, signal)`): stage 11.2 test 4; the fallback is a `Promise.race` with a timer.
- The VPS mailbox list, the VPS commit (`8f6a8b2` in the handoff) and the pilot's plan after the migration: stage 18 (needs the user's go).

### Design decisions (main session, 2026-11-12; why in each line)

**Scopes and consent (D1, D2)**

- **A1 Scope types without an address.** `ActionsScope = { kind: "off" } | { kind: "synthetic" } | { kind: "all" }`; `SendScope = { kind: "off" } | { kind: "self"; addresses: string[] } | { kind: "all" }`; `TriageScope = { kind: "synthetic" } | { kind: "all" }`. `claimFilterFor(scope)` and `sendFilterFor(scope)` lose the `mailboxAddress` argument; `all` gives `{ kind: "all" }`. Why: D1; the per-mailbox state is the mode (D2). Rejected: keep the field as optional (a later caller could fill it and bring the old rule back).
- **A2 Config.** The three `TEST_MAILBOX_ADDRESS` checks in `configSchema.superRefine` (`config.ts:184-189`, `200-202`) go. `TEST_MAILBOX_ADDRESS` stays an optional key for the test tools. The comments of the three scope keys and `.env.example` say the new meaning. Why: D1.
- **A3 Start log line (stage 6, after the gate exists).** With any scope `all`, `main.ts` logs once at start: `scope targets: <n> active mailboxes in <m> organizations, <k> suspended organizations` (a count query, ids not printed). Why: after the deploy the log proves the D2 list (one pilot mailbox).
- **A4 Badges and texts.** `ScopeEnv` loses `testMailboxAddress`; `mailboxScopeBadges(env)` takes no address. Badge reasons: remove `test_mailbox_only` and `other_mailbox`; add `all_mailboxes` (triage `all`), `by_mode` (actions `all`), `after_approval` (send `all`). `scopeInfoOf(scope, kind)` gets the scope name. Texts: `reason_by_mode` "Mailbox changes follow the mode of each mailbox: none in shadow mode."; `reason_after_approval` "A mail goes out only after an owner taps Send."; `all_mailboxes` shows no reason line. Telegram `/status` texts: "real mail of every active mailbox (TRIAGE_LLM_SCOPE=all)", "real mail, by the mode of each mailbox (ACTIONS_SCOPE=all)", "real recipients, after an owner's tap (SEND_SCOPE=all)". Why: the old texts say "test mailbox only".
- **A5 Consent gates (no new code).** The existing gates are the consent: the policy gives `log_only` in `shadow` (actions `logged`), `apply` in `assist` only with `auto` on for moves and mark-read, sends only after a tap. Stage 2 adds one test per gate for a second organization under `all`. A mailbox of a `suspended` organization gets no LLM call (stage 6 test).

**Plan state (D3)**

- **A6 Migration `20261112100001_org_plan.sql`** (exact SQL in stage 4). Columns `plan text NOT NULL DEFAULT 'active' CHECK (plan IN ('trial','active','suspended'))`, `trial_ends_at timestamptz`, `max_mailboxes integer NOT NULL DEFAULT 2 CHECK (max_mailboxes >= 0)`, `resumed_at timestamptz`, and the named check `organizations_trial_end_check CHECK (plan <> 'trial' OR trial_ends_at IS NOT NULL)`. Existing rows become `active` through the default. Why the default `active` and not D3's `trial`: difference 4 (the check would fail every insert without `trial_ends_at`). The CLIs set `trial` with a date (A7), so a new customer still starts in `trial`.
- **A7 Create.** `createOrganizationWithOwner` gets an optional `plan: { kind: "active" } | { kind: "trial"; endsAt: Date }` (absent = `active`, the DB default; the test fixtures stay as they are). `org:create` gets `--plan trial|active` (default `trial`) and `--trial-days N` (default 30, integer 1–365, only with `trial`). `org:invite` (S6b) uses the same input.
- **A8 Read.** `tenancy/repo.ts`: `getOrgPlan(db, ctx)` → `{ plan, trialEndsAt, maxMailboxes, resumedAt } | undefined`; `isOrgSuspended(db, ctx)` → `boolean` (a missing organization gives `false`: the callers already answer `not_found` for it). `listOrganizations(db)` (no `TenantContext`; for the retention job, the operator job and `org:status`) → `{ id, plan, trialEndsAt, timezone, dataRetentionDays, resumedAt }[]` ordered by `created_at, id`. `docs/code-patterns.md` lists it.
- **A9 Change (`setOrgPlan` in `tenancy/service.ts`).** Input `{ plan?: Plan; trialDays?: number; maxMailboxes?: number; actor: string; now: Date }`, at least one of the three. One transaction: `lockOrganization`, compute, update, audit row `org.plan_changed` (data: `from`, `to`, `max_from`, `max_to`, `trial_ends_at` ISO or null), then the hook `onSuspended` (A12) when `to = suspended` and `from ≠ suspended`. Rules:
  - `to = trial`: with `trialDays` → `trial_ends_at = now + trialDays × 24 h`; without it and the organization is already `trial` → keep the date; without it from another plan → result `trial_days_needed`, nothing written.
  - `to = active` or `suspended`: `trial_ends_at = null`; `trialDays` given → result `bad_input`.
  - `from = suspended` and `to ≠ suspended` → `resumed_at = now`. Other changes keep `resumed_at`.
  - `maxMailboxes` 0–100; a value below the current count is allowed (D3).
  - Nothing changes (same plan, same max, no `trialDays`) → result `unchanged`, no audit row.
    Results: `{ kind: "changed"; row }`, `unchanged`, `not_found`, `trial_days_needed`, `bad_input`. Why: D3; one transaction so that the audit row and the state agree.
- **A10 CLIs.** `org:plan --org-id <id> [--plan trial|active|suspended] [--trial-days N] [--max-mailboxes N]`; `org:status [--org-id <id>]` (A11). Both print ids, codes, dates (ISO UTC) and counts only, never an organization name or an address.
- **A11 `org:status` fields per organization:** `org <id> plan=<plan> trial_ends_at=<iso|-> max_mailboxes=<n> resumed_at=<iso|->`, then `mailboxes total=<n> active=<n> paused=<n> auth_error=<n>`, `last_sync=<iso of the newest last_synced_at|never>`, `llm_calls_today=<n>` (sum over the mailboxes of `countLlmCallsSince` from the quota day start, the triage `QUOTA_TIMEZONE` day), `telegram_chats=<n>` (linked chats of the organization). Why: D3, D31 (the operator's view).

**`suspended` (D4)**

- **A12 Suspend cancels the queued messages.** When `setOrgPlan` moves an organization to `suspended`, the injected hook `onSuspended(trx, ctx)` sets every `pending` `outbox` row of the organization to `failed` with `error_code = 'outdated'`, except the kinds `approval` and `approval_set` (`channels/repo.ts`: `cancelPendingOutboxOfOrg`; rows in `sending` finish). The approval rows stay because the notifier set `actions.notified_at` when it queued them and never queues them again (`channels/notices.ts:445`); they go out at a resume within 24 h (A17). The script `org-plan.ts` wires the hook (stage 5) (`tenancy` cannot import `channels`: `channels` imports `tenancy`). Why: S3; a queued urgent notice of the pause time must not go out at resume.
- **A13 The job gate is in the target queries.** `listMailboxTargets(db, { statuses, includeSuspended })` gets a required `includeSuspended: boolean`; without it, an inner join on `organizations` with `plan <> 'suspended'`. `listSyncTargets` passes `false` (sync, triage, committer, returned, chaser); `actions/expiry.ts` passes `true`. `listLinkedChats(db, { includeSuspended: false })` for the notices and the digest. `claimDueOutbox` skips rows of `suspended` organizations (`NOT EXISTS` on `organizations`). In addition, the sync, triage and committer loops check `isOrgSuspended` before each mailbox, so a run that started before the change stops at the next mailbox (D4: "finishes its current item"; stage 6). Why: one place per entry point; every job that walks organizations goes through one of these four queries (F1–F3). Rejected: a check in every job (easy to forget in the next job).
- **A14 Telegram.** `createUpdateHandlers` checks `isOrgSuspended` before every command except `/help`, and before every tap. A paused organization gets `ACCOUNT_PAUSED_TEXT` ("⏸ This account is paused. Nothing changes now. To resume it, contact <OPERATOR_CONTACT>." or, without the key, "… contact the operator."), and nothing changes. `/start` linking keeps working (it changes no mail and no LLM state). Why: D4.
- **A15 Web.** A middleware `refuseSuspendedWrites` in `platform/http.ts`, after `requireTenant` on the `api` router: a method other than `GET`, `HEAD`, `OPTIONS`, a path not in `SUSPENDED_WRITE_ALLOW` (empty in S6a; S6c adds "delete organization"), and `web.isOrgSuspended(orgId)` true → `403 { error: "org_suspended" }`. `WebDeps.isOrgSuspended` is optional (absent = never suspended, for old tests); `web.ts` wires it. Sign-out, password change and the session routes are Better Auth paths outside `api`, so they keep working. The gate runs before `requireOwner`, so an assistant also gets `org_suspended`. Why: D4, S2; the server decides, the UI only mirrors.
- **A16 Resume.** `resumed_at` (A9) drives three rules:
  - Triage (`triageOne`): after the `too_old` rule and before the hard rules, a mail with `backfilled_at IS NULL`, `received_at < resumed_at − 24 h` and `created_at < resumed_at + 24 h` (stored by the first syncs after the resume) becomes `skipped` with `skip_reason = 'suspended_backlog'` and the audit row `email.skipped` / `reason_code = suspended_backlog` (no LLM call). The `too_old` rule wins when both match. The backfill re-queues only `too_old` mail with a body, so backlog mail stays skipped.
  - Sync-late notice (`detectSync`): the grace also holds while `now − resumed_at ≤ SYNC_LATE_MS` (30 min).
  - Urgent notice (`detectUrgent`): `sinceOf(member) = max(linkedAt, now − 24 h, resumed_at ?? 0)`.
    The digest counts `email.skipped` by `reason_code`: the line "📭 Not processed (older than 7 days): N" counts only `too_old`; a new line "📭 Not processed (from the account pause): N" counts `suspended_backlog`. Why: D4, S3.
- **A17 What resume does not touch.** Stale `ready` actions of the pause expire at the first committer run (the existing 24 h `CLAIM_MAX_AGE_MS` rule). Sends: the 48 h rule (difference 3). Approval requests of drafts made before the pause can go out at resume; the 7-day `not_notified` rule ends the older ones. An approval request that was queued before the pause and waits more than 24 h is ended by the sender's 24 h rule, and the send times out unseen (follow-up `approvals-at-resume`, stage 17.2). The digest after a long pause covers the time since the last digest, as after a downtime. Why: existing rules already bound these; no new state.

**Mailbox limit (D6)**

- **A18 Connect.** In `connectMailbox` (web and CLI): (1) the duplicate check (as today); (2) a pre-check without a lock: count ≥ `max_mailboxes` → `MailboxLimitError` before any login; (3) the IMAP and SMTP logins, outside any transaction; (4) one transaction: `SELECT pg_advisory_xact_lock(hashtextextended('mailbox_limit:' || <org id>, 0))`, read `max_mailboxes` (`getOrgPlan`), count the mailboxes of the organization, `count >= max` → `MailboxLimitError` (rollback), else the inserts of today. Web: `409 { error: "mailbox_limit" }`; text `err_mailbox_limit` "Your plan allows no more mailboxes. Remove one, or contact us to raise the limit."; CLI `mailbox:connect`: `mailbox limit reached (max <n>)`, exit 1. Why: D6; not `FOR UPDATE` on `organizations` (it blocks the foreign-key inserts).

**Operator notices (D29, D31)**

- **A19 Direct send, not the outbox.** Difference 5. `channels/operator.ts`: `createOperatorNotices({ db, now, send })`; `send` is `(text: string) => Promise<void>` (the Telegram runtime's direct send to `OPERATOR_TELEGRAM_CHAT_ID`) or `null` (then a `warn` line `operator notice <kind>: <text>`). Dedup: an audit row `operator.notice` with `data = { kind, key }` in the organization of the event, written **after** a successful send (at least once: a crash between the send and the row repeats one notice; a failed send writes nothing and the next run tries again). New audit function `hasAuditKey(db, ctx, event, key)` (`data->>'key'`). A failed send logs `operator notice <kind> failed: <telegramErrorLabel>` once per key per process. Why: D31; the operator must not miss an event, a duplicate is cheap.
- **A20 Events and keys (S6a).** Texts hold ids, dates and counts only:
  - `trial_ending`: organizations with `plan = 'trial'` and `trial_ends_at ≤ now + 3 days` (also already past). Key `trial_ending:<org id>:<trial_ends_at ms>`. Text "Trial of org <id> ends <ISO UTC date>." (or "ended" when past).
  - `llm_cap`: the triage job's cap outcome (the place of the existing `warnedCap` line) calls the injected hook `onCapReached(ctx, mailboxId, dayStart)`. Key `llm_cap:<mailbox id>:<dayStart ISO>`. Text "Mailbox <id> of org <id> reached the daily LLM cap (<n> calls) on <day>."
  - `auth_error_24h`: mailboxes with `status = 'auth_error'` and `status_changed_at ≤ now − 24 h`. Key `auth_error_24h:<mailbox id>:<status_changed_at ms>`. Text "Mailbox <id> of org <id> has been in auth_error since <ISO>."
    The cap hook never blocks the triage loop: it starts the work and returns; a failed cap notice waits for the next hourly run (stage 11, cold review finding 3).
    The job `channels.operator` runs hourly at minute 13 and checks `trial_ending` and `auth_error_24h` for organizations that are not `suspended`. Quiet hours do not apply (operator). Why: D31.
- **A21 Config.** `OPERATOR_TELEGRAM_CHAT_ID` optional, `^-?\d{1,15}$`; set without `TELEGRAM_BOT_TOKEN` → config error. `OPERATOR_CONTACT` optional, an address (`addressPattern`); with `WEB_BASE_URL` set and no `OPERATOR_CONTACT`, the start logs `warn` "OPERATOR_CONTACT is empty: the paused banner names no contact". Neither value goes into the repo (D29). Why: D29, D31.

**Retention (D5)**

- **A22 Shape.** Each owner module exports one tenant-scoped clear function per table (the repo rule: one module owns its table). A composition file `apps/server/src/retention.ts` (beside `web.ts`, `composition.ts`) builds the job `platform.retention`: for each organization of `listOrganizations`, all plans, it calls the clear functions with that organization's limits and logs one line `retention org <id>: <column>=<count> …` (counts only). Daily at 02:40 server time (`0 40 2 * * *`; the backup runs at 03:30). `job:run --name platform.retention` runs it once. Why: D5; `platform` imports no module.
- **A23 Periods and columns** (`docs/architecture.md` §7; `now` is the run time; "older than" = strictly before the limit; each update in batches of 1 000 rows by id, `FOR UPDATE SKIP LOCKED`, until a batch is empty; no filter on the mailbox status or the plan):
  | Owner | Column | Cleared to | Rows | Limit |
  | --- | --- | --- | --- | --- |
  | `mail` | `emails.body_text` | `NULL` | not null; status not `processing`; a `pending` mail only when `created_at < now − 7 d` | `created_at < now − data_retention_days` |
  | `mail` | `emails.subject`, `from_address`, `to_addresses`, `cc_addresses`, `in_reply_to`, `references_header` | `NULL`, `NULL`, `'{}'`, `'{}'`, `NULL`, `NULL` | any of them not cleared | `created_at < now − 90 d` |
  | `triage` | `triage_results.reason`, `fields` | `NULL`, `'{}'` | not cleared | `created_at < now − 90 d` |
  | `actions` | `actions.payload` | `'{}'` | types `save_summary`, `create_draft`, `send` in status `applied`, `expired`, `failed`, `rejected`, `undone`, `logged`, and `ready` `save_summary`; payload not `'{}'` | `created_at < now − 90 d` |
  | `actions` | `actions.last_error` | `NULL` | not null | `updated_at < now − 90 d` |
  | `delegation` | `delegations.task_summary` | `'[removed]'` | not `'[removed]'` | `updated_at < now − 90 d` (covers "90 d after `done`" and "90 d after the last change") |
  | `channels` | `outbox.text` | `'[removed]'` | `sent` or `failed`, text not `'[removed]'`; `pending` or `sending` rows also become `failed` / `expired` | `created_at < now − 90 d` |
  | `channels` | `chat_link_tokens` rows | deleted | `used_at < now − 1 d` or `expires_at < now − 1 d` | — |
  `audit_log` and `triage_feedback` are not touched. The technical ids `message_id_header`, `dedup_key`, `thread_key` and `content_hash` stay: the sync dedups and locates mail by them; the S6e papers must name them (question to the user, cold review #20). A repeat run changes nothing (each `WHERE` excludes cleared rows). Why: D5; no text may stay longer because a mailbox is paused, an organization is suspended or triage is off (cold review #2); `processing` keeps its body for the running triage; `requeueTooOld` skips mail without a body (stage 12).
- **A24 Readers of cleared data.** The draft of a mail whose body is cleared quotes nothing (test in stage 14: `drafts.ts` with `body_text = null` builds a draft; `quoteOriginal` writes "> (no text)"; if the code throws, stage 14 fixes it). "Send again" on a failed send whose payload is `'{}'` answers `draft_gone` (stage 14 test; `sendAgain` gets a `sendPayloadSchema` check). The Activity page window is 90 days, so it never shows cleared rows (S5d note). Why: no crash on old rows.
- **A25 Indexes.** Migration `20261112100002_retention_indexes.sql`: the two S2 checkpoint indexes (`outbox_email_idx`, `outbox_digest_idx`, `retention-job.md`) and `emails_org_created_idx ON emails (org_id, created_at)`. Why: the cascade deletes and the daily scans.

**Panel (D3, D4, D29, S1)**

- **A26 `/api/me`.** `organization` gets `plan`, `trialEndsAt` (ISO or null), `maxMailboxes`; the root gets `operatorContact: string | null`. The schema `meSchema` changes in `packages/core/src/web/me.ts`.
- **A27 Trial line.** Owners in `trial` see "Trial ends on <date>" in the shell, the date in the organization's time zone (`Intl.DateTimeFormat` with `timeZone`, day-month-year). An assistant does not see it.
- **A28 Paused banner and read-only mirror.** In `suspended`, every member sees the banner "This account is paused. Contact <OPERATOR_CONTACT> to resume it." (or "Contact the operator …" without the key). A helper `canWrite(me)` (`apps/web/src/lib/can-write.ts`) = not `suspended`; the islands use `isOwner && canWrite(me)` where they use `isOwner` today, and `canWrite(me)` for the member writes (feedback, Undo, digest times, Telegram link). The error code `org_suspended` maps to the banner text. Why: D4 (the UI is a mirror; the server decides).
- **A29 Consent line** (S1) above the connect button in `ConnectDialog.tsx`.
- **A30 e2e seed.** `e2e-seed.ts` makes two more organizations: `E2E Trial` (owner `e2e-trial-owner@x.test`, `trial`, ends in 10 days) and `E2E Paused` (owner `e2e-paused-owner@x.test`, `suspended`, with one seeded mailbox row so the read-only mirror has controls to check), with the existing test password constant. The existing `E2E` organization is `active`.

### Rules for every step

The master plan's "Rules for every step" apply (copied here, then the S6a additions).

- Read `CLAUDE.md`, `docs/code-patterns.md`, this file and the stage file first.
- Format only the files of the step (`bunx prettier --write <files>`), never the whole repo (S2 incident).
- No secret, token, password, reset link, mailbox address of a customer, or mail text in a log line, an error text, an audit row or a test snapshot. Logs and audit rows hold ids, codes, counts and times; errors go through `describeError`; Telegram errors through `telegramErrorLabel`.
- The repo is public: never write the tailnet name, the production IP, a customer name or address, or the operator's private data into a file. Docs write `<domain>`, `<machine>.<tailnet>.ts.net`.
- Template literals for strings with variables; `const` / `let` only.
- Every new table or column with `org_id` gets a tenant-filter test and is covered by the D13 deletion test (S6c). S6a adds columns to `organizations` only.
- Only one checkout runs `test:int`, `db:migrate` or a dev server at a time; only one task at a time adds a migration or changes `bun.lock`. The other session works in the main checkout: stage by explicit path, never `git add -A`.
- `git fetch && git merge origin/master` in the segment branch at the start and before the merge.
- Docker on this PC: `newgrp docker <<'EOF' … EOF`; `docker compose run -T` with a heredoc. Git push: `export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes"`.
- The two known timing tests fail in CI (`docs/known-alerts.md`); every other failure is a stop.
- Checks per stage: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`; web stages also `bun run web:build` and the Playwright specs of the stage (`bun run test:e2e -- <spec>`).

S6a additions:

- **Database of the build:** the worktree's own database (`bun run db:worktree s6a`; use the two printed env lines in the worktree `.env`; drop it with `--drop` at the end). Why: the migrations of stages 4 and 12 must not reach the shared dev database before the merge (the other session runs `master` code there).
- **E2E database of the build:** the Playwright setup migrates and wipes `E2E_DATABASE_URL` (`apps/web/e2e/env.ts:49-60`); a copied `.env` points to the shared `email_assistant_e2e`. Run `bun run db:worktree s6a_e2e | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' | sed 's/^/E2E_/'` and put the two lines into the worktree `.env` (the name ends in `_e2e`, so the seed accepts it). Stage 18.5 drops it.
- **Dev `.env` after the merge:** under `all`, the dev server now acts on every active mailbox of the dev database. Before a dev server runs with a scope `all`, run `org:status` and pause the extra mailboxes (the same rule as D2 for the VPS).
- A new no-`TenantContext` entry point (`listOrganizations`, `listAuthErrorMailboxesBefore`) goes into the `docs/code-patterns.md` list in the stage that adds it.
- A test with a time uses a fixed `now` passed into the job or service (`deps.now`), never `Date.now()` in the assertion.
- Tests that suspend an organization run inside `withRollback`, except the concurrency tests (F8 pattern: commit, then delete the organization in `finally`).
- A stage that changes a type used by tests fixes those tests in the same stage, so all checks pass at each commit (pipeline mode).

### User steps

| #      | Step                                                                                                                                                                                                   | Needed by                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| U9     | Optional (master plan): `OPERATOR_CONTACT` (any address of the user) and `OPERATOR_TELEGRAM_CHAT_ID` into the VPS `.env` (agent never reads them). Without them: "contact the operator" and log lines. | stage 18 (deploy)           |
| S6a-U1 | Give the go for the VPS read of the mailbox list, then pause or remove each mailbox that is not the pilot mailbox (D2).                                                                                | stage 18, before the deploy |
| S6a-U2 | Give the go for the deploy to the home VPS.                                                                                                                                                            | stage 18                    |

### User checkpoint

Checkpoint 1 of the master plan, at stage 18: the group review of stages 1–17 (stronger reviewer, Opus high), the merge into `master`, the D2 mailbox list on the VPS, the deploy with the user's go, and one day of the pilot on the new code.

### Review model

Every stage: the stronger reviewer (Opus, high) — the S6a gates are security, tenant isolation, sending to people and migrations. The group review at stage 18: Opus, high.

### Stages

One box per stage; the file holds the steps. `[risky]` = one step per stage.

- [ ] Stage 1 — Scope types without the address: `scope.ts`, triage scope, config, all call sites, tests follow `[risky]` — [`stage-01-scope-core.md`](s6a-customer-core/stage-01-scope-core.md) [written]
- [ ] Stage 2 — Two-organization gate tests `[risky]` — [`stage-02-scope-gate-tests.md`](s6a-customer-core/stage-02-scope-gate-tests.md) [written]
- [ ] Stage 3 — Badges, `/api/me` scope reasons, web texts, Telegram `/status` texts — [`stage-03-scope-badges.md`](s6a-customer-core/stage-03-scope-badges.md) [written]
- [ ] Stage 4 — Migration `org_plan`, `db:types`, tenancy read and `setOrgPlan` `[risky]` — [`stage-04-migration-org-plan.md`](s6a-customer-core/stage-04-migration-org-plan.md) [written]
- [ ] Stage 5 — CLIs `org:plan`, `org:create --plan`, `org:status`, the suspend hook — [`stage-05-org-clis.md`](s6a-customer-core/stage-05-org-clis.md) [written]
- [ ] Stage 6 — `suspended` gate in the jobs, the per-mailbox re-check, the start count line `[risky]` — [`stage-06-suspended-jobs.md`](s6a-customer-core/stage-06-suspended-jobs.md) [written]
- [ ] Stage 7 — `suspended` in Telegram, and `OPERATOR_CONTACT` `[risky]` — [`stage-07-suspended-telegram.md`](s6a-customer-core/stage-07-suspended-telegram.md) [written]
- [ ] Stage 8 — `suspended` in the web: every write route answers `403 org_suspended` `[risky]` — [`stage-08-suspended-web.md`](s6a-customer-core/stage-08-suspended-web.md) [written]
- [ ] Stage 9 — Resume: backlog rule, sync-late grace, urgent look-back, digest count `[risky]` — [`stage-09-resume.md`](s6a-customer-core/stage-09-resume.md) [written]
- [ ] Stage 10 — Mailbox limit with the advisory lock `[risky]` — [`stage-10-mailbox-limit.md`](s6a-customer-core/stage-10-mailbox-limit.md) [written]
- [ ] Stage 11 — Operator notices frame and the three events — [`stage-11-operator-notices.md`](s6a-customer-core/stage-11-operator-notices.md) [written]
- [ ] Stage 12 — Retention: index migration, the `mail` and `triage` clear functions, the backfill guard `[risky]` — [`stage-12-retention-clear-mail.md`](s6a-customer-core/stage-12-retention-clear-mail.md) [written]
- [ ] Stage 13 — Retention: the `actions`, `delegation` and `channels` clear functions `[risky]` — [`stage-13-retention-clear-rest.md`](s6a-customer-core/stage-13-retention-clear-rest.md) [written]
- [ ] Stage 14 — Retention job `platform.retention`, `job:run`, the readers of cleared data `[risky]` — [`stage-14-retention-job.md`](s6a-customer-core/stage-14-retention-job.md) [written]
- [ ] Stage 15 — Panel server side: `/api/me` plan fields, e2e seed — [`stage-15-panel-server.md`](s6a-customer-core/stage-15-panel-server.md) [written]
- [ ] Stage 16 — Panel web: trial line, paused banner, read-only mirror, consent line, error texts, Playwright — [`stage-16-panel-web.md`](s6a-customer-core/stage-16-panel-web.md) [written]
- [ ] Stage 17 — Docs, notes, follow-ups (Limen tickets) — [`stage-17-docs.md`](s6a-customer-core/stage-17-docs.md) [written]
- [ ] Stage 18 — Group review, merge, D2 mailbox list, deploy, close (checkpoint 1) — [`stage-18-checkpoint-deploy.md`](s6a-customer-core/stage-18-checkpoint-deploy.md) [written]

Order and dependencies: 1 → 2 → 3; 4 → 5 → 6 → 7 → 8 → 9; 10 needs 4; 11 needs 4, 6 (the mail query join) and 7 (config); 12 → 13 → 14 need 4; 15 needs 4 and 7; 16 needs 15, 8 (`org_suspended`) and 10 (`mailbox_limit`); 17 after 16; 18 last. Build them in number order.

### Cold review result (2026-11-12, `reviewer` subagent, Opus, high; VERDICT FAIL; blocker 0, major 5, minor 13, question 3; all fixed)

Pre-mortem: the reviewer found no path where a suspended organization's mail goes out or a `shadow` mailbox changes. Its pre-mortem hits: text kept longer than §7 (#2), triage stalled by a Telegram outage (#3), a lost approval request (#7), LLM calls after a suspend (#8).

1. Stage 1 cannot pass at its commit: `views.test.ts` builds the old scope → stage 1 removes its `all` entries, stage 3 restores them.
2. Retention kept the body, `ready` summaries and `pending` outbox text for paused mailboxes, suspended organizations and triage `off` → A23, stages 12 and 13; `requeueTooOld` skips mail without a body.
3. The cap hook was awaited inside the triage loop and the bot has no request timeout → not awaited, in-flight set, hourly retry, `sendDirect` with a 10 s abort (A20, stage 11).
4. The Limen migration moved `retention-job.md` and `actions-scope-removal.md` to `spec/features/planned/F027-*`, `F031-*` → Scope line, difference 1, stages 12, 17, 18; follow-ups are Limen tickets.
5. The paused e2e organization had no mailbox, so the mirror test checked nothing → stage 15.2 seeds one; stage 16.2 checks its controls.
6. Stage 4 test 11 cannot roll back inside `withRollback` → committed organization.
7. The suspend hook cancelled approval requests that the notifier never queues again → the hook keeps `approval` and `approval_set` (A12, stage 5).
8. "Finishes its target list" widened D4 → per-mailbox `isOrgSuspended` re-check in sync, triage, committer (A13, stage 6).
9. Stages 7 and 11 were too large → split into 7 + 8 and 12 + 13.
10. Job tests over the whole DB can see other data → assert only on the test's own ids (stages 11, 14).
11. Stage 9 test 4: the old grace on `status_changed_at` could hide the new one → explicit columns.
12. Wrong names and lines (core `tenancy.ts`, `listMailboxViews`/`viewOf`, the `setCategoryAuto` gate, `apiErrorCodes`, `DbOrTrx` in tenancy, `lockMailboxLimit` type, `operatorContact` builders, `let telegram` order) → fixed in stages 2, 3, 4, 7, 10, 11.
13. Code-patterns rules came late → written in stages 6 and 8.
14. "Done when" bullet 2 disagreed with §4.3 → reworded (mailbox-changing types).
15. The `mail → tenancy` edge was missing from the docs → stage 17.1.
16. Playwright would migrate the shared e2e DB → an own `s6a_e2e` DB (rules, stage 18.5).
17. New CLIs would copy `error.message` logging → `describeError` (stage 5).
18. An `auth_error` mailbox on the VPS would become reachable after a password fix → stage 18.3 requires paused or removed.
19. Question: A6 changes D3's column default (`trial` → `active`) → for the user at the OK.
20. Question: retention keeps technical ids → `in_reply_to` and `references_header` are cleared after 90 d; `message_id_header`, `dedup_key`, `thread_key`, `content_hash` stay and the S6e papers name them → for the user at the OK.
21. Question: the backlog rule never ended → also `created_at < resumed_at + 24 h` (A16, stage 9).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded (ADR 0020 is written in S6e; this segment writes its notes).
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are Limen tickets in `spec/features/planned/` (stage 17.2).

## Log

- 2026-11-12: Created by the S6 master plan session (`tasks/active/s6-pre-sale.md`).
- 2026-11-12: S6a plan session (`plan-task`): moved to `active/`; collect done (differences 1–8); the user answered "proceed" (defaults S1–S4); decisions A1–A30.
- 2026-11-12: Stage files written (16). Cold review (reviewer, Opus high): FAIL, blocker 0, major 5, minor 13, question 3; all fixed (18 stages after two splits; "Cold review result"). The other session merged the Limen migration into `master` during this session (`67cca12`); the plan follows it (difference 1).
- 2026-11-12: The user cut the S6 scope (local production, no customers; master plan P16–P24) and answered "ok". S6a stays whole (P17); U0 dropped, U9 optional. The two open questions (A6 default `active`, the kept identifier columns) took the defaults.
