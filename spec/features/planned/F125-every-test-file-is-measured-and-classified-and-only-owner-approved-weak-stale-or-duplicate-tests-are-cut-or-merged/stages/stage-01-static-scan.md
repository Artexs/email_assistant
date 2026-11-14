# F125 stage 01 — Audit tool: static scan of every test case

Part of [`../plan.md`](../plan.md). Phase A: no test file and no production code changes.

Goal of the stage: `bun scripts/test-audit/scan.ts` writes one row per test case of the repo with the static flags S1–S8 of `plan.md` § Flags, and the B and T groups. Later stages join timings (stage 02) and mutation data (stage 03) to these rows.

## Step 1 — Folder, config, README

- **Files:** `scripts/test-audit/tsconfig.json`, `scripts/test-audit/README.md`.
- **Interfaces:** `tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["bun"] }, "include": ["*.ts"] }` (adapt `types` to what `tsconfig.base.json` already sets; `bunx tsc -p scripts/test-audit --noEmit` must pass). README: one line per tool (purpose, command, output path). Stage 02 and 03 add their lines.
- **Decisions:** D3.
- **Done when:** `bunx tsc -p scripts/test-audit --noEmit` passes on an empty `scan.ts` stub.

## Step 2 — The scanner

- **Goal:** a pure function from source text to case rows, and a CLI around it.
- **Files:** `scripts/test-audit/scan.ts` (pure functions, exported), `scripts/test-audit/scan-cli.ts` (file list, program, output).
- **Interfaces:**
  ```ts
  export interface CaseRow {
    key: string;            // `${file}:${line}` — line (1-based) of the test(/it( call expression
    file: string;           // repo-relative path
    line: number;
    kind: "unit" | "int" | "e2e";
    describePath: string;   // describe titles joined with " > "
    name: string;           // the first argument text (template literals as written)
    each: boolean;          // test.each / it.each / inside a for-of or forEach over a list
    expectCalls: number;    // expect( calls in the body, plus 1 per asserting helper call
    matchers: string[];     // e.g. "toBe", "not.toContain", "rejects.toBeInstanceOf"
    flags: string[];        // "S1".."S8"
    bodyGroup: string;      // "B<n>" or ""
    shapeGroup: string;     // "T<n>" or ""
    skipCondition: string;  // the condition text of skipIf/if, "skip", "todo", "only", or ""
    bodyLines: number;
  }
  export function scanSource(file: string, text: string, resolveAsserting: (call: ts.CallExpression) => boolean): CaseRow[];
  export function assignGroups(rows: CaseRow[], bodies: Map<string, { body: string; shape: string }>): void;
  ```
