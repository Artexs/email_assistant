# F102 plan refresh 1

- Old base: `5e07cdf2` (2026-11-15 00:33). New base: `d70e540e` (HEAD, 2026-11-15 01:30).
- No scouts (refresh job). Stage count stays 20; no decision, owner answer or default changed.

## Drift output

```
$ scripts/plan-drift.sh spec/features/planned/F102-e4-a-act-from-the-panel 5e07cdf2
named paths: 33; changed since base: 3; gone: 0
changed: apps/server/src/platform/http.ts
changed: apps/server/src/scripts/e2e-seed.ts
changed: apps/web/package.json
  86c709ae F103 s02: 13 scripts print through createCliOutput
  0984bfd6 F119 stage 05: mark the SSO session, cap it at 12 h, refuse it on the operator console
  ac8b5431 F101 s02: panel to Astro 7.4.12 (security.csp, Tailwind 4.3 with the 4.1 font stack, lockfile)
```

## Changes

- plan.md status: `Plan base: d70e540e, refreshed 2026-11-15`.
- plan.md D6, stage 01, stage 03, Q19 (new, minor default): the OpenAPI file and `routeGaps` cover every `/api/*` route of `createApp`, not only `apiRouters`. Why: F119 stage 11 mounts the public `GET /api/sign-in-options` in `platform/http.ts` before the session guard, outside `apiRouters`; the old check could not see it. Stage 01 adds T9 (a route before the session guard is in the file). `/api/auth/*` moves to `HIDDEN_ROUTES` ("Better Auth"), because the full-app walk now sees it.
- Stage 03 Step 2: names `GET /api/sign-in-options` (describe at its mount) instead of "SSO or two-factor routes". T6 counts operations (method plus path), not paths: one path can hold two methods, so the old count could not hold.
- Stage 01 and stage 07 lockfile notes: install through `bash scripts/ci-bun.sh install` (Bun of `.bun-version`); `git diff bun.lock` adds only the new package and its dependencies on top of the F101 stage 02 lock. Stage 07: a second `axe-core` beside 4.10.3 (`eslint-plugin-jsx-a11y`) is expected. `--frozen-lockfile` checks run through `ci-bun.sh`.
- Stage 07: Astro 7.4.12 precondition and the Node 22.23.4+ need of its CLI (CI pins 24). Fixes stay inside the CSP rule.
- Stage 07 Step 2: no spec at HEAD opens Stats or Operator, so T2 could not hold. The stage adds `stats.spec.ts` on its own seed organization. The operator console leaves the axe list (Q20, important: scope; see review fixes).
- plan.md § Rules: a plan rule for pages (from ADR 0016: hashed `script-src`) (no `is:inline` script, no `on*=` attribute; `security.csp` hashes only Astro's scripts; a new page's spec asserts `cspErrors` empty).
- plan.md F1: `zod` resolves to 4.6.7 in the lock (the range is `^4.1.12`; same at both bases). F2: the lock has `playwright-core` 1.65.0. New F8: Astro 7.4.12; `csp checked in 18 page(s)` at HEAD.
- Stages 12, 17, 18: `csp checked in <n> page(s)` with n one more than on `master` before the stage (fixed counts dropped after review 2, N2).
- Stage 12: the e2e seed prints through its `createCliOutput` (F103 stage 02), ids only.
- plan.md trims to stay at or below 1,500 words: Log section removed (the status line holds the base), N4 removed (U1 holds it), the lockfile and migration lane sentence removed (CLAUDE.md rule and the stage headers hold it), F7 second sentence removed (Q1 holds it).

## Checked, no change

- `apps/web/integrations/csp-style-src.ts` still logs `csp checked in <n> page(s)`; the web Proof grep holds.
- F101 stage 02 Step 3 (own e2e DB) exists; F101 is still in `active/`, so the "F101 in done/" need of stages 07, 12, 13, 17, 18 still gates.
- `requireOperator` now answers 403 `password_sign_in_required` for an SSO session: operator routes stay hidden, so no stage changes. P6 (owner-only writes) depends on the role, not on `signInMethod`.
- `WebSession.signInMethod` is a new required field: fakes in new tests set it (the worker finds it by typecheck; no plan text).
- `hono` 4.13.16 in the lock, as F1. `@playwright/test` 1.65.0 satisfies F2.
- `apps/web/e2e/helpers.ts` has `cspErrors`; `i18n.test.ts`, `nav-items.ts`, `Nav.tsx`, `platform/http.test.ts` exist.
- No landed ticket did a step of this plan (no `hono-openapi`, `@axe-core/playwright`, `approvals.astro` or `supersedes_action_id` at HEAD).
- F119 stage 11 also adds `signInMethod` and `hasPassword` to `meSchema`; stage 10 adds `approvalsWaiting` to the same schema. Both additions merge; no plan change.

## Review

The stage 01 interface changed (`routeGaps` input and the walked app), so cold review 2 ran: [plan-review-2.md](plan-review-2.md), `claude-opus-5-5` (the plan has `[risky]` stages), PASS with 9 notes.

- N1 (fixed, stage 01, stage 03 T6): route keys are a set; `ALL` entries with a `*` path (middleware, catch-all) do not count; the test fails on an `ALL` entry without `*`. `/api/auth/*` is hidden as `GET` and `POST`.
- N2 (fixed, stages 12, 17, 18, F8): the fixed counts 19/20/21 assumed one land order; only the relative rule stays.
- N3, N9 (fixed, stage 07, Q20 now `[important: scope]`): the operator console leaves the axe list; the e2e server reads `OPERATOR_USER_IDS` before the seed makes user ids. P3 now says "every customer page".
- N4 (fixed, stage 01): new interface `openApiSpec(root)`; the served file and the route test both use it; T9 checks the served file of `createApp` against it.
- N5 (fixed, plan.md § Rules): the page rule is marked a plan rule; its base is ADR 0016 (hashed `script-src`, no `'unsafe-inline'`).
- N6 (fixed, stage 07): the Stats spec uses its own seed organization; `auth.spec.ts` counts 4 phone tabs of the main one.
- N7 (fixed, stage 01, Q21 new minor): cookie scheme `session` as default; `apiDoc` `public: true` sets `security: []`.
- N8 (not in this folder): F119 stage 11 needs one line: "`GET /api/sign-in-options` gets `apiDoc` with `public: true` (F102 stage 01) when F102 stage 01 landed." Listed for the coordinator.
- Not verified (review): `generateSpecs` on a root-app route (plan.md N3, T9 proves it).
