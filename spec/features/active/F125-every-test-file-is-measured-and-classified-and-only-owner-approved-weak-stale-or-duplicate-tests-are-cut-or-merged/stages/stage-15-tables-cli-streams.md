# F125 stage 15 — G03 part 3: look-alike CLI stream cases become tables

Part of [`../plan.md`](../plan.md) § Phase B. Needs stage 08: `cut-keys.ts`, `cut-run.sh`, `cut-proof.ts`. May run next to 09–14, 16–20. Gets a review job (plan § Review).

Group G03 (`MERGE-TABLE`, rule none, owner `ok`). Rows: `audit/review-int-e2e.md` rows 91, 92 and 93 (proposed table headers in their `Evidence`). Follow plan § Cut stage steps (S1–S7) and D19 (stage 13).

## Rows of this stage

`cut-keys --group G03 --area apps/server/test/integration/cli-streams-other.test.ts`: 9 keys, 3 tables. The review continuation noted that this file changed after the data base; expect moved lines, and defer only keys that resolve to no case or to two.

## Step 1 — One table per T group (D19)

- Each row spawns the same script with the same arguments and checks the same stream text as its old case. The table saves lines, not spawns: the int time stays about the same (`audit/report.md` § 2, G03).
- Keep the per-case DB setup inside the row body when the old cases had it there; do not hoist setup into `beforeAll` (it would change what each row sees).

## Proof (S5)

- Before and after: the one int file.
- `--expect int=+0`.
- An empty `diff` of the sorted JUnit `name` lists of `int.xml` before and after.
- Break once per table: change the expected stream text of one row and see only that row fail; restore.

## Out of scope

- A lint rule that replaces CLI stream spawns (`audit/report.md` § 4 item 2).

## Done when

- `audit/cut-s15.md` holds the keys, "kept apart" rows if any, the `cut-proof` PASS section, the empty name diff and three break-once lines.
- One commit, message `F125 G03 MERGE-TABLE: CLI stream tables`.
- Last step: `bun run check:job`; copy its last line.
