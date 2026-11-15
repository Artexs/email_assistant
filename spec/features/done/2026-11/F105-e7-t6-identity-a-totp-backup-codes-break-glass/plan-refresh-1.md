# F105 · Plan refresh 1 (2026-11-14)

- Old base: `163c7b2` (the `Plan base:` line of `plan.md`). The coordinator named `7d29529` (the last plan commit). Both give the same drift list; this refresh uses `163c7b2`, the commit the code was read at.
- New base: `ff61cbc` (HEAD of this job).
- After the fixes: `scripts/plan-drift.sh <folder> ff61cbc` → `named paths: 83; changed since base: 0; gone: 0`, `no drift`, exit 0.
- Review: none. No stage changed in substance (no new or changed interface, schema, migration or step, and the stage order is the same). The changes are paths, names, line numbers, new test cases inside existing steps, and notes on landed code.

## Drift output (`scripts/plan-drift.sh <folder> 163c7b2`)

```
plan base: 163c7b2 2026-11-14 11:04
HEAD:      ff61cbc 2026-11-14 12:38
named paths: 73; changed since base: 20; gone: 0
changed: apps/server/src/modules/audit/repo.ts
changed: apps/server/src/modules/audit/security-events.test.ts
changed: apps/server/src/modules/tenancy/repo.ts
changed: apps/server/src/modules/tenancy/routes.ts
changed: apps/server/src/platform/db/schema.ts
changed: apps/server/src/platform/http.test.ts
changed: apps/server/src/platform/http.ts
changed: apps/server/src/web.ts
changed: apps/server/test/integration/web-me.test.ts
changed: apps/server/test/integration/web-operator.test.ts
changed: apps/server/test/integration/web-security-log.test.ts
changed: apps/web/src/components/settings/AccountCard.tsx
changed: apps/web/src/i18n/en.ts
changed: apps/web/src/i18n/pl.ts
changed: apps/web/src/lib/security-log-text.test.ts
changed: apps/web/src/lib/security-log-text.ts
changed: deploy/README.md
changed: packages/core/src/security-log.test.ts
changed: packages/core/src/security-log.ts
changed: packages/core/src/web/index.ts
commits after the base that touch the named paths:
  4cb4e60 11-14 12:28 F099 stage 14: docs and standards (send limits, operator console, security log)
  72fc0aa 11-14 12:18 F098 s05: review notes: reset the consent tick, name the consent in the capability pages, reword the consent texts
  09491bb 11-14 12:13 F099 stage 11.1: operator write helpers and texts
  1e82ba9 11-14 12:06 F099 stage 10: operator page, nav item and view helpers
  6a57448 11-14 11:48 F098 s05: Telegram link needs versioned consent; audit web.telegram_consent; panel checkbox
  9a0cc1e 11-14 11:47 F099 s09: operator writes: POST /api/operator/orgs/:orgId/plan and /flags, orgPlanHooks shared with org:plan
  0a256ef 11-14 11:42 F098: Polish mail provider help texts checked against the providers' pages; plan-refresh rule is permanent
  eb41e8a 11-14 11:36 F097 s01 step 2-3: mailKindFilter and the synthetic scopes take the test sender rule
  46c99b9 11-14 11:24 F099 stage 08: operator organization detail and notices routes
  b6fa717 11-14 11:21 F099 stage 13: security log card in the Account card
  f602082 11-14 11:12 F098 s06: core texts registry (clock, categories, answers, AI line), the hold
  ff1efd6 11-14 11:11 F092 s03: fix import order
  483f0b5 11-14 11:10 F098 s04: language select in the Account card, panel follows users.locale
  9359877 11-14 11:09 F098 s04: user.locale in /api/me and PATCH /api/me/locale
  2797600 11-14 11:06 F099 stage 12: fix import order in security-events test
  f36f5f8 11-14 11:05 F099 s07.2: GET /api/operator/orgs organization list
  0507fc5 11-14 11:05 F092 s03: requireTenant and requireOperator set and clear the tenant scope
  c18c07a 11-14 11:04 F099 stage 12: security log registry, flag and GET /api/security-log
  ae985ae 11-14 11:03 F099 s07.1: tenant-scoped failure and LLM counts for the operator list
  556efcc 11-14 10:51 F098 stage 02: apply the review wording notes to the Polish dictionary
  573453e 11-14 10:29 F098 stage 02: Polish panel dictionary and plural forms
```

