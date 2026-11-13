# Architecture review before the Stage 2 build

> Written 2026-11-13 by Fable 5.1 at commit `8e446d8`, before the first Stage 2 planning session. Method: read `docs/`, `spec/`, the ADRs 0001–0033, the epic pages E01–E12, the code of `apps/server`, `packages/core`, `apps/web`, the migrations, the CI config; ran `bun run lint`, `bun run typecheck`, `bun run test:unit` and `madge --circular`; read the last 40 CI runs. No code was changed. Owner decisions are listed in §8.

## 0. Verdict

The architecture is sound and fits Stage 2. The modular monolith, the database as the work queue, the pure core, the ports in the owning module, the typed repositories with a tenant context and the explicit state tables are the right shape for one developer and many agent lanes. Reliability is the strongest part: idempotent actions, claims with `FOR UPDATE SKIP LOCKED`, crash recovery per status, at-most-once send, and 1,835 unit tests plus 115 integration test files that pass locally.

Three things need work before the Stage 2 build starts, and a handful of seams that the epic plans assume do not exist yet:

1. **CI is red.** None of the last 40 runs on `master` passed (36 failures, 4 running). The known flaky timing tests are scheduled for S6f, late in E7. With about 250 stages landing in parallel lanes, a red CI gives no regression signal. Fix first.
2. **Module borders are convention only, and the convention is already broken.** `actions/repo.ts:14` imports `../delegation/repo` (a deep import that recreates the `actions → delegation` edge the hooks pattern was built to prevent), and `config/service.ts:19` closes the cycle `actions → mail → config → actions`. ESLint checks only SDK imports. Add a boundary lint before ten agents add six modules.
3. **Five cross-cutting seams are assumed by many epics and owned by none in wave 1:** notices stored as facts and rendered per channel and locale (E4, E7, E9), feature flags (every epic), LLM roles beyond `classify` (E2, E3, E5, E6), mail auth material beyond a password (E9), and the structured logger (E8, but every epic adds log lines). Build them first as one small "foundation" group.

Everything else is incremental: split two repository files, generalize a few registries, move behaviour text out of `docs/architecture.md`, and adopt the standards in §7.

## 1. Numbers

| Measure | Value |
| --- | --- |
| Source lines (server, core, web; no tests, no generated schema) | about 42,000 |
| Test lines | about 61,300 in 257 files |
| Unit tests | 1,835 pass in 29 s (`bun run test:unit`, 2026-11-13) |
| Integration test files | 115 (`apps/server/test/integration/`), each in a rolled-back transaction |
| Lint, typecheck | clean |
| Server modules | 10 (`tenancy`, `mail`, `triage`, `actions`, `delegation`, `reports`, `channels`, `config`, `audit`, `testmail`) |
| Repository functions | 208 exported, 49 in `actions/repo.ts` (1,776 lines), 55 in `mail/repo.ts` (1,251 lines) |
| HTTP routes | 27 under `/api` plus auth |
| CLI entry points | 43 scripts, 58 root `package.json` scripts |
| Env keys | 45 in one Zod schema |
| Stage or decision codes in code comments (`S3`, `D29`, `U11`, `A23`, `F079`) | 321 in non-test code |
| `eslint-disable` | 15; `as unknown as` 19; `as any` 12; TODO 0 |
| Commits | 697, 690 of them since 2026-11-01 |
| CI on `master` | 0 of the last 40 runs green |

## 2. What is right and must stay

