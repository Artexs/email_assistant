# F143 stage 07 — privacy export and address maps

Needs: nothing. May run next to every other stage; not next to an open F062 stage 04 or 05 (the cursor-column drop edits `EXPORT_MAP`).
Part of [`../plan.md`](../plan.md).

## Goal

`apps/server/src/modules/privacy/export-map.ts` (579 lines) and `privacy/address-map.ts` (441 lines) split with no change to the data request export, find or erase (D5, D7, D8).

## Step 1 — export map

- `EXPORT_MAP` is one record of about 550 lines. Cut it into consecutive slices of its `HEAD` key order, one file each, named by the module that owns the tables in the slice: `privacy/export-map/<owner>.ts`, each `export const <owner>Tables: Record<string, ExportTable> = { … }`. A slice is contiguous: the assembled key order must equal `HEAD` (D8). If the owners interleave, name the slice by its first owner and note the mix in a comment; never reorder.
- `privacy/export-map.ts` keeps `ExportTable`, the `byOrg`, `byOrgExcluding`, `secret` helpers (internal export for the slices) and `export const EXPORT_MAP = { ...aTables, ...bTables, … }` with the same type. A key that appears in two slices is a typecheck-free error: the dump proof below catches it.
- The tests that check `EXPORT_MAP` against the schema (every table listed once) stay unchanged.

## Step 2 — address map

- Move the address pattern code to `privacy/address-regex.ts` as top-level moves: `MAX_ADDRESS_LENGTH`, `normalizeDsrAddress`, the letter and mark ranges, `casedRanges`, `escapeChar`, `letterPattern`, `addressRegex`, `matchesAddress`, `replaceAddress`.
- `privacy/address-map.ts` keeps `AddressRule`, `DSR_ADDRESS_MAP`, `MESSAGE_TABLES`, `NOT_PERSONAL`, `NO_PERSONAL_TABLES` and re-exports by name what moved.
- `privacy/rule-check.ts` and the module `index.ts` keep their imports (D7).

## Method

D5 for both steps (history copies, trim at once). Step 2 is plain top-level moves: adapted `same-bodies.ts`. Step 1 carves one `const`: proof by D8. D6 if `master` changes a file first.

## Test

No new test file. Move proofs in `/tmp/f143-s07/`:

1. **Dump proof (D8):** a script prints `JSON.stringify(Object.entries(EXPORT_MAP))` at the base (a `git worktree add` in `/tmp`) and at the head; `diff` prints nothing (same keys, same order, same values).
2. Same dump for `DSR_ADDRESS_MAP`, `MESSAGE_TABLES`, `NOT_PERSONAL`, `NO_PERSONAL_TABLES`: `diff` prints nothing.
3. Call proof: `addressRegex` and `normalizeDsrAddress` on fixed inputs at base and head, `diff` prints nothing: `"Anna@Example.com"`, `" anna@example.com "`, `"İrem@example.com"`, `"ΣΟΦΊΑ@example.gr"`, `"bad@@x"`, `"x".repeat(255)`, with and without `{ json: true }`.
4. Adapted `same-bodies.ts` for step 2: `SAME_BODIES <n>`, exit 0.
5. `exports-of.ts` of each base file equals that of the new file.
6. Each new file: `git log --follow` reaches the first commit of its old file.
7. `wc -l` of every changed or new file ≤ 400.
8. Mutation check: move one key of a slice to another slice in a scratch copy; check 1 prints a diff. Revert. Write it in the final message.

Existing guards, unchanged: the privacy unit tests, `rule-check` tests, and the integration tests of export, find and erase.

## Docs

`docs/capabilities/` and `docs/modules.md` lines that name `export-map.ts` as the place to add a table name the slice folder and the rule "add the key to the slice of its owner".

## Done when

- Checks 1–8 passed; the logs are named in the final message.
- Proof: `mkdir -p /tmp/f143-s07 && bun run lint > /tmp/f143-s07/lint.log 2>&1 && bun run typecheck > /tmp/f143-s07/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f143-s07/unit.log 2>&1 && bun run test:int:ci > /tmp/f143-s07/int.log 2>&1 && echo PROOF_OK`

## Out of scope

A new table, a changed rule, the address rule of the one-address-rule ticket (F142).
