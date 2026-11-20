# F145 stage 02 — The value check for the rewrites

Needs: nothing. May run next to 01. Stages 03–06 run its command in their Proof.

Part of [`../plan.md`](../plan.md).

## Step 1 — `time-rewrite-check`

- **Goal:** a dev tool that proves a rewrite kept every time value (plan D12). It reads `git diff -U0 <base>` for `apps/*/src`, `packages/*/src` and `tools/*/src`, and fails when a hunk's time values differ between the removed and the added lines.
- **Files and interfaces:** `apps/server/src/scripts/time-rewrite-check.ts` (no DB, no config: the dev-tool exception of `docs/code-patterns.md` § Size and shape). Command: `bun apps/server/src/scripts/time-rewrite-check.ts [base]`; `base` defaults to `git merge-base HEAD master`. Exit 0 and `time values equal: <n> hunks` when all match; exit 1 and one line `file:line removed=[…] added=[…]` per mismatch. Print through `createCliOutput`. Exported pure functions for the test:
  - `timeValuesOf(line: string): number[]`
  - `compareHunk(removed: string[], added: string[]): { removed: number[]; added: number[] } | null` (null when equal)
- **Decisions:**
  - A *time expression* is a maximal run of numeric literals (any separator), unit names, `*`, `/` and parentheses, read left to right; a leading or trailing operator is dropped; an identifier ends the run. Unit names: `MINUTE_MS`, `MINUTE`, `MIN_MS` = 60 000; `HOUR_MS`, `HOUR` = 3 600 000; `DAY_MS`, `DAY` = 86 400 000. The tool takes `HOUR_MS` and `DAY_MS` from `@ea/core` and derives the minute as `HOUR_MS / 60`, so it runs before stage 01 lands and writes no literal that the stage 01 rule reports.
  - A run counts when it holds a unit name, or when it is a time chain by plan D2 (a, b). Other numbers on the line do not count.
  - Per hunk, the sorted list of counted values on removed lines must equal the one on added lines.
  - A removed line that declares a D2 (c) name (`const MINUTE = 60_000;`) is skipped when its value equals the core value; a different value is a mismatch.
  - Comments and string contents are not read (strip `//` comments and quoted strings first).
- **Test:** `apps/server/src/scripts/time-rewrite-check.test.ts`, pure, no git:
  - C1 `timeValuesOf("const a = 7 * 24 * 3_600_000;")` → `[604800000]`
  - C2 `timeValuesOf("x = ms / 60_000 + 1;")` → `[60000]`
  - C3 `timeValuesOf("t(Math.floor(ms / (24 * HOUR)));")` → `[86400000]`
  - C4 `timeValuesOf("const a = PENDING_DAYS * DAY_MS;")` → `[86400000]`
  - C5 `timeValuesOf("Math.max(1, 30 * 1000)")` → `[]`
  - C6 `compareHunk(["a = 48 * 3_600_000;"], ["a = 2 * DAY_MS;"])` → `null`
  - C7 `compareHunk(["a = 48 * 3_600_000;"], ["a = 48 * DAY_MS;"])` → `{ removed: [172800000], added: [4147200000] }`
  - C8 `compareHunk(["const MINUTE = 60_000;", "x = 5 * MINUTE;"], ["x = 5 * MINUTE_MS;"])` → `null`
  - C9 `compareHunk(["const HOUR = 60 * 60;"], [])` → not null (a copy with a wrong value)
  - C10 `compareHunk(["a = 60_000; // 1 min"], ["a = MINUTE_MS; // 1 min"])` → `null`
- **Guard check:** make `compareHunk` always return `null`; see C7 and C9 fail; restore.

## Check

`bun test apps/server/src/scripts/time-rewrite-check.test.ts`; `bun apps/server/src/scripts/time-rewrite-check.ts` on this branch prints `time values equal` (this stage rewrites no literal).

## Done when

- C1–C10 pass; the guard check failed and was restored.
- The Proof of `plan.md` for stage 02 prints `PROOF_OK`.

## Out of scope

Any rewrite; the lint rule (stage 01). Stage 06 deletes this tool.