- **One process, modules with one `index.ts`, platform under the modules, pure core.** `docs/code-patterns.md` states it, the code follows it (one deep import, §3.2). Factory functions and interfaces, no class hierarchies, no central factory. This is easy to read and easy for agents to extend.
- **The database holds the state; small workers move it.** Each hop between modules is a status change, claimed with `SKIP LOCKED`, guarded by `WHERE status = …` and Postgres CHECKs. `actions/transitions.ts` keeps the edge map as data and a test compares it with the guards. This is the reason crash recovery works and the reason the design scales to a second process without a message broker (ADR 0002).
- **Ports in the owning module, adapters as folders, fakes that pass the same contract suite** (`test/contract/mail-provider.ts`). This is exactly the seam E9 needs.
- **Side effects in one place.** Only `actions.committer` changes a mailbox or sends. Planners and the policy are pure functions with tests. The approval binds to stored bytes (`buildOutgoingMessage` and `composeMessage` share them).
- **Untrusted text handling.** Schema enums for the LLM output, a marked data block, `markUntrustedText`, recipients only from rows. ADR 0033 extends this to free text with code checks: the right direction.
- **Tenancy and secrets.** `TenantContext` on every repository function with a listed exception set, two DB roles, `SECURITY DEFINER` delete, AES-GCM with AAD per mailbox, no secrets in logs by rule.
- **Hooks to break cycles** (`DelegationHooks`), composition roots (`main.ts`, `composition.ts`, `web.ts`), dependencies injected into routes. Good; keep this as the only way to cross a border in the "wrong" direction.
- **Web:** one island per page, typed fetch with Zod response schemas, every string a key, CSP without `unsafe-inline` scripts, `useResource` and `useDraft` for polling under edits.
- **Documentation and decision trail.** ADRs with status and amendments, a product decision log with the owner's words, discovery notes with sources. Few repositories of this size have this.

## 3. Findings

Each finding has evidence, why it matters for Stage 2, a recommendation and a size in Limen stages (one stage is one worker run of a few files).

### 3.1 CI has been red for the whole build

- **Evidence:** `gh run list --limit 40`: 36 failures, 0 successes. The latest failure is `bun run test:unit` with `[scheduler] throws failed: Error` lines (a timing test). `tasks/planned/s6f-hosted-production.md` names two known timing tests (`runSend > 3`, `AgentMail fake > holdResponseNext`) and `docs/known-alerts.md:306` records a third that failed in 4 of 6 runs.
- **Why it matters:** the Limen workers run the checks locally, so landed work was tested. But a red `master` hides every new regression, and the Stage 2 plan relies on CI for the eval gate (PD-025), the migration check (PD-053), the docs site (E10) and the security scans (E8).
- **Recommendation:** a one-ticket fix now, in E1, not in S6f: fake timers or an injected clock in the three tests; then a rule: a test that fails twice in CI without a code change is quarantined with `test.skip` and a ticket the same day, so `master` is green again within a day. Record the CI run time in `spec/build.md` TRACK.
- **Size:** 2 stages.

### 3.2 Module borders are not enforced, and two are broken

- **Evidence:** `apps/server/src/modules/actions/repo.ts:14` imports `openDelegationFilter` from `../delegation/repo`: a deep import and the `actions → delegation` edge that `actions/hooks.ts` exists to avoid. `apps/server/src/modules/config/service.ts:19` imports the type `ExpireFilter` from `../actions`, which closes `actions → mail → config → actions` (madge cycle 3 of 10). `docs/modules.md` §2 shows neither edge. ESLint restricts only `grammy`, `openai` and `@google/genai`.
- **Why it matters:** Stage 2 adds `operator`, `flags`, `loops` (E5), the drafter (E6), `ops` (E8), `push` (E9), `contacts` (E11), and ten agent lanes write in parallel. Without a mechanical check the graph decays in weeks, and the "hooks for reverse edges" rule stops being true.
- **Recommendation:** add `eslint-plugin-boundaries` (or `import/no-restricted-paths` plus `import/no-cycle`) with an explicit layer list and an allowed-edge list. Proposed layers, lowest first: `platform` → `audit`, `tenancy` → `config`, `mail` → `triage`, `actions`, `delegation` → `reports`, `channels` → composition roots (`main.ts`, `web.ts`, `composition.ts`, `scripts/`). A module imports only `index.ts` of a lower layer. Fix the two violations: `delegation` exports the "open delegation" predicate from its index (or `actions/repo` takes it as a parameter from the composition root), and `ExpireFilter` moves to `packages/core` (it is a plain shape). Generate `docs/diagrams/module-graph.md` from the lint config in CI so `docs/modules.md` §2 cannot drift.
- **Size:** 3 stages.

