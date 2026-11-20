# F125 stage 13 — G03 part 1: look-alike cases in the log lint and job-run argument tests become tables

Part of [`../plan.md`](../plan.md) § Phase B. Needs stage 08: `cut-keys.ts`; stage 08b: `cut-run.sh`, `cut-proof.ts`. May run next to 09–12, 14–20. Gets a review job (plan § Review).

Group G03 (`MERGE-TABLE`, rule none, owner `ok`). Rows: `audit/review-server-unit.md` items T8, T9, T10 and T13 (proposed table headers in their `Evidence`). Follow plan § Cut stage steps (S1–S7).

## Rows of this stage

`cut-keys --group G03 --area apps/server/src`: 21 keys of `apps/server/src/platform/log-lint.test.ts` (three T groups) and 6 keys of `apps/server/src/scripts/job-run-args.test.ts`.

## Step 1 — One table per T group

- **D19** Rules for every `MERGE-TABLE` stage (13–16):
  1. One `test.each` table per T group, in the file and `describe` of the old cases, at the place of the first case.
  2. Each row keeps the old case name as its label (the `%s` or `$name` part), so the JUnit names stay the same and a later key resolve still finds them.
  3. Each row keeps every input and every expected value of its old case. A case that asserts more than the shared shape (an extra `expect`) is not merged; it stays a plain case next to the table and its row is listed as "kept apart".
  4. A row label must not use a `$name` mark whose value can be `undefined` (Bun leaves it unreplaced, README § Join notes).
  Reason: a table that drops an input or renames a case loses a check or breaks the audit join. Rejected: one table per file over different shapes.
- Remove the helpers only the old cases used.

## Proof (S5)

- Before and after: the two files.
- `--expect unit=+0` (each table row stays a case).
- Names: the sorted JUnit names of the two files are the same before and after (`cut-proof` prints the counts; add a `diff` of the sorted `name` lists of `unit.xml` to the log; it must be empty).
- Break once per table: change the expected value of one row and see only that row fail; restore.

## Out of scope

- Other look-alike cases in these files that are no G03 key.

## Done when

- `audit/cut-s13.md` holds the keys, the "kept apart" rows if any, the `cut-proof` PASS section, the empty name diff and the four break-once lines.
- One commit, message `F125 G03 MERGE-TABLE: log lint and job-run argument tables`.
- Last step: `bun run check:job`; copy its last line.
