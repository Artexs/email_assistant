# F087 · Feature flags and the operator check: plan

> **Status 2026-11-13 — planned.** Five stages written; cold review done (see "Cold review"). Builds after F086 is in `done/`. Nothing is built yet.

Ticket: [ticket.md](ticket.md). Open defaults for the owner: [questions.md](questions.md).

## Planning progress

- [x] Collect: ticket, plan input, ADR 0027, review §3.5, `07-foundation-plan.md`, E07 notes §6, the code of `tenancy`, `platform/{config,http}.ts`, `web.ts`, `org-plan` CLI, the test helpers.
- [x] Facts checked (two Hono probes).
- [x] Decisions D7–D23.
- [x] stage-01-registry [written]
- [x] stage-02-table-and-read [written]
- [x] stage-03-write-and-cli [written]
- [x] stage-04-operator-check [written]
- [x] stage-05-standards [written]
- [x] Cold review (`plan-review-1.md`), fixes logged in "Cold review".

## Input

### Plan input of 2026-11-13, word for word (the owner's planning session; source ADR 0027, review §3.5)

> Written 2026-11-13 from ADR 0027 and the architecture review §3.5. Input of the `plan-task` session. Ticket: [ticket.md](ticket.md). Runs after F086; it is the one migration of the foundation group apart from F088 and F092, so it does not run next to them.

Facts (2026-11-13), as written:

- No `isFeatureOn` exists. Global switches are env only (`TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE`, `SEND_SCOPE`).
- The operator is a CLI person today; `OPERATOR_TELEGRAM_CHAT_ID` and `OPERATOR_CONTACT` exist in `platform/config.ts`; no user id list.
- `platform/http.ts` has `requireTenant` and `requireOwner`; the route-matrix test pattern (401, 403, 404, 400) is in `docs/code-patterns.md` § HTTP routes.
- `organizations` has `plan`, `trial_ends_at`, `max_mailboxes`, `resumed_at` (migration `20261112100001_org_plan.sql`). `setOrgPlan` in `tenancy/service.ts` is the model for a change with an audit row and hooks.

Design decisions, as written:

- **D1 Registry in core.** `packages/core/src/features.ts`: `export const featureFlags = { stats_page: { default: false, description, epic: "E3a", removeBy: "2027-03-01" }, … } as const satisfies Record<string, FeatureFlag>`; `FeatureKey = keyof typeof featureFlags`. A unit test fails when `removeBy` is in the past: the flag is a cleanup ticket then.
- **D2 Table.** `org_features (org_id uuid references organizations on delete cascade, flag text, enabled boolean not null, set_by text not null, set_at timestamptz not null, primary key (org_id, flag))`. The CHECK list of keys is not in SQL (the registry is the source); the repository refuses an unknown key before the write.
- **D3 Read order.** `isFeatureOn(db, ctx, flag)`: `FEATURES_OFF` (comma list in env, parsed once at start) wins; else the row; else the registry default. One query per call; callers that loop over mail read once per mailbox run (the triage snapshot pattern). No cache layer now.
- **D4 Write path.** `setOrgFeature(db, ctx, { flag, enabled, actor, now })` in `tenancy/service.ts` with the audit row `org.flag_changed` `{ flag, enabled }`; the CLI `org:flag` and later the console call it (ADR 0027 point 4).
- **D5 Operator identity.** `OPERATOR_USER_IDS` (uuid list) in `platform/config.ts`; `requireOperator` middleware in `platform/http.ts` answers 404 to everyone else (also owners), after `requireTenant`. One route under `/api/operator/flags` (GET) proves the guard and the cross-organization read; it lists `org_id`, `flag`, `enabled` only. The module that owns it is `tenancy` for now; E7 may move the operator routes into an `operator` module (ADR 0027 point 2) behind the F086 layer list.
- **D6 Standard.** `docs/code-patterns.md` § Side effects gets: "A new behaviour that a user can see is read through `isFeatureOn`; the flag is in the registry with an owner epic and a remove-by date; default off; the pilot organization turns it on first." The styleguide gets the one-line form.

