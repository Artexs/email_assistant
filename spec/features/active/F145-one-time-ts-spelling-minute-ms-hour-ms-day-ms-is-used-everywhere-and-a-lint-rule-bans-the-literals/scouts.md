# F145 scouts

Three scouts, started 2026-11-20 at base c3726de2. Packets copied whole from each job log.

## Scout 1 · `2026-11-20-f145-scout-1-73d37826`

Question:

> Which places in non-test and test code (apps/, packages/, tools/, scripts/) write a millisecond time literal for a minute, hour or day (60_000, 60000, 60 * 1000, 3_600_000, 3600000, 60 * 60 * 1000, 86_400_000, 86400000, 24 * 60 * 60 * 1000, 24 * 3_600_000 and similar), and which local copies of MINUTE_MS/HOUR_MS/DAY_MS exist? Give counts per workspace and per test vs non-test, and flag any literal that is not a time unit (bytes, counts, timeouts that read better as seconds). Also: how do modules import packages/core/src/time.ts today (import path), and can apps/web, tools/ and scripts/ import it? Context: spec/features/planned/F145-one-time-ts-spelling-minute-ms-hour-ms-day-ms-is-used-everywhere-and-a-lint-rule-bans-the-literals/ticket.md and spec/quality/2026-11-20-pass-2.md finding 5. Answer for the code at HEAD.


Packet:

Packet: Where ms literals for minute, hour or day appear, which local `MINUTE_MS`/`HOUR_MS`/`DAY_MS` copies exist, and how `packages/core/src/time.ts` is imported.
Base: c3726de2
Verified: `grep -rnE '<ms-literal regex>' apps packages tools scripts` -> 814 matching lines (saved to /tmp/h.txt); `git status --short` is empty.
Unknowns:
- The counts come from one regex and count lines, not literals. Forms like `7 * 24 * 3_600_000` count once, and `1000`-based spellings are only partly covered. Treat them as a floor, not an exact total.
- I did not split the 597 server test lines by file. About 80 of them are `60_000` test timeouts and RPM values, which are not time units.
- Every `scripts/*.sh` path under `scripts/` is a shell script, so TS import rules do not apply there. `scripts/one-off` and `scripts/test-audit` were not inspected.

1. Counts of lines with a literal (observed), test = `*.test.*`, `/test/` or `e2e`:

   | Workspace | Non-test | Test |
   |---|---|---|
   | apps/server | 100 | 597 |
   | apps/web | 5 | 19 |
   | apps/docs | 1 | 10 |
   | packages/core | 27 | 33 |
   | tools/fake-telegram | 0 | 18 |
   | tools/mail-oauth-spike | 4 | 0 |
   | scripts/ | 0 | 0 |

   Totals: 137 non-test, 677 test.
2. Time.ts and local copies (observed):
   - `packages/core/src/time.ts` exports only `HOUR_MS = 3_600_000`, `DAY_MS = 24 * HOUR_MS` and `addDays`. **`MINUTE_MS` does not exist there.**
   - Local `MINUTE_MS` copies, each `= 60_000`: `operator/slo-checks.ts:41`, `operator/slo-texts.ts:11`, `core/metrics/m5.ts:18`, `core/sim/live/bot.ts:11`, `core/sim/live/executive.ts:12`, `core/sim/plan-week.ts:42`.
   - Test fixtures: about 30 test-side copies of `DAY_MS` or `HOUR_MS` (examples: `trust-history-helpers.ts:22`, `loops-chaser-fixtures.ts:15`).
   - Differently named copies: `MIN_MS` in `replies-requests.test.ts:29`, `MINUTE`/`HOUR`/`DAY` in about 36 non-test lines (all `scripts/e2e-*-rows.ts`) and in 244 test lines, and `hour` in `testmail/send.test.ts:11`.
   - `retention.ts` already imports `HOUR_MS` from `@ea/core`.
3. Literals that are not a time unit (observed):
   - Requests per minute (RPM): `platform/llm/testing.ts:36` and `client.test.ts:39` use `rpm: 60_000`. `scripts/llm-check.test.ts:17-19` uses the string `"60000"`. `platform/llm/client.ts:54` computes `60_000 / rpm` (ms per minute, so it is a unit).
   - `fake/index.ts:119`: `Math.floor(t / 86_400_000)` computes a day number, so it is a unit.
   - Timeouts that read better as seconds: `smtp.ts:312 socketTimeout: 60_000`, `docs-shots.config.ts:16`, `e2e/servers.ts:25`, `approvals.spec.ts:400, 498`, and `60_000` test timeouts such as `comment-codes.test.ts:100` and `sim-files.test.ts:456`.
   - Test expectations that pin literal backoff values: `polling.test.ts:168-291` (`[60_000, 120_000]`, `wait_ms: 60_000`) and `eval.test.ts:256`.
   - `apps/docs/src/reference.test.ts:185, 327` holds a regex that matches the source text `(\d+) \* 24 \* 3_600_000` in `triage/service.ts`. A rewrite of that source line breaks the docs test.
   - The `1000` second-to-millisecond conversions (`fake-telegram/src/cli.ts:66, 159, 190`, `view.ts:54`, `local-time.ts:89`, `quota-day.ts:27`) are seconds, not minute/hour/day. `core/sim/live/run-plan.ts:10` has a local `SECOND_MS = 1000`.
