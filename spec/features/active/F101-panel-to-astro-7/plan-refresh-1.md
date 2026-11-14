# F101 · Plan refresh 1 (2026-11-14)

- Old base: `a72b214` (the `Refresh:` line of `ticket.md`; `plan.md` had no `Plan base:` line; the plan files landed first in `a50942b0`, one commit later, with no code change between).
- New base: `560e74e7` (HEAD of `master` at the job start).
- Verdict: the plan holds at HEAD. No decision, owner answer, default, interface, schema or stage order changed. Changes: page count 16 → 18, one test compare made robust, the lock lists extended, and the lean trim of `.agents/limen/planner.md` § Plan size.

## Drift output (`bash scripts/plan-drift.sh spec/features/active/F101-panel-to-astro-7 a72b214`, run on the plan before the trim)

```
plan base: a72b214c 2026-11-14 07:21
HEAD:      560e74e7 2026-11-14 23:52
named paths: 15; changed since base: 5; gone: 0
changed: apps/server/src/platform/http.ts
changed: apps/server/src/web.ts
changed: apps/web/package.json
changed: apps/web/src/pages/operator.astro
changed: deploy/README.md
commits listed: 24 (F092 s03; F095 s05; F097 s01; F098 s04; F099 s06.1–s14; F100 s07, s12, s14; F105 s03–s14; F106 s03, s10; F085 s07; c5334c40 deploy README export owner)
```

The script does not see `.github/`, `docs/`, `notes/`, `README.md` or `bun.lock`. They were checked by hand (below).

## Per changed path

- `apps/server/src/platform/http.ts` (F092, F099, F105, F106): `PUBLIC_PAGE_PATHS` still holds `/^\/_astro\//` (facts F4); the page guard still redirects to `/login?next=<encoded path>` (stage 04 check 5); `web_dist_missing` still exists (check 6). New: `OPERATOR_PAGE` guard with 404 and the TOTP redirect; it touches no static file or CSP. No change.
- `apps/server/src/web.ts` (F098, F099, F100, F105, F106): the log lines `web is on: …` and `web is off …` still exist (check 6); new routes only. No change.
- `apps/web/package.json` (F105 s10): adds `"uqr": "0.1.3"`. The four D1 lines are unchanged (`^5.13.7`, `^4.3.1`, `^4.1.13` ×2). Stage 02 now says every other line stays, `uqr` included, and T3 checks `uqr@0.1.3`.
- `apps/web/src/pages/operator.astro` (F099 s10): a new page. It and `stats` (F100 s18) raise the page count to 18. Both build on Astro 7 with the same markup and CSP (facts R1). Change: `16` → `18` in the plan Proof and stages 01, 02.
- `deploy/README.md` (F085, F100, F105, F106, c5334c40): § Update steps 1–4, § Logs ("a recreated container starts empty"), the `backup ok <name> <bytes>` line, § Web panel → Roll back: all unchanged. New sections (two-factor, account data, LLM budget, `host_blocked`) do not touch this deploy. Stage 04 "Before the deploy" now names F105 and F106 runbook steps as the likely other-ticket steps.

## Paths outside the script, checked by hand

- `bun.lock` (F105 `uqr`, F106 `age-encryption`, F119 `@better-auth/sso`, +63 lines): no Astro, Vite or Tailwind entry changed. Re-probe R1: the Astro 7 change gives the same +316 −472 lines and the same versions as F8. T3 adds `uqr`, `age-encryption`, `@better-auth/sso` to the unchanged list.
- `apps/web/astro.config.mjs`, `apps/web/integrations/csp-style-src.ts` and its test, `apps/web/src/styles/global.css` (one `@theme inline {`), `.github/workflows/ci.yml` (jobs `ci e2e image`, one `setup-node` in `e2e`), `deploy/Dockerfile` (`oven/bun:1.4.4`, no Node), `scripts/limen-prepare.sh`, `apps/web/e2e/env.ts`: unchanged since the base.
- e2e: new specs `account-delete`, `two-factor`, `language`, `polish`; `helpers.ts` adds locale texts to `signIn`. The test "the pages keep the CSP and show the 404 page" still exists (it now expects the Polish 404 title). The address blocks of the new specs (F105 50/150, F106 0/220) do not matter: F101 adds no spec.
- `docs/capabilities/web-panel.md`: the limit line "The build uses Astro 5 …; the move to Astro 7 is F101." and the static-build item 10 exist (stage 03 Step 2). `docs/architecture.md` was restructured, but §7 still has the `**CSP (D5):**` bullet with the sentence stage 03 extends. ADR 0016 still holds the `experimental.csp` consequence and the S6b amendment. `README.md` `web:dev` row and the note's pin line and "So a maintained Starlight …" line exist.
- Module graph and `layers.json` (`apps/server/src/modules/`): server only; no stage touches them.
- New migrations of other tickets: stage 04 step 8 runs them; their runbooks hold their checks.
- Other tickets did no step of this plan: `astro` is still `^5.13.7`, `experimental.csp` is still in the config, no `cspProblem` or `checkDist` exists.

## Changes

- plan.md: status line `Plan base: 560e74e7, refreshed 2026-11-14`; Proof uses `18`, page-count rule names the base; D12 names F105, F106, F119, F102 (F098, F099 landed); facts F1–F13 moved whole to `probes/facts.md` with the new R1; Input, Review, How to run and Cold review cut to the lean form; the e2e DB recipe moved to stage 02 Step 3 (only stage 02 runs e2e); Log line.
- Stage 01: `16` → `18`; test numbers written `T1`–`T17` (prettier renumbers a list that jumps from 8 to 14); text cut, no test or interface change.
- Stage 02: `16` → `18`; T3 adds `@better-auth/sso@1.7.18`, `uqr@0.1.3`, `age-encryption@0.3.1`; T8 compares only the `<` and `>` lines of `vars.diff`, because new classes moved the hunk headers (R1: the lines are equal, the headers are not, so the old "diff prints nothing" would fail); e2e DB recipe moved in; edit text cut.
- Stage 03: the note bullets name facts in place of full text; the ADR amendment point 3 points to the D4 cases (it now also covers `-elem`, `-attr`, `'unsafe-eval'`); text cut.
- Stage 04: runbook and checks kept; command text cut; "Before the deploy" names F105 and F106.
- `probes/facts.md`: new file, the old § Facts checked of plan.md plus R1.
- questions.md: no change (no new question).

## Sizes (`wc -w`)

plan.md 1,495; stage 01 693; stage 02 695; stage 03 698; stage 04 664.

## Review

No cold review: no interface, schema, migration, step or stage order changed. The T8 change only drops hunk headers from a compare; the page count is a value change.
