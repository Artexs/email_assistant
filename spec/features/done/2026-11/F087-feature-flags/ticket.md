---
opened: 2026-11-13
landed: 2026-11-13
---

# F087 · Feature flags per organization and the operator check exist before the first Stage 2 feature

## Outcome

Code can ask `isFeatureOn(db, ctx, flag)` and get the answer for one organization: the registry default, overridden by a row in `org_features`, overridden by the env kill list `FEATURES_OFF`. The operator sets a flag from the CLI with an audit row. The server knows who the operator is (`OPERATOR_USER_IDS`) and an HTTP middleware refuses everyone else with 404, so E7's console and every later flag route have their guard. Every Stage 2 behaviour that a user can see ships behind a flag from its first stage (PD-045, ADR 0027).

## Scope

- Starting seam: `packages/core` (the registry), `db/migrations` (one table), `apps/server/src/modules/tenancy` (the read, the write, the CLI), `apps/server/src/platform/{config,http}.ts` (the operator list and `requireOperator`).
- The registry row shape: key, default, description, owner epic, remove-by date. The first flags are placeholders for the epics that are ready to plan (`stats_page`, `approvals_page`, `sent_sync`), default off.
- The standard "every new user-visible behaviour is behind a flag" in `docs/code-patterns.md` and the styleguide.

## Out of scope

- The operator console page and `/api/operator/*` routes (E7 platform controls, absorbs F081). This ticket ships the middleware and one `GET /api/operator/flags` read as its proof.
- Flags per user or per mailbox. A flag vendor or SDK.

## Acceptance

- `isFeatureOn(db, ctx, flag)` follows the order env kill list → `org_features` row → registry default (unit and integration tests).
- `bun run org:flag --org-id <id> --flag <key> --on|--off` writes the row and an `org.flag_changed` audit row; an unknown key is refused.
- `org_features` rows are deleted with their organization (cascade test), and each new repository function has a tenant-filter test.
- A non-operator, also an owner, gets 404 on `GET /api/operator/flags` (route-matrix test).
- An operator gets the flag list of every organization from that route, ids and keys only.
- A unit test fails when a registry flag is past its remove-by date (the cleanup reminder).

## Slices

Six worker jobs, one per stage in `stages/`, run one after another: the registry, the table and read path (the only migration: not next to another migration or `bun.lock` change), the write path and CLI, the operator guard, the operator flag route, the standards. Stages 2, 4 and 5 get a review job. The coordinator stops after stage 5 (checkpoint 1: the owner runs `org:flag` on the dev database) before the last stage. Commands: [plan.md](plan.md) § "How to run".

## Sequenced

- Plan after: none (F086's plan already fixes the layer list; this ticket adds no module).
- Build after: F086, the module borders lint (it changes the lint every later job runs).
- Gate: the owner's go for the foundation group (`docs/product/stage-2/07-foundation-plan.md` §4 decision 1). No other migration in build at stage 2 (F088 stage 1, F092 stage 1); no F089 or F090 stage that edits `platform/config.ts` in build at stages 1 and 4.

## Notes

Design and stages: [plan.md](plan.md); open defaults: [questions.md](questions.md). Source: ADR 0027, PD-045, PD-046, review §3.5.
