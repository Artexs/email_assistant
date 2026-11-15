# F102 plan review 2 (refresh 1)

Job `2026-11-15-f102-plan-review-refresh-1-76eadb92`, `claude-opus-5-5`, thinking high, on `cbc2c007`. Final message, whole:

PASS cbc2c007575cf11e189f1ccefa37db1dde6dc822

The refresh holds against the code at HEAD. Nothing blocks. One proven gap in stage 01 needs a fix before stage 01 starts (N1). One proven rule conflict needs a fix before stage 12, 17 or 18 runs (N2).

HEAD: `git rev-parse HEAD` = cbc2c007575cf11e189f1ccefa37db1dde6dc822 (saved in /tmp/f102-rev/head.txt). This is the candidate. The tree was clean.

## Blocking findings
None.

## Unverified checks
- I did not try to seed an e2e operator user or run the existing e2e suite. Stage 07 depends on the operator user, so its Q20 fallback stays unverified (see N3).
- I did not verify that `hono-openapi` `generateSpecs` puts a route mounted on the outer app before the guards into the file (T9). F1 covers only nested routers.

## Notes

**N1 · proven (probe, /tmp/f102-rev/route-probe.log) · gap and guess step: stage 01 Step 2 and stage 03 T6.**
- Stage 01:26 says only `/api/*` keys count, and a key is `"<METHOD> <path>"`. But the walk of the whole `createApp` app also returns middleware and the catch-all.
- Probe: I built `createApp` with one router `GET /me` and printed `app.routes`. It gave `ALL /api/*` six times and `ALL /api/operator/*` once. These come from:
  - bodyLimit and origin at `platform/http.ts:124,126`;
  - requireSession, requireTenant, requireOperator and refuseSuspendedWrites at :140-143;
  - the catch-all 404 `api.all("*")` at :145.
- The old `apiRouters` walk could not see these. The module routers have no `.use` (`modules/operator/routes.ts:31`), so the refresh brought this in.
- Without a rule, T8 (`undescribed = []`) fails at once. A Sonnet worker must then guess: filter method `ALL`, hide the keys with a reason, or dedupe.
- Stage 03 T6 (stage-03:76) cannot hold unless these keys are left out. It also does not say if "route keys" is a set or a list, and `ALL /api/*` repeats.
- Decide now. Suggestion: middleware entries (method `ALL`, path ends in `*`) do not count. A real route never uses `.all` or `.on` with `*`; the test asserts this, so a filter cannot hide a real route. Count keys as a set.

**N2 · proven (plan dependency graph) · two rules conflict: stages 12, 17, 18.**
- The stage files expect `csp checked in 19 / 20 / 21 page(s)` (stage-12:38, stage-17:38, stage-18:43). They also say "one more than before the stage". F8 is at plan.md:47.
- These numbers assume the land order 12 → 17 → 18. The Needs lines do not force that order:
  - 12 needs 07 and 11, and 11 needs 09 and 10 (plan.md:103-104);
  - 17 needs only 07 and 14, and 14 needs only 01 (plan.md:107,109);
  - 18 needs 16 and 17, not 12 (plan.md:110).