### 3.3 Two repository files and one detector file are becoming god files

- **Evidence:** `actions/repo.ts` 1,776 lines, 49 functions (claims, sends, drafts, notify queries, expiry, retention, undo). `mail/repo.ts` 1,251 lines, 55 functions. `channels/notices.ts` 745 lines with nine `detect*` functions in one `detectForOrg`. `transitions.ts` 632 lines.
- **Why it matters:** E3a (reject reasons, stats), E4-A (versions, delegates routes), E5b (loops), E6a (reply kind, hash check), E7 (send limits in the claim) all land in `actions/repo.ts`; E3a (header capture, flags), E5a (Sent cursor) in `mail/repo.ts`. Merge conflicts and reviewer blind spots grow with file size, and agents read whole files.
- **Recommendation:** split by aggregate behind the same module index: `actions/repo/{claims,sends,drafts,notify,expiry,retention,undo}.ts` and `mail/repo/{mailboxes,folders,credentials,emails,claims,retention}.ts`. Turn `notices.ts` into a detector registry: `channels/notices/<kind>.ts` exports `{ kind, detect(db, ctx, members, now) }`; `detectForOrg` iterates the list; a test checks that every `outbox.kind` has a detector and a renderer. Rule for the styleguide: a source file stays under about 400 lines and one aggregate; a module that needs more gets a subfolder with its own barrel.
- **Size:** 3 stages, mechanical, no behaviour change; do it before E4-A and E5b touch these files.

### 3.4 Notices are rendered into Telegram text at queue time

- **Evidence:** `outbox` holds `kind`, `text`, `buttons` (`db/migrations/20261106000001_telegram.sql`); `channels/notices.ts` calls the core renderers when it queues. ADR 0032 (E9) decides "a notice is stored as facts and rendered for its channel and detail level when it is sent". PD-033 (E4) adds a mail channel for the digest and the report; PD-037 (E7) makes Telegram texts follow `users.locale`; ADR 0024 (E8) adds SLO alerts through the same path.
- **Why it matters:** four epics change the same renderer. If E9b owns the refactor, E4-B and E7 build on the old shape first and E9b rewrites them.
- **Recommendation:** one wave-1 foundation ticket: `outbox.payload jsonb` (facts: ids, counts, kind-specific fields), `channel` (`telegram` now; `mail`, `push` later), `locale`; a renderer registry keyed by `(kind, channel, detail)` in `packages/core`; `text` and `buttons` stay as the rendered cache written by the sender. Approval cards keep the "render from the stored bytes" rule. Then E4-B adds the mail channel, E7 adds `pl`, E9b adds `push` and `minimal`, each as one renderer file.
- **Size:** 5 stages. Depends on nothing; E4-B, E7-T1 and E9b depend on it.

### 3.5 Feature flags and the operator role must exist before the first Stage 2 feature

- **Evidence:** ADR 0027 and PD-045: "every new user-visible Stage 2 behaviour ships behind a flag, default off". No `isFeatureOn` exists. E3a, E4-A, E5a and E6a are all planned to ship flags.
- **Recommendation:** the smallest ticket first: the registry in `packages/core`, the table `org_features`, `FEATURES_OFF`, `isFeatureOn(ctx, flag)` in `tenancy` (it owns the organization), a CLI `org:flag`, and the `OPERATOR_USER_IDS` check in `platform/http.ts`. The console page comes later in E7.
- **Size:** 2 stages. Blocks every feature epic.

### 3.6 The LLM layer knows one role