The script reads only paths under `apps/`, `packages/`, `db/`, `deploy/`, `scripts/`, `tools/`, `evals/`. This refresh also checked by hand: `db/migrations/` (2 new files), `docs/code-patterns.md`, `docs/architecture.md`, `docs/capabilities/web-panel.md`, `docs/decisions/0027-operator-role-and-feature-flags.md`, `deploy/README.md`, and every short file name in the stages (all new F105 files are still absent: no landed ticket did a step of this plan).

## Changes (stage · what · why)

- plan.md status · `Plan base: ff61cbc, refreshed 2026-11-14` · refresh rule.
- plan.md Differences 3, 4 · marked resolved · F099 stages 12 (c18c07a) and 13 (b6fa717) and F098 stage 02 (`pl.ts`) are on `master`.
- plan.md F12 · line numbers `http.ts:270`, `:394`, `web.ts:349`, `http.test.ts:262,300,355,399,430`; e2e blocks 20 and 30 now in use (F098 `polish.spec.ts`, `language.spec.ts`), 50 and 150 still free · code moved (F092, F098).
- plan.md new F13 · RLS facts: `memberships` and `organizations` have `tenant_rows`; `/api` runs in the session organization's scope, operator routes, `/api/auth/*`, CLIs and jobs run with none; Better Auth has its own pool; only `http.ts` and `scheduler.ts` call the scope functions · F092 landed after the first base; the plan reads memberships across organizations in `isBreakGlassOwner` and `listBreakGlassOrgIdsOfUser`.
- plan.md D12 · `isBreakGlassOwner` runs only with no tenant scope (`/api/auth/*`); no `/api` route calls it · F13: inside an `/api` request RLS would hide the other organizations' memberships.
- plan.md D14 · reason reworded (F098 stage 04 changed `meSchema`, landed) · history.
- plan.md D20 · `pl.ts` exists; every key goes to both files (its type requires it); `i18n.test.ts` rules named · the conditional of the first plan is resolved.
- plan.md D21, stage table, order table, How to run 6 · stage 13 needs only stage 07; build it before stage 14; the new rule of `docs/code-patterns.md` § Data access (F099 stage 14) named · the F099 gate is met.
- plan.md How to run 1 · drift base `ff61cbc` · refresh rule.
- plan.md Advisory overlaps · F098 stages 11–13 and F099 stage 15 are what remains; F098 stage 13 changes the same docs as F105 stage 14 · F098 01–10 and F099 01–14 landed.
- plan.md Planning progress, Log · refresh lines.
- stage 01 · newest migration at the base is `20261114110001_feedback_source_review.sql`; `schema.ts` is in `.prettierignore` and its `Generated` header may differ from the generator (eb41e8a); `memberships` has the RLS policy and the new column needs none · F097, F099 migrations; F092.
- stage 04 step 04.2 · `requireOperator` ends with `await withoutTenantScope(() => next())` (landed): the TOTP branch goes before it; no new scope call · F092 stage 03 landed (the first plan left it open).
- stage 04 test 3 · moved to `web-operator.test.ts` (its `operatorApp` builds the real `apiRouters`), adds `GET /api/operator/orgs` · F099 stage 07 route.
- stage 04 new test 3a · `POST /api/operator/orgs/<org B>/flags` by an operator without TOTP → 403 and no audit row (in `web-operator-writes.test.ts`) · F099 stage 09 added operator writes; the guard must hold for writes too. Files and Check list the F099 suites and `web-tenant-scope.test.ts`.
- stage 05 · comment on `isBreakGlassOwner`: call it only with no tenant scope · F13.
- stage 06 · the hook runs in `/api/auth/*` with no scope · F13.
- stage 08 · `import { z } from "./zod"`; the caller list of `tenancyRoutes` and `apiRouters` at ff61cbc (adds `web-locale`, `web-security-log`, `web-operator-detail`, `web-operator-orgs`, `web-operator-writes`, `web-tenant-scope`); Check adds `web-tenant-scope.test.ts` (the F092 route walk finds the new route) · F092, F098, F099 tests.
- stages 09, 10, 11, 13 · `pl.ts` is required in every Files line; stage 09 Done when names `i18n.test.ts` · D20.
- stage 11 · the order of the Account card at ff61cbc (`LanguageSelect`, password form, sessions block, `SecurityLog`); `SecurityLog.tsx` as the pattern; Polish `tf_codes_done` = "Mam zapisane kody" (neutral) · F098 stage 04, F099 stage 13; the first plan left the Polish form open. New questions.md item 9 [minor].
- stage 12 · e2e blocks in use; the seeded user's locale is null, so the panel is English; `signIn` has an optional text set · F098 stage 03, 04.
- stage 13 · gate text replaced by the landed facts (commits, route behind the flag `security_log`, registry shape, re-export in `packages/core/src/web/security-log.ts`); the code-patterns rule named; `pl.ts` `sec_help` exists · F099 stages 12–14.
- stage 14 · 14.1 names the current list (`setUserLocale`) and the existing exception `deleteExpiredVerifications`, and the scope rule of the two new functions; 14.2 adds capability rule 8 (operator) with the TOTP rule; 14.3 gives the exact ADR 0027 status text at ff61cbc; 14.4 puts the console line into `### Operator console` (F099) and names "After the first deploy of S6b"; F098 stage 13 overlap · F099 stage 14, F098.
- stage 15 · stage 13 normally ships in the same deploy · the F099 gate is met.