4. Import path (observed):
   - `packages/core/package.json` exports are `"."`, `"./web"` and `"./push"`. There is no `./time` subpath.
   - The root barrel re-exports it (`packages/core/src/index.ts:15`: `export * from "./time"`). So does the web barrel (`packages/core/src/web/index.ts:40`: `export * from "../time"`).
   - Server and other app code import `HOUR_MS`, `DAY_MS` or `addDays` as `from "@ea/core"`.
   - Inside core, files use a relative path (`"../time"`, `"./time"`).
5. Who can import it (observed):
   - `apps/web` can. It depends on `@ea/core` (`apps/web/package.json:18`) and imports from `@ea/core` in 3 files.
   - `apps/docs` can (`apps/docs/package.json:13`).
   - `tools/fake-telegram` can (`tools/fake-telegram/package.json:12`).
   - `tools/mail-oauth-spike` has no `package.json`, so it cannot import `@ea/core` without a new dependency (guessed: it is imported as source by the server tree).
   - `scripts/` has no TS (only shell scripts, `one-off/`, `test-audit/`); server TS scripts live in `apps/server/src/scripts/` and can import `@ea/core`.
   - `apps/web/e2e/*` is a Playwright subtree of `apps/web`, so it likely resolves `@ea/core` too (guessed).

Checks: the grep above covers the literal spellings in the task; it misses non-`.ts/.tsx/.mjs/.js` files, multi-line forms, and variable-based arithmetic such as `24 * HOUR_MS`. I did not run lint, typecheck or tests.

## Scout 2 · `2026-11-20-f145-scout-2-646ef41a`

Question:

> How is ESLint configured in this repo (flat config file, per-glob blocks), which no-restricted-syntax rules exist today and for which file globs, and would a new no-restricted-syntax block override (not merge with) existing ones for the same files? Does the repo have tests for its lint rules (for example a test that runs ESLint on a fixture and expects an error), and what is their pattern and test lane? Can an ESLint selector match a numeric Literal by value (60000 written as 60_000) and a BinaryExpression like 60 * 60 * 1000? Context: spec/features/planned/F145-one-time-ts-spelling-minute-ms-hour-ms-day-ms-is-used-everywhere-and-a-lint-rule-bans-the-literals/ticket.md and spec/quality/2026-11-20-pass-2.md finding 5. Answer for the code at HEAD.


Packet:

Packet: How is ESLint configured, which no-restricted-syntax rules exist, and can selectors match 60_000 and 60 * 60 * 1000?
Base: c3726de2
Verified: Linter run with two selectors on a temp file outside the worktree -> `const a=60_000; ["lit"]` and `const b=60*60*1000; ["bin"]`; `git status --short` shows 0 lines.
Unknowns: Not run: the selectors inside the repo's real config, and the full `bun run lint` on the repo. The Linter test used a bare config. Another `no-restricted-syntax` block that matches the same files could change the result.

1. `eslint.config.js` (324 lines) — Flat config. It uses `tseslint.config(...)` with one array of blocks, each with its own `files` and `ignores`. Examples: line 113 and 124 for web scripts, 153 for server, packages and tools, 250 for import borders, 271-319 for per-adapter import bans. — observed
2. `eslint.config.js:208-259` — Today there is exactly one `no-restricted-syntax` block, the log-event selectors (`logEventSelectors`, lines 217-230). Its files are `apps/server/src/**/*.ts`, and it ignores `**/*.test.ts`. The comment at lines 208-209 says it is the only such rule for server files. — observed
3. Override, not merge — A later block with `no-restricted-syntax` for overlapping files REPLACES the options of the earlier one; it does not add selectors. The repo comment at lines 208-209 says so. This is ESLint's flat-config rule for rule options. A new ban for those files must therefore add its selectors into the same array (`logEventSelectors` or a shared array), or use a glob that does not overlap. I did not run a test of the override itself. — observed (comment), guessed (behavior)
4. Lint-rule tests — They exist. `apps/server/src/platform/log-lint.test.ts` and `apps/server/src/modules/borders.test.ts` both build `new ESLint({ cwd: repoRoot })`. They call `eslint.lintText(code, { filePath })` with a virtual path inside the glob. They then check `result.messages` (fatal empty, `ruleId`, message text, severity). Timeout is 30_000 ms. They are `*.test.ts` under `apps/server/src`, so they run in the `test:unit` lane (`bun run test:unit:ci`, `package.json:15-17`). — observed
5. Selector matching — A `Literal[value=60000]` selector matches `60_000` and `60000` alike, because `value` is the parsed number (output `["lit"]`). `BinaryExpression[operator='*'][left.operator='*'][left.left.value=60][left.right.value=60][right.value=1000]` matches `60*60*1000` (output `["bin"]`). It does not match `1000*60` (output `[]`). Each operand order needs its own selector. Parenthesized or folded forms are not covered. — observed