Done when, as written:

- The five acceptance lines hold, each with the test named.
- The three placeholder flags exist and are off for every organization; `org:flag` turns one on for the pilot organization on the dev database (log line with ids only).

Owner decisions that bind this plan: PD-045 (flags), PD-046 (operator console and `OPERATOR_USER_IDS`), ADR 0027 points 1, 2, 4, 5, 6 (`docs/product/stage-2/decisions.md`, `docs/decisions/0027-operator-role-and-feature-flags.md`). Owner: "Okay, so go with the default values" (E7 decisions 9 and 10).

### Design decisions of this plan (D7–D23)

D1–D6 above stay. These decisions make them exact. "Default, owner to confirm" marks a small question that is also in [questions.md](questions.md); the stages do not change with its answer.

- **D7 One pure resolver in core.** `resolveFeature({ defaultOn, configured, killed, row })` in `packages/core/src/features.ts` returns `{ enabled, source }` with `source` in `unconfigured | env | row | default`, in that order of precedence. `isFeatureOn`, the CLI list and the operator route all use it, so the order exists once and has a unit test without a DB. Rejected: the order inside each caller (three copies drift).
- **D8 `FEATURES_OFF` refuses an unknown key at start.** The config check refuses an entry that is not a registry key (`ConfigError` names `FEATURES_OFF`). Reason: a typo in a kill switch that the server ignores leaves the feature on while the operator thinks it is off; the repo already refuses bad list entries at start (`WEB_TRUSTED_PROXIES`). Rejected: ignore the entry with a warn line. Consequence: a cleanup ticket that removes a flag from the registry must tell the operator to remove it from `FEATURES_OFF` first (stage 5 writes this into the standard).
- **D9 The kill list reaches `tenancy` once, at start.** `configureFeatures({ off })` in `apps/server/src/modules/tenancy/features.ts` stores the process settings, the same shape as `configureMailHosts` (`mail/host-guard.ts`). `main.ts`, and every entry script that reads a flag, calls it after `loadConfig`. Without the call every flag reads off (`source: "unconfigured"`) and the process writes one warn line: the safe direction, no crash. The test preload (`apps/server/test/preload.ts`) calls `configureFeatures({ off: [] })` and sets `process.env.FEATURES_OFF = ""`, so the CLI tests do not inherit a kill list from a developer `.env`. Rejected: a fourth argument on every `isFeatureOn` call (the ticket fixes the signature `isFeatureOn(db, ctx, flag)`); throwing when unconfigured (a forgotten call stops a job).
- **D10 No query when the answer is known.** `isFeatureOn` makes no DB query when the process is unconfigured or the flag is in the kill list; otherwise exactly one query (`getOrgFeature`). The callers that loop read once per mailbox run (D3).
- **D11 Write semantics.** `setOrgFeature` refuses an unknown key (`unknown_flag`) before any query; locks the organization row (`lockOrganization`, `FOR NO KEY UPDATE`) and answers `not_found` without it; reads the row; when a row with the same `enabled` exists it answers `unchanged` and writes nothing (no audit row); else it upserts (`ON CONFLICT (org_id, flag) DO UPDATE`) with `set_by = actor`, `set_at = now`, and writes the audit row in the same transaction. `--off` with no row writes a row with `enabled = false`: an explicit off stays off when the default later turns on. The organization lock serializes two writes at once. Rejected: no write for "off equals default" (then a later default flip turns the organization on without anyone asking it).
- **D12 No "clear" in this ticket.** There is no command that deletes a row (back to the default). Default, owner to confirm (Q1). E7's console may add it.
- **D13 Audit row.** Event `org.flag_changed` (`auditEvents.orgFlagChanged`), data exactly `{ flag, enabled }`, actor `cli` from the CLI, the user id from a later console. The E07 notes §6 named it `org.feature_changed`; the ticket name wins.
- **D14 CLI.** `bun run org:flag --org-id <uuid> --flag <key> --on|--off` writes; `bun run org:flag --org-id <uuid>` (no `--flag`) lists every registry key with its effective value and source for that organization. Exit 0 on `changed`, `unchanged` and the list; exit 1 on a usage error, `unknown_flag` (the message lists the registry keys) and `not_found`. Output: org id, flag keys, `on`/`off`, sources only, never the organization name. When `FEATURES_OFF` holds the key, the write still happens and the output adds `(FEATURES_OFF holds <key>: it reads off everywhere)`. The CLI calls `configureFeatures` and `assertAppRole` like `org:plan`.
- **D15 The guard sits in the platform, for the whole prefix.** `createApp` adds `api.use("/operator/*", requireOperator)` right after `requireTenant` and before `refuseSuspendedWrites`. Every route under `/api/operator` is guarded, whatever module mounts it, so E7 cannot forget it. Probe P1 (Facts) shows why the guard must not be a `use("*")` inside a sub-app mounted at `/`: it then guards every `/api` route. A refusal answers `404 { error: "not_found" }`, the same body as an unknown `/api` path, and logs one warn line `operator route refused for user <userId>` (an id only).
- **D16 Operator identity.** `OPERATOR_USER_IDS`: comma list of UUIDs, trimmed, lower-cased, unique; a bad entry stops the start (`ConfigError` names the key); empty = no operator. `WebDeps.operatorUserIds?: ReadonlySet<string>`; absent = nobody (old tests and a web without the key fail closed). The start log writes only the count (`operator ids: <n>`), never the ids.
- **D17 The operator needs a membership.** `requireTenant` runs before `requireOperator` (D5), so an operator without any membership gets `403 no_organization` like every other `/api` path. The pilot owner is the operator. Default, owner to confirm (Q2). Changing it touches the order of the platform middleware; E7 decides if it needs an operator without an organization.
- **D18 The operator route.** `GET /api/operator/flags` answers `200 { rows: [{ orgId, flag, enabled }] }`: every organization × every registry key, with the effective value of D7 (the kill list included), ordered by organization (`listOrganizations` order: `created_at`, `id`) then by registry order. Two queries: `listOrganizations` and `listOrgFeatureRowsOfAll`. A row whose key is not in the registry is skipped. No name, no plan, no source field (D5: ids, keys and `enabled` only). The type `OperatorFlags` lives in `@ea/core/web` for E7's page. The router is `operatorRoutes` in `apps/server/src/modules/tenancy/operator-routes.ts`, mounted by `web.ts` at `/operator`.
- **D19 Registry checks.** A key matches `^[a-z][a-z0-9_]{0,39}$`; `description` and `epic` are not empty; `epic` matches `^E\d{1,2}[a-z]?(-[A-Z])?$` (`E3a`, `E4-A`, `E5a`); `removeBy` is a real date `YYYY-MM-DD`. `expiredFlags(registry, today)` lists keys with `removeBy < today` (the day itself is not past). The real-registry test uses today's UTC date and fails with `flag <key> is past its remove-by date <date>: open a cleanup ticket`. `isFeatureKey` uses `Object.hasOwn` (so `toString` is not a key).
- **D20 Placeholder flags.** `stats_page` (E3a, the stats page), `approvals_page` (E4-A, the approvals page), `sent_sync` (E5a, read the Sent folder), all `default: false`, all `removeBy: "2027-03-01"` (the date of D1). Default, owner to confirm (Q3).
- **D21 Migration.** One table as D2, plus two format checks: `flag ~ '^[a-z][a-z0-9_]{0,39}$'` and `length(set_by) > 0`. No key list in SQL (D2). No extra index (the primary key serves both reads; the cross-organization list is small). Grants come from the default privileges of `20261103000001_app_grants.sql` (the table is created by `migrator`). File name: a timestamp later than the newest file in `db/migrations` at build time, `<build day>100001_org_features.sql`.
- **D22 No web reading side now.** `/api/me` gets no flag field and the web reads no flag. The first epic with a user-visible web feature (E3a) adds it. The operator page is E7.
- **D23 Stages run one after another.** Stages 2, 3 and 4 all change `tenancy/index.ts`; stages 1 and 4 change `platform/config.ts`. Parallel jobs would conflict at the land. Total size is small, so the plan gives up parallel lanes.