- So stage 17 can land first and see 19, which breaks its fixed "20". Stage 18 can also run before stage 12.
- Fix: keep the relative rule only (before + 1, both numbers in the final message), or add "needs 12" to stage 17.
- The base count holds: `bun run web:build` at HEAD logged `csp checked in 18 page(s)` (/tmp/f102-rev/web.log:36). No other active ticket adds an `.astro` page (grep of the other tickets' stage files).

**N3 · proven in part (code read) · fact without a source and a guess step: stage 07 Step 2, Operator (stage-07:20), Q20 (questions.md:30).**
- The plan asks for "a seeded TOTP user in the e2e `OPERATOR_USER_IDS`". Three facts work against this:
  - The server reads `OPERATOR_USER_IDS` at boot (config). Playwright starts the web server before `globalSetup` runs the seed (`apps/web/e2e/global-setup.ts:5`).
  - The seed wipes the users and makes them again with ids that the DB generates. `insertUser` takes no `id` (`modules/tenancy/repo/users.ts:7-19`).
  - The seed writes no TOTP secret. `two-factor.spec.ts` turns TOTP on through the UI.
- So the operator needs a fixed UUID in `e2e/env.ts`, an insert with that id, and TOTP turned on in the spec or the seed. The plan says none of this.
- The Q20 test "more than the seed and the env" is a judgment call, so the worker must guess. Decide: fixed id plus UI enrolment through `e2e/totp.ts`, or skip Operator now.
- Q20 also strains P3 (plan.md:15, "axe on every panel page", "do not reopen"). Record that Q20 narrows P3 to the customer pages.

**N4 · plausible · missing interface: stage 01 Step 1, Step 2 and T9 (stage-01:12,26,39).**
- `GET /api/openapi.json` lives inside the inner `api` router. For the public route to appear in the file, it must walk the outer `createApp` app. The plan names no interface that gives the handler the outer app. It also does not say if `routeGaps` gets its `spec` from the served file or from `generateSpecs`.
- T9 uses "a fake app", so it does not test the real wiring in `createApp`. A worker can build the spec from the inner `api`, and T1–T9 still pass.
- At HEAD no route sits before the guard (`grep sign-in-options apps` finds nothing). So the bug shows only when F119 stage 11 lands, in the F119 worker's job.
- Fix: name the builder (for example `openApiSpec(root)`), and run T9 against `createApp` itself.

**N5 · proven (file read) · fact without a source: plan.md:70.**
- The rule "no `is:inline` script, no `on*=` attribute (`security.csp` hashes only Astro's scripts)" cites "ADR 0016 amendment". The Astro 7 amendment (`docs/decisions/0016-…md:67-74`) does not say this.
- Grep of notes/, docs/ and F101 finds no source for "hashes only Astro's scripts".
- The rule is safe, because `cspErrors` catches a break. But either give its source (an F101 probe) or mark it as a plan rule.

**N6 · proven (e2e read) · edge case: stage 07 Stats spec (stage-07:20, "seed org with `stats_page` on").**
- The plan does not say which organization. With `stats_page` on, the nav adds a Stats tab (`components/shell/nav-items.ts:31-35`).
- `auth.spec.ts:58` expects exactly 4 phone nav links for the main seed org. A flag on that org breaks it.
- Decide: use its own org (as the `org_delete` orgs, `e2e-seed.ts:200`), or update auth.spec in the stage.

**N7 · plausible · missing decision: D6 and Q19 (plan.md:27, questions.md:29).**
- `GET /api/sign-in-options` is public, and every other operation needs a session. The plan does not decide if the file marks this: a security scheme, plus `security: []` on public routes.
- E10 publishes this file (Q14), so a client generated from it may send a cookie or refuse the call.

**N8 · plausible · cross-ticket gap: F119 stage 11.**
- `spec/features/active/F119-e7-t7-identity-b-oidc/stages/stage-11-read-surfaces.md:9` mounts the route in `platform/http.ts` but says nothing about `apiDoc`.
- If F119 stage 11 lands after F102 stage 01, T8 fails in the F119 job. Only the code-patterns line (stage-01:40) tells that worker why. It may put the key on `NOT_DESCRIBED_YET`, which stage-01:28 forbids.
- Stage 03 Step 2 handles the case where F119 lands first. The case "lands after stage 01, before 03" needs a line in F119 stage 11, or a coordinator rule.

**N9 · plausible · stage size: stage 07.**
- The refresh added two new specs and possibly a fixed-id operator user and TOTP enrolment (N3). These come on top of up to 200 lines of axe fixes and a `bun.lock` change.
- The 200-line budget covers only the fixes, not the new specs and seed work. Count the spec and seed work inside the budget, or move Operator to a later stage.

## Refresh items that hold at HEAD
- **Stage 01 lock:** probe `bun@1.4.4 add -E hono-openapi@1.6.0` in a scratch copy. It adds only `hono-openapi`, `@hono/standard-validator`, `@standard-community/standard-json` and `-openapi`, `openapi-types` and `quansync`. No version changes.
- **Stage 07 lock:** probe `add -d -E @axe-core/playwright@4.14.0`. It adds the package and a nested `@axe-core/playwright/axe-core@4.14.0`. Top-level `axe-core@4.10.3` stays. The note holds.
- **Lock versions:** `zod` 4.6.7, `playwright-core` 1.65.0, `hono` 4.13.16 and `astro` 7.4.12 match F1, F2 and F8 (bun.lock:1981,1569,1205,821).
- **Node:** the Node 22.23.4+ need has its source in `notes/2026-11-13-astro-starlight-versions.md:19`. CI pins 24 (`.github/workflows/ci.yml:49,102`).
- **Stats and Operator specs:** no spec opens `/stats` or `/operator` (grep of `apps/web/e2e/tests`). The stage 07 premise holds.
- **e2e seed:** it already uses `createCliOutput` (`e2e-seed.ts:20,57`). The stage 12 note holds.
- **SSO refusal:** `requireOperator` refuses SSO with 403 `password_sign_in_required` (`platform/http.ts:286-289`). Operator routes stay hidden.
- **Sign-in options source:** the F119 stage 11 mount is real (F119 stage-11:5-9).

## Checks run
- `git rev-parse HEAD`: cbc2c007… (/tmp/f102-rev/head.txt); `git status`: clean.
- `bash scripts/ci-bun.sh install --frozen-lockfile`: 904 packages installed.
- Route probe (temporary file under `apps/server`, removed afterwards). Output: /tmp/f102-rev/route-probe.log.
- Lock probes in `/tmp/f102-rev/lockprobe` (removed afterwards), with `bunx bun@1.4.4 add`, for both packages. The diffs are summarized above.
- `bun run web:build`: rc 0, `csp checked in 18 page(s)` (/tmp/f102-rev/web.log).
- I ran no unit, int or e2e suite. This is a plan review with no code diff.

## Note check
- Each refresh item checked at HEAD (stage 01 routeGaps and T9, stage 03 Step 2 and T6, stage 07 lockfile and Stats/Operator specs, ADR 0016 CSP rule, page counts 12/17/18, Q19, Q20): proven. Evidence: `/tmp/f102-rev/route-probe.log`, `/tmp/f102-rev/web.log`, `docs/decisions/0016-web-panel-static-build-and-better-auth.md`, `apps/web/e2e/global-setup.ts`. The lock probe diffs are quoted above; their scratch folder was removed, so they rest on this message only.
- Pre-mortem findings with file and line: proven. Evidence: `/tmp/f102-rev/findings-index.md` and notes N1–N9 above.
- HEAD matches the candidate: proven. Evidence: `/tmp/f102-rev/head.txt`.
- Easy-to-miss rule ("Missing code detail … is not a finding; a missing decision, edge case, test or interface is"): followed. Evidence: `/tmp/f102-rev/findings-index.md`. Each N names a missing decision, interface, edge case or unsourced fact; none asks only for line numbers, edit text or file lists.
