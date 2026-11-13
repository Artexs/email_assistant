# F089 plan review 1

> Cold review job `2026-11-13-f089-plan-review-be9736b8` (Opus 5.5, thinking high), candidate `5f3948a`. Its final message, filed whole below. The fixes are in `plan.md` § "Cold review".

FAIL 5f3948aae462e567bd1f79a371d5519d2cbb4bbc

The plan cannot pass its own stage proofs as written. It has 5 major findings, and 4 of them break a test suite or the stage 07 docs. HEAD is 5f3948aae462e567bd1f79a371d5519d2cbb4bbc, which matches the candidate. No code changed between the plan's probe commit 88df1c5 and HEAD (`git log 88df1c5..HEAD -- apps/server/src` is empty).

## Blocking findings (major)

**M1 — Stage 01 breaks the unit and integration suites.** Proven by reading the code plus an env check.

- Stage 01 makes `json` the default when `LOG_FORMAT` is unset (stage-01-writer.md:78, plan.md:51).
- The test preload sets `text` only in stage 02 (stage-02-format-and-context.md:150, :166-173).
- The main checkout `.env` has no `LOG_FORMAT`: `grep -c '^LOG_FORMAT'` gives 0. `scripts/limen-prepare.sh:29` copies that `.env` into the job.
- So during stage 01, old-form lines become JSON `legacy_text` lines. These tests then fail:
  - `apps/server/src/platform/llm/client.test.ts:238` (`line.startsWith("[llm]")`, a unit test)
  - `apps/server/test/integration/triage-logs.test.ts:119` (`call[0] === "[llm]"`)
  - `apps/server/test/integration/telegram-logs.test.ts:224` (`toContain("[telegram]")`)
  - `apps/server/test/integration/retention-job.test.ts:105` (`/^\[retention\] …/`)
  - `apps/server/test/integration/mail-connect.test.ts:468`
- Stage 01 "Done when" asks for these suites to pass (stage-01:130), and its Proof runs test:unit and test:int.
- Stage that lets it through: 01. Fix: move the preload lines (`process.env.LOG_FORMAT = "text"`, `setLogFormat("text")`) into stage 01.

**M2 — D11's claim that "the CLI tests that spawn scripts see the text form" is false for a spawn without `env`.** Proven by a probe (`/tmp/f089-review/probe-env.ts`).

- On Bun 1.4.4, a `Bun.spawn` without `env` does not see a change the parent made to `process.env`. The probe printed `no env: undefined`, `with env: "text"`. The repo says the same at `mail-check.test.ts:291`.
- `apps/server/test/integration/tenancy.test.ts:179` spawns `org-create` with no `env`, from `repoRoot`. The child loads `.env` (no `LOG_FORMAT`) and prints JSON.
- `tenancy.test.ts:191-192` expects `/\[org-create\] created org (\S+) user (\S+)/` to match. It gets `null`.
- This fails in every stage proof from 01 on, and in CI (no `.env`; `ci.yml:58` runs test:int).
- Sources: plan.md:51, stage-02:170 and :277 ("no existing test changes"). Fix: stage 02 passes `env: { ...process.env }` at tenancy.test.ts:179 and checks the other spawns with no `env` (`mail-password.test.ts:227` still passes: its check is a substring).

**M3 — `route` values with `*` are dropped, so many access lines get `dropped_fields`.** Proven by a probe (`/tmp/f089-review/probe-route.ts`, Hono from the lockfile).

- `routePath(c)` in the outer access-log middleware returns:
  - `"/api/*"` for the 403 `bad_origin` and the `/api` 404
  - `"/api/auth/*"` for every auth call
  - `"/*"` for the page and static middleware
- D7 allows only `^[A-Za-z0-9_.:/-]*$` (plan.md:47), so it drops `*`.
- Effect: the `http_request` and `http_error` lines of stage 05 (stage-05:101-102) lose `route` and get `dropped_fields=1` on all those requests.
- Stage 07 then writes known-alerts headings that never match a real line: `http_error route=/api/auth/* …` (stage-07:384) and the 403-burst entry (stage-07:388). Stage 07 also states "a line with `dropped_fields` is a bug to fix" (stage-07:320).
- No test catches it: stage 03 test 7 uses `/health`, test 8 uses `/api/me`, and stage 01 test 5 tests only `/api/mailboxes/:id`.
- Stages that let it through: 01 (D7) and 05. Fix: allow `*` in D7, or normalize the route, and add `{ route: "/api/*" }` to stage 01 test 5.