- **Rules:**
  - Files: `git ls-files '*.test.ts' '*.test.tsx' '*.spec.ts'` minus `scripts/test-audit/` (the tool's own tests). `kind`: `int` for `apps/server/test/` and `tools/fake-telegram/test/`; `e2e` for `apps/web/e2e/`; else `unit`.
  - A case is a call whose callee is `test` or `it`, or a member chain on them (`.each(...)`, `.skip`, `.only`, `.todo`, `.if(...)`, `.skipIf(...)`, `.concurrent`, `.serial`), with a string or template first argument. Playwright `test(` and `test.describe(` count the same.
  - `describePath` from enclosing `describe(`/`test.describe(` calls (and their `.skip`/`.skipIf` forms, whose condition also goes to `skipCondition`).
  - Asserting helper: build one `ts.Program` over all test files with `tsconfig.base.json` options; a call in the body whose callee declaration (through imports, `checker.getAliasedSymbol`) holds `expect(` in its body, up to 3 calls deep, counts as one expect call. Any `expect(`, `expect.assertions(`, `expect.hasAssertions(` in the body counts.
  - Matchers: for each `expect(...)` chain, the property names after `expect(...)` joined by `.` (`not.toBe`, `rejects.toThrow`).
  - Flags as in `plan.md` § Flags: S1 (`expectCalls === 0`), S2, S3, S4, S5 (set by `assignGroups`), S6 (set by `assignGroups`, only when `each` is false), S7 (`skipCondition !== ""`), S8 (the file imports no module outside the helper paths of § Flags).
  - Body text for S5: print the callback body with `ts.createPrinter({ removeComments: true })`, collapse whitespace. Shape for S6: the same, with every string, number, template and regex literal replaced by `_`. B groups: 2 or more cases with the same body (any file). T groups: 3 or more cases with the same shape in one file.
  - Group ids are stable for the same input: number them in order of the first key (sorted by file, then line).
- **Test** (`scripts/test-audit/scan.test.ts`, inline source strings, no repo files):
  1. `test("a", () => { expect(1).toBe(1); })` → 1 row, `expectCalls` 1, `matchers` `["toBe"]`, no flags.
  2. `test("b", () => { doThing(); })` with no helper → flags `["S1"]`.
  3. `expect(x).toBeDefined(); expect(y).toBeTruthy();` → `S2`. With one more `expect(z).toBe(3)` → no `S2`.
  4. `expect(spy).toHaveBeenCalled(); expect(spy).toHaveBeenCalledTimes(2);` → `S3` only (`toHaveBeenCalledTimes` is not in the S2 list). `expect(spy).toHaveBeenCalled();` alone → `S2` and `S3`.
  5. `describe("d", () => { describe("e", () => { it("f", …) }) })` → `describePath` `"d > e"`.
  6. `describe.skipIf(url === "")("g", () => { test("h", …) })` → `skipCondition` `url === ""`, flag `S7`.
  7. `test.each([[1, 2]])("sum %p", …)` → `each: true`, no `S6` even with 3 similar cases.
  8. Three cases `test("x1", () => { expect(f(1)).toBe(2); })`, `… f(2) … 3`, `… f(5) … 6` in one file → one T group, all three `S6`.
  9. Two identical bodies in two files → one B group, both `S5`.
  10. A local helper `function check(v) { expect(v).toBe(1); }` called in the body → `expectCalls` 1, no `S1`.
  11. `await expect(p).rejects.toThrow("x")` → matcher `rejects.toThrow`.
  12. Group ids: the same input twice gives the same ids.
- **Check:** `bun test scripts/test-audit`.
- **Done when:** tests 1–12 pass.

## Step 3 — Run it and commit the data

- **Files:** `spec/features/active/F125-every-test-file-is-measured-and-classified-and-only-owner-approved-weak-stale-or-duplicate-tests-are-cut-or-merged/audit/data/cases-static.tsv`, `.../audit/data/groups.tsv`, `.../audit/data/scan-summary.md`.
- **Command:** `bun scripts/test-audit/scan-cli.ts --out spec/features/active/F125-every-test-file-is-measured-and-classified-and-only-owner-approved-weak-stale-or-duplicate-tests-are-cut-or-merged/audit/data`.
- **Format:** TSV with a header row; columns in the order of `CaseRow`; arrays joined with `,`; tabs and newlines in names replaced by a space. `groups.tsv`: `group`, `type` (B/T), `files`, `cases`, `keys`. `scan-summary.md`: total rows; rows per `kind` and per area (`packages/core`, `apps/server/src`, `apps/server/test`, `apps/web/src`, `apps/web/e2e`, `tools/fake-telegram`); count per flag per area; group counts; the 20 biggest groups.
- **Output rules:** the CLI writes with `Bun.write` and prints one line per file written (`process.stdout.write`), no `console.log`.
- **Check:** the row count is within 5 % of the JUnit totals of `plan.md` F1 plus the e2e count (about 4,000 rows; `each` cases count once here). Write the exact numbers in the final message.
- **Done when:** the three files are committed; the final message gives the count per flag and per area (N4) and names every area with more than 250 flagged cases.

## Done when

Steps 1–3 done; the Phase A Proof of `plan.md` § Proof with `NN=01` prints `PROOF_OK`.
