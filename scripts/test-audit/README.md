# Test audit tools

Maintenance tools of the test audit (not product code, not run in CI). Own `tsconfig.json`; no new dependency (`typescript` is a root dev dependency). Check: `bunx tsc -p scripts/test-audit --noEmit`; tool tests: `bun test scripts/test-audit`.

- **Static scan** (`scan.ts`, `scan-program.ts`, `scan-format.ts`, CLI `scan-cli.ts`): one row per `test(`/`it(` call site of every tracked test file, plus shared suite modules (non-test `.ts` files under `apps/server/test/`, `apps/server/src/`, `tools/` that import `test` or `it` from `bun:test`).
  Command: `bun scripts/test-audit/scan-cli.ts --out <ticket folder>/audit/data`.
  Output: `cases-static.tsv` (columns of `CaseRow`, arrays joined with `,`), `groups.tsv` (`group`, `type`, `files` = distinct files, `cases`, `keys`), `scan-summary.md`.

## Scan notes

- A case row is one call site: a `test.each` table or a loop is one row (JUnit counts more).
- The key is `file:line` of the `test(`/`it(` call; a shared module row uses the module path.
- `S5`/`S6` rows can overlap: three identical bodies in one file form a B group and a T group.
- The no-prod-import flag ignores type-only imports (they carry no runtime code) and treats a bare Node module such as `fs` as a production import (only `node:*` is allowed).
- Asserting helpers resolve with `tsconfig.base.json` options only. A helper imported through an alias that this config lacks does not resolve, so its case counts as having no expect.
- Test files with no `bun:test` import still scan. Shared modules need the import.