**M4 — Stage 05 misses a test that its conversion breaks.** Proven by reading.

- `apps/server/test/integration/web-terms.test.ts:225` keeps only lines that contain `"terms record"` and expects 1 (:226).
- Stage 05 changes `platform/auth.ts:311` to `terms_record_failed` (stage-05:29). That string has no `"terms record"`, so the filter finds 0 lines.
- This file is not in the stage 05 files or tests (stage-05:15, :70-76). plan.md:78 says "12 test files".
- By plan rule plan.md:127 the worker must stop with a question. Fix: add web-terms.test.ts:225 to stage 05 step 1.

**M5 — F087 stages that build after F089 stage 06 will fail the lint.** Proven by reading both plans.

- F087 stage 2 tells the worker to write ``log.info(`features off by FEATURES_OFF: …`)`` in `main.ts` (F087 stage-02-table-and-read.md:85).
- F087 stage 4 tells the worker to write ``log.warn(`operator route refused for user ${userId}`)`` in `platform/http.ts` (F087 stage-04-operator-guard.md:32, test at :74).
- After F089 stage 06, these files are at `error` (stage-06:204-212), so `bun run lint` fails in the F087 proof.
- The ticket gate (ticket.md:42) only stops parallel builds. How-to-run step 8 (plan.md:201) only covers branches that are open at the land.
- `07-foundation-plan.md:31` lets F089 sit in either lane, so this order can happen. Fix: a How-to-run step that gives each later F087 or F090 spawn the event form to use. Stage 06 already writes `features_off` and `feature_killed`.

## Minor findings

- **m1 — The counts are off (proven by an ESLint probe with the stage 04 selectors, `/tmp/f089-review/probe-count.mjs`).**
  - The probe finds 427 old-form calls, not 428: mail has 29, not 30 (plan.md:73, :86; stage-04:200).
  - So the stage 06 backlog is 381, not 382 (stage-06:234).
  - "24 calls" (stage-05:7, plan.md:178) does not match the 25 rows of the stage 05 tables (12 + 13, with `auth.ts:444`).
  - A worker may report the gap as a question.
- **m2 — Two rules conflict (proven by reading).** Stage 07 writes "Never pass `job`, `run_id` or `request_id` by hand" (stage-07:322). Stages 03 and 06 pass `job` by hand: `job_skipped` and `job_failed` with `{ job: name }` (stage-03:34, :36) and `job_scheduled` with `{ job: … }` (stage-06:177-179).
- **m3 — ADR 0024 and the code patterns will disagree.** ADR point 1 says errors reach a log "only through `describeError()`". D14 replaces that with `errorFields`, but stage 07 adds only a Progress line to the ADR (stage-07:337). After the land, ADR 0024 and code-patterns give two different rules.
- **m4 — The gate has holes.**
  - The F090 plan input stage 1 edits `scripts/job-run.ts` and `.env.example` (F090 plan.md:26). F089 stage 03 and stage 02 edit those files, but ticket.md:42 does not gate them.
  - F087 stage 3 (`deploy/README.md`), stage 5 (`code-patterns.md`) and stage 6 (all four docs plus `known-alerts.md`) overlap F089 stage 07, with no gate.
  - F090 has no `stages/` folder, so "F090 stage 1" (D27) has no source except the plan input.
- **m5 — The type does not check field names (proven by a tsc probe, `/tmp/f089-review/ov.ts`, exit 0).**
  - The `@deprecated (...args: unknown[])` overload accepts `log.info("sync_done", { subject })`, so a field outside the list compiles. The list is checked only at run time.
  - Plausible: D7 also passes a single-word secret, such as the 46-character form `digits:[A-Za-z0-9_-]` of a Telegram token or a Gemini key. So D2's "mechanical form of … no secrets" claims too much; the guard is the name list plus review.
