# F154 stage 01 — per-function gap report and a run lock for mutation runs

Needs: nothing. Stages 02–18 need `scripts/test-audit/mutation-gaps.ts` and the lock in `scripts/test-audit/mutation.sh`.

Part of [`../plan.md`](../plan.md). Decisions D1, D2, D4, D6, D10.

## Step 1 — `mutation-gaps.ts`

**Goal.** One command turns a Stryker `mutation.json` into counted mutants per function (D1, D2), and two reports into a before/after table plus a kill count for each new test (D6).

**Files.** New `scripts/test-audit/mutation-gaps.ts` and `mutation-gaps.test.ts`. Reuse the helpers of `mutation-summary.ts` where they fit (`readReport` drops `source`). Parser: the root dev dependency `typescript`.

**Interfaces** (later stages call the CLI only):

```ts
export function functionOf(source: string, line: number, column: number): string; // D1; "(module level)" when none
export interface GapRow { file: string; fn: string; survived: number; noCoverage: number }
export function functionGaps(json: unknown): GapRow[];            // file = "packages/core/src/…", sorted by total desc, then file, fn
export interface CompareRow { file: string; fn: string; before: number; after: number }
export function compareGaps(before: unknown, after: unknown): CompareRow[]; // union of keys; a missing side counts 0
export interface NewCaseKills { file: string; name: string; kills: number }
export function newCaseKills(before: unknown, after: unknown): NewCaseKills[]; // tests of `after` whose (file, name) is not in `before`
```

CLI:
- `bun scripts/test-audit/mutation-gaps.ts --in <mutation.json> [--min <n>]` prints TSV `file fn survived no_coverage total` for rows with total ≥ n (default 5).
- `bun scripts/test-audit/mutation-gaps.ts --before <a.json> --after <b.json>` prints Markdown: a table `file | function | before | after` (rows with before or after > 0) and a table `test file | case | kills`. Exit 1 when a new case has 0 kills; the last line then names the count.

**Test** (`mutation-gaps.test.ts`, fixed values):
1. `function a() { return 1 + 2; }` at the `+` (line 1, column 25) → `"a"`.
2. `const b = (x: number) => x + 1;` at the `+` → `"b"`.
3. `export const texts = { tries: (n: number) => (n === 1 ? "x" : "y") };` at `===` → `"tries"`.
4. `class C { m() { return [1].map((v) => v * 2); } }` at `*` → `"m"` (an anonymous callback passes up).
5. `export const s = z.object({}).superRefine((v, ctx) => { if (v) ctx.addIssue(1); });` inside the callback → `"(module level)"` (matches the audit's `replies/schema.ts` row).
6. `const LIMIT = 5 > 3 ? 1 : 2;` → `"(module level)"`.
7. A fixture report with one file and five mutants in function `a` (statuses `Survived`, `Survived`, `NoCoverage`, `Killed`, `Timeout`) → `[{ file: "packages/core/src/x.ts", fn: "a", survived: 2, noCoverage: 1 }]`.
8. `compareGaps`: before `a` = 7, `b` = 5; after `a` = 2, no `b` → `[{ fn: "a", before: 7, after: 2 }, { fn: "b", before: 5, after: 0 }]` (with the file).
9. `newCaseKills`: test `"x > old"` in both reports, `"x > new"` only in after and listed in `killedBy` of two mutants → `[{ name: "x > new", kills: 2 }]` (with the file).
10. The CLI with a fixture where a new case kills nothing exits 1.

**Check.** `bun test scripts/test-audit/mutation-gaps.test.ts`; `bunx tsc -p scripts/test-audit --noEmit`. When `/tmp/f125-s03/run-4/mutation.json` exists: `--in` on it with `--min 5` gives 122 rows and 1,260 mutants (planner probe, D1); write the result, or "file gone", in `results/stage-01.md`.

## Step 2 — run lock in `mutation.sh`

**Goal.** Two stages never run Stryker at the same time (D4).

**Decisions.** Lock file `/tmp/email-assistant-mutation.lock`; blocking `flock` around the install and the Stryker run. When busy (`flock -n` fails first), print `mutation.sh: waiting for the mutation lock`. Usage, outputs and the EXIT trap do not change.

**Check.** Hold the lock in one shell (`flock /tmp/email-assistant-mutation.lock sleep 30`) and start a one-file run in another: it prints the wait line and starts after the first shell ends. Then one run: `bash scripts/test-audit/mutation.sh /tmp/f154-s01/one --mutate 'src/web/csp.ts'`; record its wall time in `results/stage-01.md` (plan.md § Not verified).

## Step 3 — README

One bullet each for `mutation-gaps.ts` and the lock in `scripts/test-audit/README.md`.

## Done when

- Tests 1–10 pass; the lock check behaves as written; `results/stage-01.md` holds the probe result and the one-file wall time.
- Last step: `bun run check:job`.

## Out of scope

- New `packages/core` tests. `mutation-summary.ts` behaviour.