Checks: `log-lint.test.ts` and `borders.test.ts` cover the existing log-event and import-border rules via `lintText` and run in `test:unit`; they miss any time-constant rule (none exists).

## Scout 3 · `2026-11-20-f145-scout-3-02d8985d`

Question:

> Which active or planned tickets under spec/features/ (and notes/ or spec/build.md) also edit the files that hold time literals (actions/constants.ts, channels/notices/*, operator/slo-*.ts, triage/service.ts, reports/digest.ts, sim/*, eslint config), and which ones split big files (for example the pass-2 ticket that splits files over 400 lines) or change the ESLint config? What does docs/product/stage-2/05-execution-plan.md or 07-foundation-plan.md § 2 say about F145 sequencing (Plan after / Build after / gate)? Context: spec/features/planned/F145-one-time-ts-spelling-minute-ms-hour-ms-day-ms-is-used-everywhere-and-a-lint-rule-bans-the-literals/ticket.md. Answer for the code at HEAD.


Packet:

Packet: Which tickets touch the time-literal files, split big files or change ESLint, and what the stage-2 docs say about F145 sequencing
Base: c3726de2
Verified: `rg -n "F145" docs/product/stage-2/ spec/build.md notes` -> no match in docs/product/stage-2, build.md or notes (the only hit was the ticket and pass-2 files)
Unknowns: F145 has no `## Sequenced` section, no NEXT line in `spec/build.md`, and no wave or slot in `notes/2026-11-20-replan-parallel.md`. Its `ticket.md` is still the empty template (observed). I did not read the F115 stage files or the F125 audit data in detail. They mention these paths, but only in audit tables and scout notes.

1. `docs/product/stage-2/05-execution-plan.md:114-128` and `docs/product/stage-2/07-foundation-plan.md:27-34` — F145 is in neither file, so there is no "Plan after", "Build after" or gate for it. The only rules are generic. §2.3 says to start the first NEXT ticket whose `Sequenced` tickets are done and whose gate is done. Line 126: "File overlaps in plan gates are advisory". The F145 ticket says "plan with the planner role after the current planner round" — observed
2. `planned/F143-…-split-by-aggregate-and-a-lint-check-warns-over-400-and-fails-over-800` — this is the pass-2 ticket that splits files over 400 lines and adds a lint check at 400 (warn) and 800 (fail). It is an empty template. Per `spec/quality/2026-11-20-pass-2.md:56-59` it splits these files, which F145 also edits: `reports/digest.ts` (211→457), `channels/commands.ts` (443), `texts/notices.ts`, `notices/views.ts`. It also splits `main.ts` and the delegation, audit and privacy files. It adds an ESLint rule, so it overlaps F145's ESLint rule. Strongest overlap — observed
3. `planned/F150-stale-state-statements-and-bare-codes-…-lint-rule-covers-them` — its goal is to extend an existing lint rule (the bare-codes rule) to strings, JSON and docs (`pass-2.md:144-148`). It is an empty template. It edits ESLint config, so it conflicts on the config file with F145 — observed (the ticket title and the pass-2 text); the config file path is guessed
4. `planned/F147-one-operator-alert-path-with-texts-in-core-and-one-locale-type-exist` — pass-2 finding 8 (`pass-2.md:96`) moves `operator/slo-texts.ts`, `operator/slo-job.ts` and `channels/operator.ts` texts into core. F145 edits `operator/slo-checks.ts:38-41` and `operator/slo-texts.ts:11`. Overlap on the slo files — observed
5. Active tickets: F129 edits `eslint.config.js`. `stages/stage-02-list-test-lint.md:44-45` adds `no-restricted-properties` for `process.exit` and `process.stdout.write`. `stages/stage-16-close.md:9` edits `eslint.config.js` again (the close stage). Both come before or beside F145's rule. F142 (`stages/stage-01-one-name-one-sql-home.md:24`) moves `contacts/address-sql.ts`; it does not name a time-literal file. F144 splits `contacts/activity.ts`; it does not name a time-literal file in its own text, but F143 touches that file's size. F124 (unit waits and timeouts) mentions `time.ts` or the `*_MS` names but names no time-literal file in its ticket text (guessed, from the `rg -l` hit only). F125 hits are audit data tables only. F141 and F136 have no relevant hit — observed (grep), guessed for F124 content

Checks: `rg` over `spec/features/{planned,active}`, `spec/quality/`, `notes/`, `spec/build.md` and `docs/product/stage-2/` covers ticket text and plan text; misses code diffs of in-flight worktrees. Pass-2 `pass-2.md:72-77` names the F145 literal files: `actions/constants.ts`, `channels/notices/*`, `operator/slo-checks.ts`, `reports/digest.ts`, `triage/service.ts`, `sim/live/executive.ts`. The note at `.limen/jobs/2026-11-20-f145-scout-3-02d8985d/note.md` is written outside the worktree. `git status --short` is empty in the worktree.