- **Evidence:** `platform/llm/client.ts` exposes `classify<T>` with one `classifierModel`; the config has `*_MODEL_CLASSIFIER`; the daily cap counts `llm.call` rows per mailbox; the prompt version is one constant (`PROMPT_VERSION` from `classifier-v2.ts`).
- **Why it matters:** E2a needs a judge from another model family, E6 a drafter (`gpt-6-luna`, free text, different timeout and cap share), E5b an extractor (promises, "expects a reply"), E3b an escalation model, E11 a sanitizer or local model. M7 needs cost per role.
- **Recommendation:** generalize to `generate<T>({ role, schema, system, prompt })` with a role table in config (`role → provider, model, timeoutMs, rpm, reasoning`), usage and audit rows that carry `role` and `prompt_version`, and a per-role share of the day cap (PD: drafts stop at 80 %). Keep the SDK-import lint. Make the prompt registry explicit: `prompts/<role>-v<n>.ts` with a test that every role records its version in `triage_results.prompt_version` or `audit_log.data`.
- **Size:** 3 stages. Before E2a's judge and E6a.

### 3.7 Mail access: good port, but the secret and the transport are bound to a password

- **Evidence:** `ImapConnectOptions.password` (`mail/imap/client.ts:57`), `openMailboxProvider` decrypts and passes the password (`mail/open.ts`), `mailbox_credentials.secret_kind IN ('password','app_password')`, `mailboxes.protocol IN ('imap')`, one `openSmtpSender`. ADR 0031 keeps IMAP for reads and adds Graph for Microsoft sends.
- **Recommendation (small, before E9a):** an `AuthMaterial` union (`{ kind: "password", password } | { kind: "oauth", accessToken }`) in the adapter options; a `resolveCredentials` step in `mail/open.ts` that turns the stored secret into auth material (the OAuth refresh with its per-mailbox lock lives there); a sender choice from a mailbox column `send_via` (`smtp` | `graph`). Add a `MailSender` contract suite next to the `MailProvider` one, run against the fake, the SMTP sender on GreenMail, and later the Graph fake. State in `port.ts` that `MailProvider` has IMAP semantics (UIDs, flags, APPEND) by design; a backend without them gets an adapter that maps opaque ids, or a port v2 with its own ADR.
- **Size:** 3 stages, or the first stages of E9a.

### 3.8 Adding an action type or draft kind touches seven places

- **Evidence:** `core/triage/planners.ts` (`actionTypes`), `core/triage/payloads.ts` (discriminated union), `core/outgoing/templates.ts`, `actions/apply.ts` (an if-chain at lines 389–410), `actions/transitions.ts`, the `actions.type` CHECK, `channels/notices.ts`, `core/digest/approvals.ts`, `web/lib/activity-text.ts`.
- **Why it matters:** E5b adds `follow_up`, E6a adds `reply` (with versions and `cc`), ADR 0022 adds report mail by APPEND, E4-B adds unsubscribe.
- **Recommendation:** a table-driven dispatch in `apply.ts` (`Record<ActionType, Handler>`), a completeness test (every `actionTypes` member has a handler, a transitions entry, a CHECK member, a renderer), and a written checklist "add an action type" in `docs/code-patterns.md`. Model the E4-A approval edit as a new draft row that supersedes the old one (`supersedes_action_id`), the same pattern as "Send again", not as a payload mutation; then versions, Drafts replacement and the new tap fall out of existing rules.
- **Size:** 2 stages plus the checklist.

### 3.9 Cross-tenant code grows; isolation is a convention