## Differences found at collect (2026-11-13)

- The ticket says "`org_features` … is in the tenant-filter test list". No central list exists: each repository function has its own tenant-filter case (`docs/code-patterns.md` § Data access), and no organization-delete test exists yet (S6c, `tasks/planned/s6c-account-data.md`, builds an `information_schema` delete test that will cover `org_features` by itself). This plan meets the line with a tenant-filter case for each new repository function and a cascade test (stage 2).
- The ticket's stage list put the CLI in `README.md`; the operator commands live in `deploy/README.md` § "Customers (S6a)". Stage 3 documents `org:flag` there.
- The input listed four stages with stages 2 and 3 in parallel. This plan has five stages, run one after another (D23): the registry (pure) is split from the migration, so the `[risky]` migration stage stays small.

## Facts checked (2026-11-13)

- **P1 Hono 4.13.16** (`node_modules/hono/package.json` of the main checkout; probe `.probe-f087/hono-probe.ts`, deleted after): a sub-app with `sub.use("*", guard)` mounted by `api.route("/", sub)` runs the guard for `/api/me` too (`/api/me` answered 404). Mounted at `api.route("/operator", sub)`, or with the guard on one route, the guard runs only for `/api/operator/*`.
- **P2** (probe `.probe-f087/hono-probe2.ts`): `api.use("/operator/*", guard)` runs for `/api/operator`, `/api/operator/`, `/api/operator/flags`, `/api/operator//flags`, `/api/operator/flags/` and the encoded `/api/operator/%66lags`; it does not run for `/api/operatorx` or `/api/me`. `/api/OPERATOR/flags` matches no route and falls to the `/api` 404.
- `app` may `DELETE FROM organizations`: `webOrg().cleanup()` (`apps/server/test/integration/web-helpers.ts`) and `org-cli.test.ts` do it as the app role. The default privileges in `20261103000001_app_grants.sql` give `app` SELECT, INSERT, UPDATE, DELETE on every new table that `migrator` creates; `audit_log` alone has UPDATE and DELETE revoked.
- `bunfig.toml` preloads `apps/server/test/preload.ts` for every `bun test` run (unit and integration); it already calls `configureMailHosts`.
- `platform/http.ts` already imports `@ea/core`, so `platform/config.ts` importing `@ea/core` adds no new kind of edge.
- `listOrganizations(db)` (`tenancy/repo.ts:73`) orders by `created_at`, `id` and is already a listed cross-organization exception.
- `WebDeps` is built in `web.ts` (`webDeps`), `web-helpers.ts` (`webTestApp`) and `web-http.test.ts` (`makeWeb`); an optional new field needs no change in the last two.
- `isFeatureKey` needs `Object.hasOwn`: `"toString" in {}` is `true` in JavaScript.

