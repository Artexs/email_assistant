# F125 stage 14 — G03 part 2: look-alike cases of the web, docs and deploy tests become tables

Part of [`../plan.md`](../plan.md) § Phase B. Needs stage 08: `cut-keys.ts`; stage 08b: `cut-run.sh`, `cut-proof.ts`. May run next to 09–13, 15–20. Gets a review job (plan § Review).

Group G03 (`MERGE-TABLE`, rule none, owner `ok`). Rows: `audit/review-core-web-tools.md` items T1, T2, T3 (docs), T16 and T17 (proposed table headers in their `Evidence`). Follow plan § Cut stage steps (S1–S7) and D19 (stage 13).

## Rows of this stage

`cut-keys --group G03` with `--area` once per prefix: `apps/web/src/lib/two-factor-flow.test.ts` (3 keys), `apps/docs/integrations/link-check.test.ts` (6), `apps/docs/src/in-place.test.ts` (4), `deploy/test/compose-lib.test.ts` (3). 16 keys, 5 tables.

## Step 1 — One table per T group (D19)

- `deploy/test/compose-lib.test.ts` tests a shell library: each row still runs the same script call with the same arguments.
- The docs link check reads files: keep the fixture of each row; a shared fixture only where the old cases shared it.

## Proof (S5)

- Before and after: the four files (all in the unit lane).
- `--expect unit=+0`.
- An empty `diff` of the sorted JUnit `name` lists of `unit.xml` before and after (in the log).
- Break once per table: change the expected value of one row and see only that row fail; restore.

## Out of scope

- The other docs and web tests.

## Done when

- `audit/cut-s14.md` holds the keys, "kept apart" rows if any, the `cut-proof` PASS section, the empty name diff and five break-once lines.
- One commit, message `F125 G03 MERGE-TABLE: web, docs and deploy tables`.
- Last step: `bun run check:job`; copy its last line.