- **Evidence:** `TenantContext` filters in code; `docs/code-patterns.md` lists 15 exceptions; there is no row-level security (ADR 0027 says so). Stage 2 adds the operator console (reads across organizations), SLO checks, DSR erase, flags, retention of new tables, and about 15 new commands.
- **Recommendation:** Postgres RLS as a safety net, not as the filter: policies on every table with `org_id` that compare to `current_setting('app.org_id', true)`; `requireTenant` opens the request transaction with `SET LOCAL app.org_id`; jobs and the operator module run as today with a policy that admits a null setting only for the `jobs` path, or a second role. Existing repository code does not change. This turns "a missed `org_id` filter in one of 250 stages" from a data leak into a 0-row result, and it is a sentence an auditor understands (E10 security page). The `information_schema` test of E7 (every table with `org_id` joins delete, DSR and now RLS) is the guard that keeps it complete.
- **Size:** 4 stages. Optional; my recommendation is yes, in wave 1.

### 3.10 Locale is not a platform concern yet

- **Evidence:** `apps/web/src/i18n/en.ts` (391 keys), `core/outgoing/templates.ts` with `pl | en` branches, digest and Telegram texts in English in `core/digest`, auth mails pl and en in `platform/auth-mail-texts.ts`, `users.locale` exists. PD-037 plans `pl.ts` and Telegram texts by locale as the first E7 ticket.
- **Recommendation:** agree with "first E7 ticket", and merge it with §3.4: one `Locale` type in core, a texts registry per surface (`core/texts/<surface>/{en,pl}.ts`) with a key-parity test, and the outbox renderer takes the locale from the row. The web keeps `en.ts`/`pl.ts` with the same parity test.
- **Size:** inside the §3.4 ticket plus E7-T1.

### 3.11 The structured logger should land before the feature epics, not next to them

- **Evidence:** ADR 0024: 426 log calls, 24 of them print `error.message`; no `run_id` or `request_id`; `platform/log.ts` is `console.log` with a prefix. E8a is planned for wave 1 in parallel with E2, E4 and E7.
- **Why it matters:** every epic adds log lines. If the lint rule comes last, the conversion is bigger and new code is written twice.
- **Recommendation:** E8a stage 1 (the writer, the allow-list, `AsyncLocalStorage` context, the lint rule in warn mode) first in wave 1; the module-by-module conversion runs as a side lane. The log rotation ticket next to E1 stays as planned.

### 3.12 43 CLI scripts repeat the same bootstrap

- **Evidence:** 26 scripts call `assertAppRole`, 28 call `loadConfig()`, each with its own `*-args.ts` and `main().then(process.exit)`. ADR 0023 says CLIs call the same service functions as routes. E7 adds `org:delete`, `org:export`, `org:dsr`, `org:flag`, `release.sh`.
- **Recommendation:** one `scripts/cli.ts` runner: `runCli({ name, parse, main })` loads config, opens the DB, asserts the role, configures the mail hosts, maps results to exit codes, logs through `describeError`. Group commands under one entry per noun (`bun run org <sub>`), and stop adding one root script per verb. Not urgent; do it with the first E7 platform-controls ticket.
- **Size:** 2 stages.

### 3.13 Comments carry stage and decision codes that no reader can resolve

- **Evidence:** 321 occurrences of `S3`, `D29`, `U11`, `B12`, `A23`, `F079` in non-test code, for example `mail/port.ts` ("F8, F12", "U11"), `actions/hooks.ts` ("D29", "D6"), `main.ts` ("A3", "D31"). The codes point into plan files that moved to `spec/features/done/` or to `tasks/`. Stage 2 adds `PD-nnn` and `Fnnn` codes.
- **Recommendation:** a styleguide rule: a comment states the rule in one sentence; if a source is needed it names an ADR (`ADR 0014`) or a ticket folder path. No bare letter-number codes. Clean up when a file is touched; no mass edit.

### 3.14 `docs/architecture.md` is a changelog of behaviour

