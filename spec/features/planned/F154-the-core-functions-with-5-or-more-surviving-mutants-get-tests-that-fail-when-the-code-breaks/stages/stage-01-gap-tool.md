# F154 stage 01 — per-function gap report and a mutation run lock

Needs: nothing. Stages 02–18 need its tool and lock.

Part of [`../plan.md`](../plan.md). Decisions D1, D2, D4–D6.

## Step 1 — `mutation-gaps.ts`

**Goal.** Counted mutants per function (D1, D2) from one `mutation.json`; from two, a before/after table and the before-survivors each new test kills (D6).

**Files.** New `scripts/test-audit/mutation-gaps.ts` and its test. Reuse `mutation-summary.ts` helpers (`readReport` drops `source`). Parser: `typescript`.

**Interfaces** (later stages use the CLI). Mutant key: (file, line, column, mutator, replacement).

```ts
export function functionOf(source: string, line: number, column: number): { fn: string; id: string };
export interface GapRow { file: string; fn: string; id: string; survived: number; noCoverage: number }
export function functionGaps(json: unknown, by?: "id" | "fn"): GapRow[]; // default id; total desc, file, id
export interface CompareRow { file: string; id: string; before: number; after: number }
export function compareGaps(before: unknown, after: unknown): CompareRow[]; // missing side = 0
export interface NewCaseKills { file: string; name: string; kills: number }
export function newCaseKills(before: unknown, after: unknown): NewCaseKills[];
// tests new in `after` by (file, name); kills = before-survivors Killed after with this test in killedBy
```

CLI:
- `--in <json> [--min <n>] [--by fn]`: TSV `file id survived no_coverage total`, total ≥ n (default 5); `--by fn` groups by short name.
- `--before <a> --after <b>`: Markdown tables `file | function | before | after` and `test file | case | kills`; exit 1 when a new case has 0 kills, last line names the count.

**Test** (`mutation-gaps.test.ts`, fixed values):
1. `function a() { return 1 + 2; }` at the `+` (line 1, column 25) → `fn` `"a"`, `id` `"a"`.
2. `const b = (x: number) => x + 1;` at the `+` → `"b"`.
3. `export const texts = { tries: (n: number) => (n === 1 ? "x" : "y") };` at `===` → `"tries"`.
4. `class C { m() { return [1].map((v) => v * 2); } }` at `*` → `"m"`.
5. `export const s = z.object({}).superRefine((v, ctx) => { if (v) ctx.addIssue(1); });` in the callback, and `const LIMIT = 5 > 3 ? 1 : 2;` → `"(module level)"`.
6. Same name twice: `const en = { a: { rejected: (x: string) => x + "1" }, b: { rejected: (x: string) => x + "2" } };` at each `+` → `fn` `"rejected"` both; `id` `"en.a.rejected"` and `"en.b.rejected"`.
7. Five mutants in `a` (`Survived`, `Survived`, `NoCoverage`, `Killed`, `Timeout`) → `[{ file: "packages/core/src/x.ts", fn: "a", id: "a", survived: 2, noCoverage: 1 }]`.
8. `compareGaps`: before `a` = 7, `b` = 5; after `a` = 2, no `b` → `[{ id: "a", before: 7, after: 2 }, { id: "b", before: 5, after: 0 }]` (with the file).
9. `newCaseKills`: `"x > old"` in both reports; `"x > new"` only in after, in `killedBy` of mutant M1 (`Survived` before) and M2 (`Killed` before by `"x > old"`) → `[{ name: "x > new", kills: 1 }]`.
10. The CLI with a fixture where the only new case kills only M2 exits 1.

**Check.** `bun test scripts/test-audit/mutation-gaps.test.ts`; `bunx tsc -p scripts/test-audit --noEmit`. On `/tmp/f125-s03/run-4/mutation.json` (if present), `--min 5 --by fn` gives 122 rows, 1,260 mutants; record it, or "file gone", in `results/stage-01.md`.

## Step 2 — run lock in `mutation.sh`

**Goal.** One Stryker run at a time (D4).

**Decisions.** Lock `/tmp/email-assistant-mutation.lock` around install and Stryker. When `flock -n` fails, print `mutation.sh: waiting for the mutation lock` and wait with `flock -w 7200`. Wait budget 2 hours: on timeout exit 3 with `mutation.sh: mutation lock busy for 2 hours`; the stage stops and reports it. Usage, outputs and the EXIT trap stay.

**Check.** With the lock held in one shell (`flock /tmp/email-assistant-mutation.lock sleep 30`), a run in another prints the wait line and starts after. Then `bash scripts/test-audit/mutation.sh /tmp/f154-s01/one --mutate 'src/web/csp.ts'`; record its wall time in `results/stage-01.md`.

## Step 3 — README

One bullet each for the tool and the lock in `scripts/test-audit/README.md`.

## Done when

- Tests 1–10 pass; the lock check holds; `results/stage-01.md` holds the probe result and the wall time.
- Last step: `bun run check:job`.

## Out of scope

- New `packages/core` tests. `mutation-summary.ts` behaviour.
