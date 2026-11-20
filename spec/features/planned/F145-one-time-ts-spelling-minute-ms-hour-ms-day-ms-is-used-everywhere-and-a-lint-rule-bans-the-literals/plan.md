# F145 plan — one time spelling and a lint rule that bans the literals

> **Status 2026-11-20 — planned.** Plan base: c3726de2. Five stages, none `[risky]`, no migration, no `bun.lock`.

## Input

Task (coordinator, 2026-11-20): "Keep stages small (one worker each, 1 to 3 hours), name risky ones [risky], say which stages can run in parallel, give each stage a runnable Proof and tests that fail when the guard is removed. Decide yourself where the owner has no rule."

Finding 5 fix, word for word (`spec/quality/2026-11-20-pass-2.md`): "Add `MINUTE_MS` to `time.ts`; replace each literal with `n * HOUR_MS` or `n * DAY_MS`; delete the four `MINUTE_MS` copies; add an ESLint `no-restricted-syntax` rule for the literals `3_600_000`, `86_400_000` and `60_000` outside `time.ts`." OWNER: no.

### Decisions taken

- **D1 — A local ESLint rule, not `no-restricted-syntax`.** One rule `ea/no-time-literals` in a local plugin file `tools/eslint-rules/no-time-literals.js` (plain ESM JavaScript: `eslint .` loads the config without a TypeScript loader). Reason: in flat config a second `no-restricted-syntax` block for the same files replaces the log-event selectors (comment in `eslint.config.js`, scout 2), and a selector cannot fold `24 * 60 * 60 * 1000`. Rejected: adding selectors to `logEventSelectors` (couples two rules, misses folded chains).
- **D2 — What the rule reports.** (a) A numeric literal equal to 60 000, 3 600 000 or 86 400 000 (any separator form). (b) An outermost `*` chain whose numeric-literal factors multiply to a multiple of 60 000, also when the chain has identifiers (`d * 60 * 1000`); one report per chain, and a literal inside a reported chain does not report again. (c) A variable declarator named `MINUTE`, `MINUTE_MS`, `MIN_MS`, `HOUR`, `HOUR_MS`, `DAY` or `DAY_MS`. Strings (`"60000"`) and BigInt do not report. No autofix: the choice between `HOUR_MS` and `DAY_MS` and the import need a person. Message: "Write minutes, hours and days with MINUTE_MS, HOUR_MS or DAY_MS from the core time module (packages/core/src/time.ts)."
- **D3 — Scope: non-test source only.** Files `{apps,packages,tools}/*/src/**/*.{ts,tsx,js,mjs}`. Ignored: `packages/core/src/time.ts`, `**/*.test.{ts,tsx}`, `**/*.spec.ts`, `**/*.test-helper.ts`, `**/test/**`, `**/e2e/**`. Reason: the test audit (F125) owns the test files until its owner approval G1, and about 677 test lines hold such literals. Rejected: tests in scope now (conflicts with F125). Default, owner to confirm (`questions.md` Q1).
- **D4 — Lone multiples stay legal.** `120_000` or `300_000` alone do not report. Reason: byte and count limits share such values; the ticket names three literals. Rejected: ban every multiple of 60 000. Default (Q2).
- **D5 — Seconds are out of scope.** No `SECOND_MS`; `n * 1000` and `ms / 1000` stay. Reason: the ticket names minutes, hours and days. Default (Q3).
- **D6 — Same value, same unit word.** A rewrite keeps the number and swaps the unit: `48 * 3_600_000` → `48 * HOUR_MS`, `24 * 3_600_000` → `DAY_MS`, `7 * 24 * 3_600_000` → `7 * DAY_MS`, `2 * 60 * 1000` → `2 * MINUTE_MS`, `ms / 60_000` → `ms / MINUTE_MS`, `t / 86_400_000` → `t / DAY_MS`. A rewrite never changes a value. A name that says the unit keeps it (`BACKLOG_GRACE_MS`).
- **D7 — Imports.** Server, docs and tools code imports from `@ea/core`; web code from `@ea/core/web` (its barrel re-exports `time.ts`); core code by a relative path to `time`. No new package export.
- **D8 — Non-time values.** A literal that is not a time (the fake LLM `rpm: 60_000`, a requests-per-minute count) keeps its value under `// eslint-disable-next-line ea/no-time-literals -- <why it is not a time>`. Each disable is named in the stage's final message. `60_000 / rpm` in the rate limiter is a minute: it becomes `MINUTE_MS / rpm`.
- **D9 — Rollout at warn, then error.** Stage 01 registers the rule at `warn`, so `bun run lint` passes while stages 02–04 rewrite in parallel and each worker reads its list from the warnings. Stage 05 sets `error`. Reason: no shared baseline file that three parallel stages edit. Rejected: an ignore list per file that each stage shrinks (merge conflicts in one list).
- **D10 — The spike tool.** `tools/mail-oauth-spike/` has no `package.json` and no `src/`: D3's glob leaves it out. Default (Q4).
- **D11 — Source-text tests follow.** `apps/docs/src/reference.test.ts` reads `MAX_AGE_MS = (\d+) * 24 * 3_600_000` from the triage service by regex. Stage 03 changes that regex to the new spelling in the same commit; it is the only test edit outside the new rule test.

