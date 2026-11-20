# F125 stage 16 — G04 and G05: look-alike core cases become tables, with every mutant still killed

Part of [`../plan.md`](../plan.md) § Phase B. Needs stage 08: `cut-keys.ts`; stage 08b: `cut-run.sh`, `cut-proof.ts` (mutant compare), `audit/data/mutation-unstable.tsv`; F154 stages 11, 12 and 14 landed or closed: they write `digest/schedule.test.ts`, `digest/local-time.test.ts` and `triage/cost.test.ts`. May run next to 09–15, 17–20. Gets a review job (plan § Review).

Groups G04 (`MERGE-TABLE`, rule K1) and G05 (`MERGE-TABLE`, rule none), both owner `ok`. Rows: `audit/review-core-web-tools.md` (the T items of `packages/core`). Follow plan § Cut stage steps (S1–S7) and D19 (stage 13).

## Rows of this stage

- G04: 37 keys in `digest/ai-text`, `digest/local-time`, `digest/schedule`, `ops/alert-step`, `outgoing/user-text`, `triage/cost`, `triage/untrusted-text`, `trust/history` (all `packages/core/src/…test.ts`).
- G05: 29 keys in `digest/llm-pause`, `digest/local-time`, `digest/text`, `metrics/week`, `site`, `triage/untrusted-text`.
- `local-time.test.ts` and `untrusted-text.test.ts` hold groups of both: each T group becomes its own table; G04 and G05 tables never merge into one (one rule per group).

## Step 1 — G04 tables (K1)

- K1: one case of each G04 group is the only case that kills some mutant. D19 rule 3 already keeps every input; here the mutant compare proves it.
- Commit: `F125 G04 MERGE-TABLE: core tables that keep a unique kill`.

## Step 2 — G05 tables

- Commit: `F125 G05 MERGE-TABLE: core tables`.

## Proof (S5)

- **D14** Mutation scope: `--mutate` globs for the non-test source files in the import closure of the changed test files inside `packages/core/src` (follow relative imports and `@ea/core` subpaths that point into `packages/core/src`; stop at `node_modules`). Reason: a test can kill a mutant only in code it runs, and that code is in its import closure, so a full-core run adds no check and costs about 28 minutes twice. Rejected: the full core run; only the direct imports (misses a helper two files away). Write the glob list into the log.
- Run `bash scripts/test-audit/mutation.sh /tmp/f125-s16/before --mutate …` before the first edit and `…/after` after the last commit. The mutation lock may make the run wait (README); that is expected. Each Stryker run starts with a dry run of the whole core suite: that is the audit tool, the one allowed full-suite run (plan D14), not `test:unit`.
- `cut-run` before twice and after once on the 12 test files.
- `cut-proof --before /tmp/f125-s16/before-1 --before /tmp/f125-s16/before-2 --after /tmp/f125-s16/after --expect unit=+0`, with `mutation.json` copied into `before-1` and `after`. No `Killed` → `Survived` or `NoCoverage` outside `mutation-unstable.tsv`.
- An empty `diff` of the sorted JUnit `name` lists before and after.

## Out of scope

- New cases for survived mutants (the core gap ticket F154).
- Any core source change.

## Done when

- `audit/cut-s16.md` holds the keys per group, deferred rows (open-branch files too), the glob list, the `cut-proof` PASS section with the mutant count compared, and the empty name diff.
- Two commits, one per group.
- Last step: `bun run check:job`; copy its last line.