## Facts checked that needed no change

- `better-auth` 1.7.18 in `apps/server/package.json`, `apps/web/package.json`, `bun.lock`; `@better-auth/utils` 0.5.1; `.bun-version` 1.4.4; root `package.json` scripts (`db:migrate`, `db:rollback`, `db:types`, `org:flag`, `web:invite`) unchanged; no `uqr` in `bun.lock`.
- `platform/auth.ts` unchanged: 500 lines, `AUTH_ALLOWED_PATHS` at :54 with 7 paths, `databaseHooks.session.create.after` login report at :422, `hooks.before` at :378, `getSessionFromCtx` imported, own `Pool` at :487; `auth.test.ts` has three `size` checks of 7.
- `web.ts`: `eventNames` at :56 (`satisfies Record<AuthEventKind, string>`), `auditWebEvent` uses the oldest membership, `createAuth` call at :319, `apiRouters(config, db, extras, now, sessions)` has 5 parameters.
- `http.ts`: `WebSession` has `userId`, `sessionId`, `setCookie`; `OPERATOR_PAGE` at :250; the page guard 404 branch; `api.use("/operator/*", requireOperator)` after `requireTenant`; `/api/auth/*` mounted before `api`.
- `modules/audit/repo.ts`: `auditEvents` has `webOtherSessionsRevoked` (new `webTelegramConsent` before it does not matter); `security-events.test.ts` checks registry codes ⊂ `auditEvents`.
- `modules/tenancy/repo.ts`: `MembershipWithUser`, `getMembership`, `listMemberships`, `lockOrganization`, `getOrganization`, `UserAuthProfile`, `getUserAuthProfile`, `insertUser`, `insertMembership`; only `setDigestTimes` updates `memberships`; no code deletes a membership. `service.ts`: `createOrganizationWithOwner`, `setOrgFeature`.
- `listSecurityLog` reads `data.locked_until`; actor `cli` → `operator`; the web test fixture names `Owner`, `NOW = 2026-11-20T10:00:00Z`.
- `security-log-text.test.ts` "every event kind has an English text"; `i18n/islands.test.ts` counts 9 islands and checks `useLocale();` first (F105 adds no island); `pl.ts` is `Record<TextKey, string>`; `en.ts` has `load_error_text`, `password_label`, `continue`, `cancel`, `error_too_many`, `error_generic`, `sec_help`.
- `AccountCard.tsx` imports `useResource`, `api`, `Skeleton`, `Switch`, `toast`; `LoginPage.tsx` unchanged (first line `useLocale();`).
- E2e: `nextAddress`, `cspErrors`, `readSeed`, `workers: 1`; `e2e-seed.ts`, `e2e-seed-args.ts`, `e2e-seed.test.ts` unchanged (`E2E_TERMS_EMAILS` pattern, `E2E_MEMBER_PASSWORD`, `requestLink`, `setPassword`).
- Tests named by the stages exist: `auth-public-schema.test.ts`, `rls-policy.test.ts` (test 1: only `org_id` tables), `web-lockout.test.ts` (`nextIp`, console spies), `web-auth.test.ts`, `web-auth-logs.test.ts`, `web-operator-page.test.ts` (`FORMS`), `web-me.test.ts`, `org-flag-cli.test.ts`, `capability-map.test.ts`; `db/migrations/20261103000001_app_grants.sql`.
- Docs: `docs/architecture.md` §5 sentence "The three Better Auth tables …" at :304; §7 at :452; `deploy/README.md` "### Leaked-password check"; ADR 0026 status "proposed"; F099 stage 15 runbook step 6 exists.
- No new file of this plan exists at ff61cbc (`auth-two-factor*.ts`, `totp.ts`, the CLIs, the tests, `TwoFactorSection.tsx`, `TotpQr.tsx`, `two-factor-errors.ts`, `totp-setup.ts`, `packages/core/src/web/two-factor.ts`, `two-factor.spec.ts`).