## Facts checked

- `time.ts` exports `HOUR_MS`, `DAY_MS`, `addDays`; no `MINUTE_MS`; re-exported by `packages/core/src/index.ts` and `web/index.ts` (read 2026-11-20).
- One `no-restricted-syntax` block for `apps/server/src/**/*.ts`; lint tests build `new ESLint({ cwd: repoRoot })` and `lintText` a virtual path (`platform/log-lint.test.ts`, read).
- `Literal[value=60000]` matches `60_000`; scout 2 ran a Linter probe.
- `lint` is `eslint .`; CI runs it without `--max-warnings` (`.github/workflows/ci.yml`, read).
- Non-test hits: 156 lines in 98 files (my `rg` at base; a floor).

## Not verified

- That an ESM rule file imported by `eslint.config.js` loads under `bun run lint`. Stage 01 proves it with T1.
- Literals inside `.astro` front matter: none found by `rg`; the rule covers only `ts,tsx,js,mjs`.

## Done when

The four ticket acceptance lines hold, and stage 05's Proof prints `PROOF_OK`.

## Rules for every stage

- A rewrite keeps the value (D6). List each changed expression as `old → new` in the final message for the review.
- Format only the files the stage changes. No repo-wide `prettier`.
- Do not edit test files except as D11 says. A test that breaks names a source text: stop and report.
- Code style: `.agents/limen/styleguide.md`. A gap in a decision is a question in the final message, not a choice.

## Proof

Stage NN (`nn` = 01…05):

`mkdir -p /tmp/f145-snn && bun run lint > /tmp/f145-snn/lint.log 2>&1 && bun run typecheck > /tmp/f145-snn/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f145-snn/unit.log 2>&1 && bun run test:int:ci > /tmp/f145-snn/int.log 2>&1 && echo PROOF_OK`

## Owner checkpoints and steps

None. No owner step, no VPS, no spend.

## Review

- Stage 01: `claude-sonnet-5-5` (a new lint rule; not a risk area).
- Stages 02–04: `claude-haiku-5-5` mechanical check: evaluate each `old → new` pair of the diff; all values equal; no D8 disable on a real time.
- Stage 05: no review; lands on its Proof.

## Stages

| Stage | Title | Needs | Parallel |
|---|---|---|---|
| [01](stages/stage-01-minute-and-rule.md) | `MINUTE_MS` and the rule at warn | none | first |
| [02](stages/stage-02-core-web-docs.md) | Rewrite core, web, docs | 01 | next to 03, 04 |
| [03](stages/stage-03-server-a.md) | Rewrite server: channels, triage, actions, operator, reports | 01 | next to 02, 04 |
| [04](stages/stage-04-server-b.md) | Rewrite server: mail, platform, scripts and the rest | 01 | next to 02, 03 |
| [05](stages/stage-05-error-and-docs.md) | Rule at error, docs lines | 02, 03, 04 | last |

## How to run (coordinator)

Move the ticket to `active/` and commit. Spawn 01 with the standing worker flags and `--prepare 'bash scripts/limen-prepare.sh'`; task: "Implement F145 stage NN. Read ticket.md, plan.md and stages/stage-NN-*.md. Final proof: the plan's Proof for NN." Land 01 with `--keep-open`, then spawn 02, 03 and 04 at once; land each `--keep-open` after its review. Spawn 05 when 02–04 are landed; land 05 without `--keep-open`. Drop each job DB after its land.

## Planning progress

- Scouts: 3 (`scouts.md`). Questions: 4 minor (`questions.md`).
- [written] ticket.md (356 words), plan.md (about 1,250), stages 01 (651), 02 (340), 03 (331), 04 (350), 05 (271).

## Cold review

Model: `claude-sonnet-5-5` (no `[risky]` stage, no risk area of the TRACK line). Result: pending.

## Log