## Not verified

- The F086 layer lint (not landed) accepts `platform/config.ts → @ea/core` and the new file `tenancy/operator-routes.ts`. Stage 1 and stage 4 check it: `bun run lint` passes at their commit; a lint error there is a question for the coordinator, not a reason to move code.
- The RI cascade from `organizations` to `audit_log` under the `app` role: not needed here (the cascade test of stage 2 writes no audit row), but `webOrg().cleanup()` already shows it works.

## Done when

1. `isFeatureOn(db, ctx, flag)` follows `FEATURES_OFF` → row → registry default. Shown by: `packages/core/src/features.test.ts` (resolver table, stage 1) and `apps/server/test/integration/tenancy-features.test.ts` (stage 2).
2. `bun run org:flag --org-id <id> --flag <key> --on|--off` writes the row and one `org.flag_changed` audit row; an unknown key is refused with exit 1 and no row. Shown by: `apps/server/test/integration/org-flag-cli.test.ts` and `tenancy-flag-write.test.ts` (stage 3).
3. `org_features` rows go with their organization, and every new repository function filters by `org_id` (except the listed `listOrgFeatureRowsOfAll`). Shown by: the cascade and tenant-filter cases of `tenancy-features.test.ts` (stage 2).
4. A non-operator, also an owner, gets `404 { error: "not_found" }` on `GET /api/operator/flags`; other `/api` routes still answer them. Shown by: `apps/server/test/integration/web-operator.test.ts` (stage 4).
5. An operator gets every organization × every registry key with `orgId`, `flag`, `enabled` only. Shown by: `web-operator.test.ts` (stage 4).
6. A registry flag past its remove-by date fails a unit test. Shown by: `features.test.ts` (stage 1).
7. The three placeholder flags exist with `default: false`; on the dev database `org:flag` turns one on for the pilot organization and prints ids and keys only. Shown by: `features.test.ts` and owner step U2.
8. `docs/code-patterns.md`, the styleguide, `docs/architecture.md` and ADR 0027 state the flag rule and the operator rule. Shown by: stage 5 diff.

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, the ticket, this file and your stage file first. Build only your stage.
- Format only the files of your stage: `bunx prettier --write <files>`. Never the whole repo (S2 incident: a builder ran the repo-wide formatter).
- Logs, audit rows, CLI output and error texts hold ids, flag keys, codes, counts and times. Never an organization name, a user e-mail address, a secret or a list of operator ids. Errors go through `describeError`.
- The repo is public: no real name, address or user id in a file. Test addresses end in `@x.test`.
- Template literals for strings with variables; `const` / `let` only.
- A test with a time passes a fixed `now` (`2026-11-20T10:00:00Z` unless the stage says another), never `Date.now()` in an assertion. Only the remove-by test of stage 1 reads today's date, by design (D19).
- Integration tests run in parallel with other test files in one process: a test that reads across organizations (stage 4) asserts on its own organization ids, never on a total count. A test that calls `configureFeatures` with a non-empty kill list restores `configureFeatures({ off: [] })` in `afterEach`.
- A stage that changes a type or a required field fixes every caller and test in the same stage, so all checks pass at its commit.
- Commit by explicit path (`git add <paths>`), never `git add -A`.
- Only stage 2 adds a migration. No stage changes `bun.lock` or the dependencies in any `package.json` (stage 3 adds one `scripts` line). If you think you need a dependency, stop and ask.
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or another ticket.
- A gap or a deviation is a question in your final message, not a choice.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows. `test:int` needs no lock: each job has its own DB (`CLAUDE.md`, 2026-11-13). No stage runs `test:e2e`.