- **m6 — Plausible: stage 03 test 11 can fail on a line from outside any context.** `webTestApp` defaults `dist` to `/nonexistent/dist` (web-helpers.ts:44), so `createApp` logs `web: dist folder missing` with no context. If the worker builds the app inside the spy window (the web-me pattern `appFor(ids).request(…)`), test 11 fails. Stage 03 step 3 should say: build the app before the spies.
- **m7 — Unverified: two behaviors under the CI Bun version.** `bun --no-env-file` (stage 06) and the AsyncLocalStorage behavior are not shown under CI Bun 1.3.14 (ci.yml:45). plan.md:98-102 "Not verified" lists only ESLint.
- **m8 — The acceptance "every response has `x-request-id`" has only a partial repo test.** Stage 03 test 6 covers `/health`, 404 and 500 with `web: null`. Raw `Response`, redirect, 413 and static responses are shown only by probe P2, which is not kept as a test.
- **m9 — Plausible: a stale id on a later line.** P1 did not test a timer or socket created inside one context whose callback fires later. Such a line would carry a stale `run_id` or `request_id`.
- **m10 — Note, outside the plan's scope:** `bunx prettier --check` warns on 10 files in the F089 folder. The F086 and F087 folders warn on 6 files.

Pre-mortem answers by category:

- No stage is too big. Stage 05 is about 280 lines in 2 steps.
- A Sonnet worker would have to guess at M4, m1 and m6.
- These code claims match the repo at HEAD:
  - the line numbers of all 46 plus 1 calls
  - P4 (lint-staged and `eslint .` have no `--max-warnings`)
  - P7 (the jq output, checked again)
  - the compose `environment` block
  - the `.env.example` `LOG_LEVEL` line
  - the 16 known-alerts headings
  - the styleguide, code-patterns and architecture strings
  - D18's selectors: the probe confirms the warn/pass cases. It also shows `this.log.*`, `deps.log.*` and `log["info"]` are not seen; there are none in `src` today.

## Checks run

- `git rev-parse HEAD` → 5f3948aae462e567bd1f79a371d5519d2cbb4bbc.
- `bun install --frozen-lockfile` → 967 packages installed.
- `/tmp/f089-review/probe-route.ts` (Hono `routePath`) → `/api/*`, `/api/auth/*`, `/*` for 403, 404, auth and page requests.
- `/tmp/f089-review/probe-lint.mjs` (the stage 04 selectors, 17 cases) → as P3 says, plus the misses listed in the pre-mortem answers.
- `/tmp/f089-review/probe-count.mjs` (the selectors on `apps/server/src`, tests ignored) → 427.
- `/tmp/f089-review/probe-env.ts` (env passed to a spawn) → a spawn with no `env` does not see the change to `process.env`.
- `/tmp/f089-review/ov.ts` with `tsc --strict` → exit 0: the overload accepts a field outside the list.
- jq 1.8 on sample lines → output as P7 says.
- `grep -c '^LOG_FORMAT'` on the main `.env` → 0.
- `bunx prettier --check` on the F089 folder → 10 files warn.
- I did not run lint, typecheck or the test suites: the candidate is plan text only.

Verdict: FAIL. Major: 5. Minor: 10.

## Note check

- Each code claim is checked against the repo at 5f3948a, with file and line per finding: proven. Evidence: the one && chain `git rev-parse HEAD && bun /tmp/f089-review/probe-route.ts && bun /tmp/f089-review/probe-env.ts && bun /tmp/f089-review/probe-count.mjs && grep -nF '"terms record"' apps/server/test/integration/web-terms.test.ts && grep -nF 'org-create\] created org' apps/server/test/integration/tenancy.test.ts && grep -nF 'startsWith("[llm]")' apps/server/src/platform/llm/client.test.ts && grep -nF 'operator route refused' spec/features/planned/F087-feature-flags/stages/stage-04-operator-guard.md && grep -nF 'Bun.spawn(["bun", orgCreateScript' apps/server/test/integration/tenancy.test.ts` exited 0. It backs M1–M5 and m1. The other file:line quotes come from the reads earlier in this session.
- The pre-mortem categories are answered (gaps, rule conflicts, Sonnet-guess steps, unsourced facts, F086/F087 collisions, too-big stages): proven. Evidence: this message, the "Blocking findings", "Minor findings" and "Pre-mortem answers by category" sections.
- Line 1 is `FAIL <sha>`, and the message ends with the verdict and the counts: proven. Evidence: `/tmp/f089-review/final.md`, checked with `grep -n '^FAIL 5f3948aae462e567bd1f79a371d5519d2cbb4bbc$' /tmp/f089-review/final.md && grep -n 'Verdict: FAIL. Major: 5. Minor: 10.' /tmp/f089-review/final.md`, exit 0.
- Easy-to-miss rule "Confirm `git rev-parse HEAD` matches the candidate": followed. Evidence: `git rev-parse HEAD` printed 5f3948aae462e567bd1f79a371d5519d2cbb4bbc as the first command of the && chain above, which exited 0.