- **Evidence:** 803 lines; §4.1 rule 6 alone is a page of send-error tables; every landed ticket appends ("F044", "F079"). `docs/modules.md` §2 is already stale (§3.2). `docs/diagrams/code-map.md` describes S1a.
- **Why it matters:** two sources of truth (architecture text and the capability map of PD-009) will drift; agents load the architecture file into every ticket.
- **Recommendation:** the E1 capability-map ticket also moves behaviour out: §4.1 rules 6–8, §4.4, §4.5, §4.6 job details and §8 into `docs/capabilities/<capability>.md`, with one link line left behind. `architecture.md` keeps goals, context, layout, module rules, ports, invariants, data model, security, deployment. Generate the module graph (§3.2) and drop `code-map.md` or regenerate it per release.

### 3.15 Data model notes for the new tables

- `emails` already carries sync state, triage state and the location machine in five columns (`notes/2026-11-11-implicit-state-machines.md` §3 calls it the highest risk). E3a header capture should be a side table (`email_headers`, one row per mail, same retention clear function), not more columns. E5a's own `sent_mail` table (ADR 0029) is right. E11's `contacts` table needs retention, delete and the DSR map from its first migration.
- `emails.status = 'done'` is in the CHECK and the docs but never written (same note, §2). Remove it from the docs or write it; decide in E3a, which reads these statuses for M4.
- CHECK lists as enums (`outbox.kind`, `actions.type`, `secret_kind`, `protocol`) cost one migration per new member. That is acceptable under PD-053 (expand and contract); keep it, and let the completeness tests (§3.8) name the CHECK.
- Migrations are forward-only from E8 on (PD-053); until then the `-- migrate:down` blocks stay. Good.

### 3.16 Testing and parallel lanes

- Integration tests need the shared GreenMail, so only one checkout runs `test:int` (`CLAUDE.md`). With two to four Limen jobs in parallel this is the bottleneck. Recommendation: `scripts/limen-prepare.sh` starts a GreenMail per job on free ports (one Compose project per job), or the GreenMail tests get their own script (`test:int:mail`) so the rest runs in parallel. Measure and publish the `test:int` time.
- Contract suites exist for `MailProvider` and the LLM providers (snapshot). Add one for `MailSender` (§3.7) and one for `ChatChannel` before E9b adds push.
- Keep the eval out of CI (PD-025) but store the holdout report path in the release checklist.

### 3.17 Smaller items

- `apps/server/src/modules/testmail` is a test tool inside the business modules, with a twin in `packages/core/src/testmail`. Move it to `tools/testmail` (app code never imports it, as the rule says) in the E2a ticket that replaces AgentMail.
- `config` (the module: user settings) and `platform/config` (env) share a name. Rename the module to `settings` when §3.3 splits it, or leave it and never add a third `config`.
- `main.ts` builds every job by hand (286 lines). A job registry (`name, cron, run`) that `main.ts`, `scripts/job-run.ts` and the E8 `ops.slo` read gives one list of jobs and one place for the context ids of §3.11.
- `.ai/` (history), `tasks/` (S6 plan, absorbed by E7), five agent-config folders (`.claude`, `.cursor`, `.windsurfrules`, `.omp`, `.pi`): the E1 sweep removes or archives what no agent reads (F001, F070 cover part of it).
- `spec/vision.md` "Current direction" still says S6 serves the first external customer; E1 applies PD-001.
- 13 ADRs are `proposed` (0021–0033) and 0018–0020 are reserved but absent. Fine, with the rule already stated: the landing ticket sets `accepted`. Add the missing three as one-line "reserved, not used" files so the index has no holes.

## 4. Scalability, reliability, maintainability

- **Scalability.** The target is 20 mailboxes at 200 mails a day on one VPS. The single process with cron jobs and polling handles that with margin; the 2-min sync (PD-065) multiplies IMAP connections by 2.5, still small. The next step is not a broker: it is a second process that runs a subset of the job registry (§3.17) against the same tables, which ADR 0002 already allows. The LLM rate limiter is per process; two processes need a shared limiter (a Postgres advisory lock or a token row). Note it in the job registry ticket.
- **Reliability.** Strong. The one systemic weakness is operational: no run ids, no alerts beyond the dead-man, logs as free text (E8 fixes it), and the red CI (§3.1).
- **Maintainability.** The patterns are consistent and documented. The risks are size (two repo files, the architecture document), enforcement (borders), and comment codes. All three are cheap to fix now and expensive after Stage 2.
- **Generality for new providers and channels.** Mail: yes, with §3.7. LLM: yes, with §3.6. Channels: the `ChatChannel` port exists but the notice pipeline is Telegram-shaped until §3.4. Identity: Better Auth plugins, fine. Storage: Postgres only, by design.

