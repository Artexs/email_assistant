# F143 stage 07 — privacy export and address maps

Needs: nothing. May run next to every other stage. Overlap (advisory): the cursor-column drop (F062 stages 04–05) edits `EXPORT_MAP`; on a land conflict, D6.
Part of [`../plan.md`](../plan.md).

## Goal

`apps/server/src/modules/privacy/export-map.ts` (579 lines) and `privacy/address-map.ts` (441 lines) split with no change to the data request export, find or erase (D5, D7, D8).

## Step 1 — export map

- `EXPORT_MAP` is one record of 48 tables, nearly in alphabetical order, with owners that interleave. Cut it into consecutive slices of its `HEAD` key order, named by key range (D17): `privacy/export-map/tables-a-d.ts`, `tables-e-m.ts`, `tables-n-s.ts`, `tables-t-z.ts` (adjust the cuts so each is ≤ 400 lines; never reorder a key), each `export const tablesAD: Record<string, ExportTable> = { … }`.
- `ExportTable` and the `byOrg`, `byOrgExcluding`, `secret` helpers go to a leaf file `privacy/export-map/kinds.ts` (D16: the slices call them at load time).
- `privacy/export-map.ts` keeps `export const EXPORT_MAP = { ...tablesAD, ...tablesEM, … }` with the same type and re-exports `ExportTable`.
- The tests that check `EXPORT_MAP` against the schema (every table listed once) stay unchanged.

## Step 2 — address map

- Move the address pattern builders to `privacy/address-regex.ts` as top-level moves: `MAX_ADDRESS_LENGTH`, `normalizeDsrAddress`, the letter and mark ranges, `casedRanges`, `escapeChar`, `letterPattern`, `addressRegex`.
- `matchesAddress` and `replaceAddress` (the only SQL writers) stay in `privacy/address-map.ts`: `apps/server/test/integration/privacy-address-pattern-use.test.ts` reads that file for the SQL and scans every other privacy file for SQL regex operators. If the scan flags `address-regex.ts`, stop and ask; do not widen its exclusion list.
- `privacy/address-map.ts` keeps `AddressRule`, `DSR_ADDRESS_MAP`, `MESSAGE_TABLES`, `NOT_PERSONAL`, `NO_PERSONAL_TABLES`, the two SQL functions, and re-exports by name what moved.
- `privacy/rule-check.ts` and the module `index.ts` keep their imports (D7).

## Method

D5 for both steps (history copies, trim at once). Step 2 is plain top-level moves: adapted `same-bodies.ts`. Step 1 carves one `const`: proof by D8. D6 if `master` changes a file first.

## Test

No new test file. Move proofs in `/tmp/f143-s07/`:

1. **Dump proof (D8):** a script prints `JSON.stringify(Object.entries(EXPORT_MAP))` before the first change and after the trim; `diff` prints nothing (same keys, same order, same values). It also checks that the key counts of the slices add up to the key count of `EXPORT_MAP` (no key in two slices).
2. Same dump for `DSR_ADDRESS_MAP`, `MESSAGE_TABLES`, `NOT_PERSONAL`, `NO_PERSONAL_TABLES`: `diff` prints nothing.
3. Call proof: `addressRegex` and `normalizeDsrAddress` on fixed inputs before and after, `diff` prints nothing: `"Anna@Example.com"`, `" anna@example.com "`, `"İrem@example.com"`, `"ΣΟΦΊΑ@example.gr"`, `"bad@@x"`, `"x".repeat(255)`, with and without `{ json: true }`.
4. Adapted `same-bodies.ts` for step 2: `SAME_BODIES <n>`, exit 0.
5. `exports-of.ts` of each base file equals that of the new file.
6. Each new file: `git log --follow` reaches the first commit of its old file.
7. `wc -l` of every changed or new file ≤ 400.
8. Mutation check: move one key of a slice to another slice in a scratch copy; check 1 prints a diff. Revert. Write it in the final message.

Existing guards, unchanged: the privacy unit tests, `rule-check` tests, and the integration tests of export, find and erase.

## Docs

`docs/capabilities/` and `docs/modules.md` lines that name `export-map.ts` as the place to add a table name the slice folder and the rule "add the key to the slice whose range holds its name".

## Done when

- Checks 1–8 passed; the logs are named in the final message.
- Proof: `plan.md` § Proof with `NN=07`.

## Out of scope

A new table, a changed rule, the address rule of the one-address-rule ticket (F142).
