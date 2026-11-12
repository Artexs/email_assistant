# S5a plan — second cold review (2026-11-08)

Part of [`../plan.md`](../plan.md). A separate session (Claude Code, Opus 5.5) reviewed the plan at `7ed35eb`: the segment file, the 15 stage files and the dated D-lines of the master plan `spec/features/done/2026-11/F007-s5-web-panel/plan.md`. Handoff: `~/.pi/agent/notes/2026-11-08-handoff-s5a-plan-review.md`. The first review (35 findings) is in the segment file, "Cold review result".

**VERDICT: FAIL** — blocker 0, major 2, minor 16. The user's go: "Okay, apply the fixes as you decide and propose." All 18 are fixed in the same commit. After the fixes the plan is ready to build.

## Checks

- `git status`, `git log HEAD..origin/master` → clean, up to date at `7ed35eb`.
- Bun: `new URL("/\t/evil.test", "http://ea.test").href` → `http://evil.test/` (the same with `\n` and `\r\n`; `/%09/evil.test` stays on the origin).
- Probe (Chromium 155, the built S5a meta CSP, a copy of the cold review's Astro folder in `/tmp/ea-s5a-review2/web`, scripts in `/tmp/ea-s5a-review2/scripts/`): an island with a module-level `z.object(...)` → one `securitypolicyviolation` event (`script-src`, `eval`) and no console text; the same island with `z.config({ jitless: true })` evaluated first → no event; the plain island → no event. Segment fact 23.
- `node`: `jsx-a11y` `flatConfigs.recommended["jsx-a11y/no-autofocus"]` → `"error"`.
- Better Auth 1.7.18 source (`/tmp/ea-s5a-probe/node_modules/better-auth/dist`): `api/middlewares/origin-check.mjs:78` logs `` `Invalid ${label}: ${url}` `` at `error`; `api/routes/password.mjs:96` runs that check on `GET /reset-password/:token`; `api/rate-limiter/index.mjs`: the default special rule (`/sign-in*`, 3 per 10 s) still applies next to `customRules`, so W9 is right.
- Zod 4.6.7: `zod/v4/core/util.js:218` (the `new Function` probe, skipped under `jitless`), `schemas.js:1196` (it runs when an object schema is created).

## Findings and fixes

1. [major] `stage-11:16`, `stage-05:54`, W8 — `safeNextPath("/\t/evil.test")` passed the "one `/`, not `//`" check, and the URL parser drops tab, LF and CR, so the sign-in redirect left the origin (open redirect through `/login?next=/%09/evil.test`). → Fixed: one six-step rule for `safeNext` and `safeNextPath` (control characters → `/`; `new URL(value, "http://x.invalid")` must keep the origin; the `/login` and `/setup` rule on the resolved pathname); new test cases in stages 5 and 11; W8 and D3 dated.
2. [major] user step 0, `stage-01:7` — the own build database depended on a user edit with no pause and no check; with the copied `.env`, stage 1 would migrate the shared dev database and stages 3, 4 and 8 would commit rows there. → Fixed: step 0 is a pipeline pause; the "database guard" (`bun -e` prints the two database names, which must be `/email_assistant_s5a`) runs before every Check that uses the database (stages 1–6, 8, 10.2, 11.3, 12).
3. [minor] `stage-13:26` — the global setup ran `db:migrate` before the seed's guard. → Fixed: `e2eEnv()` calls `seedTargetOk` and throws before any command (stage 13, W10).
4. [minor] W16, `stage-03:39` — Better Auth logs the raw `callbackURL` of the public `GET /reset-password/:token` at `error`; no test saw it. → Fixed: `cleanLogText` (control characters, URLs → `<url>`, 200 characters) in stage 3 with unit test 10; stage 8.2 test 2 sends marker values through the real instance; stage 15.2 gets the alert; D1 dated.
5. [minor] W1, `stage-05:64` — `clientAddress` skipped a non-IP hop and walked on into client-controlled entries. → Fixed: a non-IP entry ends the walk and returns the peer; a new test case.
6. [minor] `stage-13:45`, stage 7 — Zod 4's eval probe is a CSP violation on every page that loads `@ea/core/web`, and the console-text check cannot see it. → Fixed: `packages/core/src/web/zod.ts` with `z.config({ jitless: true })`, imported by every `core/web` file; `cspErrors` records `securitypolicyviolation` events; fact 23; W18, W20, D5, D17 dated.
7. [minor] `stage-08:70` against `stage-06:13` — the 503 for a missing dist sat after the page gate, but stage 8.2 expected 503 without a session. → Fixed: with the dist missing, one `GET`/`HEAD` handler replaces steps (8)–(10); stage 6 test 8 adds `GET /mailboxes` → 503; W8.
8. [minor] `stage-09:158` — the first state of `useResource` was not named, but stage 10.2 greps the prerendered skeleton. → Fixed: `{ data: null, error: null, loading: true }` (stage 9, W19).
9. [minor] `stage-07:71`, W18 — `formatTime` duplicated `formatClock` of `packages/core/src/digest/local-time.ts:107`. → Fixed: `@ea/core/web` re-exports `formatClock`; `web/time.ts` and its test are gone; D17 dated.
10. [minor] `stage-12:39` — the seed needs `insertUser` and `insertMembership`, which `tenancy/index.ts` does not export. → Fixed: stage 12 exports them; the seed's repo root is named.
11. [minor] W10, W8 — the W-lines differed from stages 13 and 5/6 (`LOG_LEVEL`, two empty keys, the launch options, "`next` is dropped"). → Fixed: aligned with the stage files.
12. [minor] `stage-10:27`, `stage-13:46` — `aria-label="Main"` was a literal. → Fixed: key `nav_main` in `en.ts`.
13. [minor] master plan D1, D3, D5, D17, "Not verified" — stale stage numbers and names. → Fixed with dated sentences.
14. [minor] `stage-11:25` — `autoFocus` fails `jsx-a11y/no-autofocus`. → Fixed: removed.
15. [minor] `stage-13:51` — `en.password_too_short` is a substring of `en.password_help` (strict-mode error). → Fixed: field errors carry ids (`password-error`, `repeat-error`, `email-error`; stage 11.2) and the test reads them by id.
16. [minor] `stage-07:48,84` — no guard kept Node modules out of the browser bundle, and "stage 9's build is the proof" was wrong (no page imports `@ea/core/web` before stage 10). → Fixed: `me.ts` imports from `../tenancy`; greps in stage 7 and on `dist/_astro` in stages 10.2 and 11.
17. [minor] `stage-14:28` — the e2e job ran Playwright on the runner's default Node. → Fixed: `actions/setup-node@v4` with Node 24.
18. [minor] segment "Planning progress" — the commit item was unticked although `4c3f547` and `7ed35eb` were pushed. → Fixed: ticked, plus the item for this review.

## Notes

- Both defaults stand: `'unsafe-inline'` on `style-src` (CSS cannot exfiltrate because `img-src`, `connect-src` and `font-src` are `'self'`; React escapes mail text) and the `task/**` CI trigger (every task-branch push runs the `ci`, `e2e` and `image` jobs: more Actions minutes, nothing is published).
- Also fixed without a number: `c.req.routePath` is deprecated in Hono 4.13.16; W8 and stage 6 use `routePath(c)` from `hono/route`.
- Left as they are: stage 6 is the largest `[risky]` step (close to the 300-line guide); Playwright may start the server before the global setup migrates the e2e database, so on the first local run the jobs log errors until the migration ends (harmless).