## 5. Epic-by-epic fit

| Epic | Fit with the architecture | Seam it needs | Pre-work (this review) |
| --- | --- | --- | --- |
| E1 Close the MVP | Docs and runs | — | Add §3.1 CI fix, §3.14 doc split, §3.17 sweep |
| E2a Offline lab | `triage/eval.ts` is sequential (about 30 min for 1,500 cases); the judge needs a second model family | LLM roles (§3.6), a worker pool with a budget cap | §3.6; move `testmail` (§3.17) |
| E2b Live lab | Separate Compose project (ADR 0021): clean | Fake Telegram and GreenMail as today | §3.16 per-job GreenMail helps here too |
| E3a Measure | Metric module in `packages/core` (PD-056): right. Header capture: side table (§3.15). Stats route: a `reports` route | Flags (§3.5) | §3.5, §3.15 |
| E3b Improve | Prompt v3 experiments on the dev set: fits the prompt registry | LLM roles (escalation model) | §3.6 |
| E4-A Act from the panel | Routes plus `hono-openapi` (ADR 0023): fits the thin-route rule. Approval edit as a superseding row (§3.8) | Flags; the route-completeness test | §3.3 split of `actions/repo.ts` first, §3.8 |
| E4-B Earn trust | History check reads IMAP flags (E3a); report page; mail channel; quiet hours | Outbox as facts (§3.4), locale | §3.4 before this ticket |
| E5a Read Sent | Own table and cursor (ADR 0029): clean | Flags | — |
| E5b Open loops | Waiting, promises and delegations are three kinds of one "open loop" with one chaser. Plan a `loops` module that owns `open_loops` and the chaser; `delegation` becomes a loop kind over time. A third chaser next to the delegation chaser is the wrong shape | LLM role `extractor`, `follow_up` draft kind (§3.8) | §3.6, §3.8 |
| E6a Reply drafts | A drafter job, a `reply` draft kind, a hash check in the committer (ADR 0033): fits the committer rule | LLM role `drafter`, per-mailbox style columns | §3.6, §3.8 |
| E7 tickets | i18n frame, flags, send limits (a claim filter in `actions`), operator module (cross-tenant), DSR, delete, papers, identity | §3.4, §3.5, §3.9, §3.12 | Order: flags and i18n first (agreed with the epic notes) |
| E8a Logs | ADR 0024: fits; put the writer and the lint first (§3.11) | — | §3.11 |
| E8b Alerts, releases | `ops.slo` as a job: the job registry (§3.17) is the natural home | — | — |
| E9a Mailbox OAuth | ADR 0031 through the IMAP adapter: right call | Auth material, sender factory (§3.7) | §3.7 |
| E9b Phone channel | PWA and push: a second `ChatChannel` adapter and a renderer | §3.4 | §3.4 |
| E10 Docs site | A new workspace `apps/docs` (Astro Starlight): fits the monorepo; CI link check | — | — |
| E11 Contacts | A `contacts` table with retention, delete and DSR from day one (§3.15) | — | — |
| E12 Mobile | Needs the OpenAPI contract of E4-A only | — | — |

## 6. Proposed foundation group before the feature epics

Ordered; sizes in stages. The first five take about one week of Limen time and unblock every feature epic.

