# F145 plan — one time spelling and a lint rule that bans the literals

> **Status 2026-11-20 — planned.** Plan base: c3726de2. Six stages, none `[risky]`, no migration, no `bun.lock`.

## Input

Task (coordinator, 2026-11-20): "give each stage a runnable Proof and tests that fail when the guard is removed. Decide yourself where the owner has no rule."

Finding 5 fix, word for word (`spec/quality/2026-11-20-pass-2.md`): "Add `MINUTE_MS` to `time.ts`; replace each literal with `n * HOUR_MS` or `n * DAY_MS`; delete the four `MINUTE_MS` copies; add an ESLint `no-restricted-syntax` rule for the literals `3_600_000`, `86_400_000` and `60_000` outside `time.ts`." OWNER: no.

### Decisions taken

- **D1 — A local ESLint rule, not `no-restricted-syntax`.** Rule `ea/no-time-literals` in `tools/eslint-rules/no-time-literals.js`; the one local plugin object `ea` in `tools/eslint-rules/index.js`, registered once in `eslint.config.js`. Later local rules (F143, F150) join that object; a second `ea` plugin object would make flat config fail. Plain ESM (`eslint .` loads the config without a TypeScript loader). Reason: a second `no-restricted-syntax` block replaces the log-event selectors, and a selector cannot fold `24 * 60 * 60 * 1000`. Rejected: selectors in `logEventSelectors`.
- **D2 — What the rule reports.** Factors of a `*` chain are flattened through parentheses and `as`/`satisfies`/`!`; integer folding only, in safe-integer arithmetic.
  - (a) A numeric literal equal to 60 000, 3 600 000 or 86 400 000, outside a `*` chain.
  - (b) An outermost `*` chain that holds a literal of (a), or whose integer literal factors multiply to a multiple of 60 000, or whose literal factors include both 60 and 1000 (`1.5 * 60 * 1000`). Identifiers may be in the chain (`d * 60 * 1000`).
  - (c) A variable declarator or class field named `MINUTE`, `MINUTE_MS`, `MIN_MS`, `HOUR`, `HOUR_MS`, `DAY` or `DAY_MS`. Its initializer then does not report again.
  - (d) A chain with `MINUTE_MS` whose integer literal factors multiply to a multiple of 60, or with `HOUR_MS` and a multiple of 24 (fold to the larger unit, D6).
  - One report per chain. Strings, BigInt and object keys do not report. No autofix. Message: "Write minutes, hours and days with MINUTE_MS, HOUR_MS or DAY_MS from the core time module (packages/core/src/time.ts)."
- **D3 — Scope: non-test source only.** Files `{apps,packages,tools}/*/src/**/*.{ts,tsx,js,mjs}`. Ignored: `packages/core/src/time.ts`, `**/*.test.{ts,tsx}`, `**/*.spec.ts`, `**/*.test-helper.ts`, `**/test/**`, `**/e2e/**`. Reason: the test audit (F125) owns test files until its owner approval G1; about 677 test lines hold such literals. Rejected: tests in scope now. Default, owner to confirm (`questions.md` Q1).
- **D4 — Lone multiples stay legal.** `120_000` alone does not report. Reason: byte and count limits share such values; the ticket names three literals. Default (Q2).
- **D5 — Seconds and division chains are out.** No `SECOND_MS`; `n * 1000`, `ms / 1000 / 60` stay (none of the latter at base). Default (Q3).
- **D6 — Same value, largest whole unit.** A rewrite never changes a value. It folds to the largest unit that keeps an integer factor: `48 * 3_600_000` → `2 * DAY_MS`, `24 * HOUR_MS` → `DAY_MS`, `90 * 60_000` → `90 * MINUTE_MS`, `2 * 60 * 1000` → `2 * MINUTE_MS`, `ms / 60_000` → `ms / MINUTE_MS`, `t / 86_400_000` → `t / DAY_MS`. A name keeps its unit word (`BACKLOG_GRACE_MS`). Rejected: keep the author's number (lets `24 * 60 * MINUTE_MS` stand, review finding 3).
- **D7 — Imports.** Server, docs and tools code imports from `@ea/core`; web code from `@ea/core/web`; core code by a relative path to `time`. No new package export.
- **D8 — Non-time values.** A literal that is not a time (the fake LLM `rpm: 60_000`) keeps its value under `// eslint-disable-next-line ea/no-time-literals -- <why it is not a time>`, named in the final message. `60_000 / rpm` in the rate limiter is a minute: `MINUTE_MS / rpm`.
- **D9 — Rollout at warn, then error.** Stage 01 sets `warn`, so `bun run lint` passes while stages 03–05 rewrite in parallel, each reading its list from the warnings. Stage 06 sets `error`. Rejected: a shared ignore list that each stage shrinks (merge conflicts).
- **D10 — The spike tool.** `tools/mail-oauth-spike/` has no package and no `src/`: out (4 literals stay). Default (Q4).
- **D11 — Source-text tests follow.** `apps/docs/src/reference.test.ts` reads `MAX_AGE_MS = (\d+) * 24 * 3_600_000` from the triage service by regex (two places). Stage 04 changes both regexes in the same commit; the only test edit outside the new tests.
- **D12 — A value check, not only a review.** Stage 02 builds `time-rewrite-check`: per diff hunk, the time values of removed and added lines must be equal. Stages 03–05 run it in their Proof; stage 06 runs it once and deletes it. Reason: tests import constants by name, so a wrong factor passes them (review finding 2). Rejected: Haiku review alone.