Stages 1–4 (NN = the stage number):

```
mkdir -p /tmp/f087-sNN && bun run lint > /tmp/f087-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f087-sNN/typecheck.log 2>&1 && bun run test:unit > /tmp/f087-sNN/unit.log 2>&1 && bun run test:int > /tmp/f087-sNN/int.log 2>&1 && echo PROOF_OK
```

Stage 5 (docs only; `<files>` = the files the stage changed):

```
mkdir -p /tmp/f087-s05 && bunx prettier --check <files> > /tmp/f087-s05/prettier.log 2>&1 && bun run lint > /tmp/f087-s05/lint.log 2>&1 && bun run test:unit > /tmp/f087-s05/unit.log 2>&1 && echo PROOF_OK
```

## User checkpoints

- **Checkpoint 1 (after stage 4 lands, before stage 5):** the coordinator stops and sends the owner the review results of stages 2 and 4 and the owner steps U1–U3. Reason: the operator guard is the first web path that reads across organizations; the owner sees it work on the dev database before the docs call it the standard. Stage 5 starts after the owner's go.

## User steps

| #   | Step | When |
| --- | ---- | ---- |
| U1  | Run `bun run db:migrate` on the shared dev database (main checkout, no other migration running). | after stage 2 lands (any time before U2) |
| U2  | On the dev database: `bun run org:flag --org-id <pilot org id>` (list: three flags, all `off`, source `default`); `bun run org:flag --org-id <pilot org id> --flag stats_page --on` (one line with ids and keys); list again; then `--off` again, so every flag stays off until its epic ships (Q4). | after stage 3 lands, at checkpoint 1 |
| U3  | Optional: put your own user id into `OPERATOR_USER_IDS` in the dev `.env`, restart the dev server, open `/api/operator/flags` in the signed-in browser (JSON), and check that another user gets the 404 page body. The agent does not read `.env`. | at checkpoint 1 |
| U4  | On the VPS: nothing in this ticket. `OPERATOR_USER_IDS` and `FEATURES_OFF` stay empty until E7 or the first flagged feature deploys. | — |

