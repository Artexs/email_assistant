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
- Stage 07 Step 2: no spec at HEAD opens Stats or Operator, so T2 could not hold. The stage adds `stats.spec.ts` and `operator.spec.ts` (password session: F119 stage 05 refuses an SSO session on the console); Q20 (new, minor default) when the e2e operator needs more than the seed and env.
- plan.md § Rules: ADR 0016 amendment rule for pages (no `is:inline` script, no `on*=` attribute; `security.csp` hashes only Astro's scripts; a new page's spec asserts `cspErrors` empty).
- plan.md F1: `zod` resolves to 4.6.7 in the lock (the range is `^4.1.12`; same at both bases). F2: the lock has `playwright-core` 1.65.0. New F8: Astro 7.4.12; `csp checked in 18 page(s)` at HEAD.
- Stages 12, 17, 18: fixed page counts `csp checked in 19 / 20 / 21 page(s)` (one more than before each stage).
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

The stage 01 interface changed (`routeGaps` input and the walked app), so cold review 2 runs: [plan-review-2.md](plan-review-2.md).