## Facts checked

- `time.ts` exports `HOUR_MS`, `DAY_MS`, `addDays`; no `MINUTE_MS`; re-exported by `packages/core/src/index.ts` and `web/index.ts` (read 2026-11-20).
- One `no-restricted-syntax` block, `apps/server/src/**/*.ts`; lint tests use `new ESLint({ cwd: repoRoot })` and `lintText` on a virtual path (`platform/log-lint.test.ts`, read; review confirmed).
- `lint` is `eslint .`; CI runs it without `--max-warnings`; `lint-staged` runs `eslint --fix` (read; review confirmed). At base `bun run lint` exits 0 with 11 warnings (review).
- Non-test hits: about 150 lines in about 100 files (my `rg` of the literals and `60 * 1000` forms; the review counted 134 literal-only lines). A floor; the warnings at `HEAD` are the list.

## Not verified

- That the ESM plugin loads under `bun run lint`: stage 01 T1 proves it.
- Literals in `.astro` front matter: `rg` found none; the rule covers `ts,tsx,js,mjs` only.

## Done when

The ticket acceptance lines hold, and stage 06's Proof prints `PROOF_OK`.

## Rules for every stage

- A rewrite keeps the value (D6, D12). List each changed expression as `old → new` in the final message.
- Format only the files the stage changes. No repo-wide `prettier`.
- Do not edit test files except as D11 says. A test that breaks on a source text: stop and report.
- Code style: `.agents/limen/styleguide.md`. A gap in a decision is a question in the final message, not a choice.

## Proof

Stages 01, 02, 06 (`nn` = stage number):

`mkdir -p /tmp/f145-snn && bun run lint > /tmp/f145-snn/lint.log 2>&1 && bun run typecheck > /tmp/f145-snn/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f145-snn/unit.log 2>&1 && bun run test:int:ci > /tmp/f145-snn/int.log 2>&1 && echo PROOF_OK`

Stages 03, 04, 05: the same chain with `&& bun apps/server/src/scripts/time-rewrite-check.ts > /tmp/f145-snn/values.log 2>&1` before `&& echo PROOF_OK`.

## Owner checkpoints and steps

None. No owner step, no VPS, no spend.

## Review

- Stage 01: `claude-sonnet-5-5`.
- Stages 03–05: `claude-haiku-5-5` mechanical check: the `values.log` exit, each `old → new` pair, no D8 disable on a real time.
- Stages 02, 06: no review; they land on their Proof.

## Stages

| Stage | Title | Needs | Parallel |
|---|---|---|---|
| [01](stages/stage-01-minute-and-rule.md) | `MINUTE_MS` and the rule at warn | none | next to 02 |
| [02](stages/stage-02-value-check.md) | The value check tool | none | next to 01 |
| [03](stages/stage-03-core-web-docs.md) | Rewrite core, web, docs | 01, 02 | next to 04, 05 |
| [04](stages/stage-04-server-a.md) | Rewrite server: channels, triage, actions, operator, reports | 01, 02 | next to 03, 05 |
| [05](stages/stage-05-server-b.md) | Rewrite server: mail, platform, scripts, the rest | 01, 02 | next to 03, 04 |
| [06](stages/stage-06-error-and-docs.md) | Rule at error, docs lines, value check deleted | 02–05 | last |

## How to run (coordinator)

Move the ticket to `active/` and commit. Spawn 01 and 02 at once, standing worker flags, `--prepare 'bash scripts/limen-prepare.sh'`; task: "Implement F145 stage NN. Read ticket.md, plan.md and stages/stage-NN-*.md. Final proof: the plan's Proof for NN." Land each `--keep-open`. When both are landed, spawn 03, 04 and 05 at once; land each `--keep-open` after its review. Spawn 06 when 03–05 are landed; land it without `--keep-open`. Drop each job DB after its land.

## Planning progress

- Scouts: 3 (`scouts.md`). Questions: 4 minor (`questions.md`).
- [written] ticket.md, plan.md, stages 01–06. Word counts (wc -w): see Log.

## Cold review

Model: `claude-sonnet-5-5` (no `[risky]` stage, no risk area of the TRACK line). Round 1: `plan-review-1.md`, PASS, 0 blocking, 11 notes. Dispositions:

Fixed: 1 (D2 b, T8), 2 (D12, stage 02), 3 (D2 d, D6, T11), 4 (T2, T5, T9, T12–T14), 5 (D5), 6 (D2, T5, T12; object keys stay out, their literal still reports), 7 (D1 `index.js`), 8 (ticket acceptance scope), 11 (count wording; spike stays Q4). Kept: 9 (T1 proves it). Rejected: 10 (no plan list of non-time values: the warnings at `HEAD` decide; each disable is named and reviewed).

## Log

- 2026-11-20: plan written at c3726de2 (b37af335); review 1 PASS with 11 notes; fixes added stage 02 (value check) and renumbered 02–05 to 03–06. Word counts (wc -w): plan 1445, ticket 380, stages 01 698, 02 550, 03 356, 04 348, 05 422, 06 391.