## Review

- A review job before the land for stage 2 (migration, tenant filter) and stage 4 (auth guard, cross-organization read). Model: the board's reviewer (`spec/build.md` § TRACK: `claude-sonnet-5-5`, high). Other stages land on the worker's proof.
- Review spawn (after the worker job is done; `<B>` = the job's branch, `NN` and `<slug>` from the stage list):

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --review --detached --branch <B> --label "review s<NN> · F087" \
  "Review F087 stage NN on <B> against spec/features/active/F087-feature-flags/plan.md and stages/stage-NN-<slug>.md. Check that every numbered test exists and asserts what the stage says, the log rules, the tenant filter of every new repository function, and every decision the stage cites. Stage 4: try to reach /api/operator/* as a non-operator by any path form. Quote file and line for each finding."
```

## Stages

| # | Stage | Size | Mark |
| - | ----- | ---- | ---- |
| 01 | [Registry, resolver and the kill-list key](stages/stage-01-registry.md) — `packages/core/src/features.ts`, `FEATURES_OFF` in config | ~170 lines | |
| 02 | [Table and read path](stages/stage-02-table-and-read.md) — migration, repo, `isFeatureOn`, `configureFeatures`, preload, `main.ts` | ~280 lines | `[risky]` migration, tenant filter |
| 03 | [Write path and CLI](stages/stage-03-write-and-cli.md) — `setOrgFeature`, audit event, `org:flag`, `deploy/README.md` | ~300 lines | |
| 04 | [Operator check and route](stages/stage-04-operator-check.md) — `OPERATOR_USER_IDS`, `requireOperator`, `GET /api/operator/flags` | ~300 lines | `[risky]` auth, cross-tenant read |
| 05 | [Standards and docs](stages/stage-05-standards.md) — code patterns, styleguide, architecture, modules, ADR 0027 | ~80 lines | |

Order: 1 → 2 → 3 → 4 → checkpoint 1 → 5. No parallel lanes (D23).

## How to run (coordinator)

1. Before the first spawn: F086 is in `spec/features/done/` (ticket § Sequenced), no other migration or `bun.lock` change is in build (F088 stage 1, F092 stage 1), and no F089 or F090 stage that edits `platform/config.ts` is in build while F087 stage 1 or 4 runs. Move the ticket: `git mv spec/features/planned/F087-feature-flags spec/features/active/`, commit (the worktrees see only committed files).
2. Spawn one stage (NN = two digits, `<slug>` from the stage list):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F087-sNN <slug> · F087" \
     "Implement F087 stage NN. Read spec/features/active/F087-feature-flags/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f087-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

3. When the job finishes: read its final message and `/tmp/f087-sNN/*.log`. For stage 2 and stage 4, spawn the review job (§ Review) and wait for it; a finding → `limen continue <job-id> "<fix>"` with the same engine flags, then review again (at most 2 rounds, then the owner decides).
4. Land: `limen land <job-id> --yes --keep-open` (stage 5: without `--keep-open`; it closes the ticket). Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`.
5. Land stage N before you spawn stage N+1. After stage 2 lands, hand the owner U1. After stage 4 lands, stop at checkpoint 1 (U2, U3); spawn stage 5 after the owner's go.
6. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass. A check with no proof at all → `limen continue`.

## Cold review

Not run yet.

## Log

- 2026-11-13: planned by a `--role planner` job (Opus 5.5). Probes P1, P2.