| # | Ticket | Stages | Blocks |
| --- | --- | --- | --- |
| P0 | CI green: fix the three timing tests, quarantine rule, run time in `build.md` (§3.1) | 2 | everything |
| P1 | Module boundary lint, fix the two violations, generated module graph (§3.2) | 3 | everything |
| P2 | Feature flags and the operator check (§3.5) | 2 | E3a, E4-A, E5a, E6a |
| P3 | Outbox as facts, renderer registry, detector registry, `Locale` in core (§3.4, §3.10, part of §3.3) | 5 | E4-B, E7-T1, E8b, E9b |
| P4 | Logger contract, context ids, lint in warn mode (E8a stage 1, §3.11) | 3 | the conversion lane |
| P5 | LLM roles and the prompt registry (§3.6) | 3 | E2a judge, E3b, E5b, E6a |
| P6 | Split `actions/repo.ts` and `mail/repo.ts` by aggregate; table-driven `apply.ts`; completeness test (§3.3, §3.8) | 3 | E4-A, E5b, E6a |
| P7 | RLS safety net (§3.9) | 4 | optional |
| P8 | Mail auth material, sender factory, `MailSender` contract (§3.7) | 3 | E9a (can be E9a stage 1) |
| P9 | CLI runner and command grouping (§3.12) | 2 | with the E7 platform-controls ticket |
| P10 | Doc split into capability pages (§3.14) | inside E1 | — |

## 7. Standards to add to `docs/code-patterns.md` and `.agents/limen/styleguide.md`

1. **Borders are linted.** A module imports a lower layer through its `index.ts` only; the layer list and the allowed edges live in `eslint.config.js`; a reverse need is a hook interface in the lower module, wired in a composition root.
2. **File size.** A source file stays under about 400 lines and one aggregate. A repository that grows past it becomes `repo/<aggregate>.ts` behind the same index.
3. **Registries over if-chains.** Action handlers, notice detectors, notice renderers, LLM roles, prompts and jobs are entries in a typed record; a test checks the record against the enum and the CHECK list.
4. **Every new user-visible behaviour is behind `isFeatureOn(ctx, flag)`** with an owner epic and a remove-by date (ADR 0027).
5. **Notices are facts.** A module queues `{ kind, payload }`; the sender renders for the channel, the detail level and the locale. No module builds channel text.
6. **LLM calls name a role.** `generate({ role, schema })`; the role decides provider, model, timeout, cap share; the audit row carries role and prompt version.
7. **Texts carry a locale.** Every text a user reads comes from a locale table in core or in `apps/web/src/i18n`, with a key-parity test between `en` and `pl`.
8. **Comments name rules, ADRs or ticket paths**, never bare codes (`D29`, `U11`, `A3`).
9. **Logs are events.** `log.info("event_code", { fields })` with allow-listed fields; `msg` is a constant; errors only through `describeError` (ADR 0024).
10. **A new table with `org_id` joins four tests in its migration ticket:** the tenant-filter test, the organization delete, the DSR address map, and (if adopted) the RLS policy.
11. **A flaky test is quarantined the same day** with a ticket; `master` is green or the next commit fixes it.
12. **New CLIs use the shared runner** and call a service function, never a repository directly.

## 8. Decisions for the owner

1. Run the foundation group P0–P6 (about 21 stages) before E4-A, E5b and E6a start. E1, E2a, E3a and E5a can run next to it after P0–P2. [recommended: yes]
2. RLS as a safety net (P7, 4 stages) in wave 1. [recommended: yes; it is the one isolation claim an auditor can check]
3. E5 planning designs a `loops` module (one chaser for delegations, waiting replies and promises) instead of a second engine next to `delegation`. [recommended: yes]
4. E4-A models an approval edit as a new superseding draft row, not a payload change. [recommended: yes]
5. Adopt the twelve standards of §7 into `docs/code-patterns.md` and the styleguide in the P1 ticket. [recommended: yes]
6. The E1 capability-map ticket also moves behaviour text out of `docs/architecture.md` (§3.14). [recommended: yes]
