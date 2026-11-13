# F087 · Feature flags and the operator check: plan input

> Written 2026-11-13 from ADR 0027 and the architecture review §3.5. Input of the `plan-task` session. Ticket: [ticket.md](ticket.md). Runs after F086; it is the one migration of the foundation group apart from F088 and F092, so it does not run next to them.

## Facts (2026-11-13)

- No `isFeatureOn` exists. Global switches are env only (`TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE`, `SEND_SCOPE`).
- The operator is a CLI person today; `OPERATOR_TELEGRAM_CHAT_ID` and `OPERATOR_CONTACT` exist in `platform/config.ts`; no user id list.
- `platform/http.ts` has `requireTenant` and `requireOwner`; the route-matrix test pattern (401, 403, 404, 400) is in `docs/code-patterns.md` § HTTP routes.
- `organizations` has `plan`, `trial_ends_at`, `max_mailboxes`, `resumed_at` (migration `20261112100001_org_plan.sql`). `setOrgPlan` in `tenancy/service.ts` is the model for a change with an audit row and hooks.

## Design decisions

- **D1 Registry in core.** `packages/core/src/features.ts`: `export const featureFlags = { stats_page: { default: false, description, epic: "E3a", removeBy: "2027-03-01" }, … } as const satisfies Record<string, FeatureFlag>`; `FeatureKey = keyof typeof featureFlags`. A unit test fails when `removeBy` is in the past: the flag is a cleanup ticket then.
- **D2 Table.** `org_features (org_id uuid references organizations on delete cascade, flag text, enabled boolean not null, set_by text not null, set_at timestamptz not null, primary key (org_id, flag))`. The CHECK list of keys is not in SQL (the registry is the source); the repository refuses an unknown key before the write.
- **D3 Read order.** `isFeatureOn(db, ctx, flag)`: `FEATURES_OFF` (comma list in env, parsed once at start) wins; else the row; else the registry default. One query per call; callers that loop over mail read once per mailbox run (the triage snapshot pattern). No cache layer now.
- **D4 Write path.** `setOrgFeature(db, ctx, { flag, enabled, actor, now })` in `tenancy/service.ts` with the audit row `org.flag_changed` `{ flag, enabled }`; the CLI `org:flag` and later the console call it (ADR 0027 point 4).
- **D5 Operator identity.** `OPERATOR_USER_IDS` (uuid list) in `platform/config.ts`; `requireOperator` middleware in `platform/http.ts` answers 404 to everyone else (also owners), after `requireTenant`. One route under `/api/operator/flags` (GET) proves the guard and the cross-organization read; it lists `org_id`, `flag`, `enabled` only. The module that owns it is `tenancy` for now; E7 may move the operator routes into an `operator` module (ADR 0027 point 2) behind the F086 layer list.
- **D6 Standard.** `docs/code-patterns.md` § Side effects gets: "A new behaviour that a user can see is read through `isFeatureOn`; the flag is in the registry with an owner epic and a remove-by date; default off; the pilot organization turns it on first." The styleguide gets the one-line form.

## Stages

1. **Registry, migration, read.** Files: `packages/core/src/features.ts` (+ test), `db/migrations/<day>100001_org_features.sql`, `bun run db:types`, `apps/server/src/modules/tenancy/{repo,service,index}.ts` (`getOrgFeature`, `isFeatureOn`), `platform/config.ts` (`FEATURES_OFF`), `.env.example`; tests: `apps/server/test/integration/tenancy-features.test.ts` (order, cascade, tenant filter). Migration stage: runs alone.
2. **Write path and CLI.** Files: `tenancy/service.ts` (`setOrgFeature`), `audit/repo.ts` (`auditEvents.orgFlagChanged`), `scripts/org-flag.ts` + `org-flag-args.ts` (+ tests), `package.json` script, `README.md` script table.
3. **Operator check.** Files: `platform/config.ts` (`OPERATOR_USER_IDS`), `platform/http.ts` (`requireOperator`), `tenancy/routes.ts` (`GET /operator/flags`) or a new `operator/routes.ts`, `web.ts` wiring, route-matrix test, `docs/code-patterns.md` § HTTP routes (the operator rule), `docs/architecture.md` §7 (operator identity from env).
4. **Standard and docs.** Files: `docs/code-patterns.md`, `.agents/limen/styleguide.md`, ADR 0027 status line ("flags and operator check landed by F087; console open").

Parallel: stage 1 alone (migration). Stages 2 and 3 at once after it. Stage 4 last.

## Done when

- The five acceptance lines hold, each with the test named.
- The three placeholder flags exist and are off for every organization; `org:flag` turns one on for the pilot organization on the dev database (log line with ids only).
