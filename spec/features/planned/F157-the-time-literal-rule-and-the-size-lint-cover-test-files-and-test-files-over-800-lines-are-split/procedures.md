# F157 procedures — probe, time fix, split

Part of [`plan.md`](plan.md). Stages 01–04 use § Probe and § Time fix; stages 06–20 use § Split.

## Probe

Lists the `ea/no-time-literals` hits in any files, before the config covers them. Write the config to `/tmp/f157-sNN/` (never into the worktree: `bun run lint` lints every file in it).

```bash
mkdir -p /tmp/f157-sNN
cat > /tmp/f157-sNN/probe.config.js <<EOF
import tseslint from "$PWD/node_modules/typescript-eslint/dist/index.js";
import ea from "$PWD/tools/eslint-rules/index.js";
export default [{ files: ["**/*.{ts,tsx,js,mjs}"], languageOptions: { parser: tseslint.parser },
  plugins: { ea }, rules: { "ea/no-time-literals": "error" } }];
EOF
bunx eslint --no-config-lookup -c /tmp/f157-sNN/probe.config.js <files>
```

If the import path of `typescript-eslint` fails, use the path that `node_modules/typescript-eslint/package.json` names. Ignore "Unused eslint-disable directive" lines: the probe has no other rules.

## Time fix

Plan D3. For each hit:

1. Replace the number or chain with the core name, same value, largest whole unit: `5 * 60_000` → `5 * MINUTE_MS`; `24 * 60 * 60 * 1000` → `DAY_MS`; `120 * 60_000` → `2 * HOUR_MS`.
2. Import the names from `@ea/core` (or the path the file already uses for core imports; `packages/core` files import from `../time` or `./time`).
3. A local copy (`const MINUTE = 60_000`, `const HOUR = 60 * MINUTE`) goes; rename its uses.
4. A value that is not a time (a count, a byte size, a port) gets a disable comment with the reason.
5. Never change an expected value, a timeout value or a case. A `test(…, 60_000)` timeout becomes `MINUTE_MS`.

The probe on the stage's files prints nothing at the end. Typecheck passes.

## Split

Plan D5–D11. For each file of the stage, one at a time:

1. **Measure.** `wc -l <file>`. At or under 800: skip it, write that in the log (D11).
2. **Before.** At the stage base (before the history merge) run the old file to JUnit: `bun test --reporter=junit --reporter-outfile=/tmp/f157-sNN/<base>.before.xml <file>`. An int file needs `EA_TEST_WORKER_DB=1` and `--timeout=30000` (the int line of `scripts/check-job.sh`). A failing case is a stop: report it, do not split around it.
3. **Plan the parts.** Read the top-level `describe` blocks. Choose the topics: each part at most 600 lines, shared state kept together (D7). Shared helpers go to one helpers file (D8).
4. **History merge.** Copy `history-copies.sh` from `spec/features/done/2026-11/F091-repo-split/tools.md` to `/tmp/f157-sNN/`. Run `bash /tmp/f157-sNN/history-copies.sh <old file> <dir> <base>-<topic>.test …` with a clean tree (the script adds `.ts`).
5. **Trim.** In the next commit, each copy keeps only its part, its imports and its hooks; the helpers file is created. Do not leave a copy untrimmed: the duplicate cases fail the proof.
6. **After.** Run the parts in one `bun test` call to `/tmp/f157-sNN/<base>.after.xml`, with the same env.
7. **Proof.** `bun scripts/test-audit/split-proof.ts --before <before.xml> --after <after.xml>`. It must print `split-proof PASS cases=<n>`. Each `assertions` line gets a reason in the log.
8. **History.** `git log --follow --oneline <one part> | tail -1` shows a commit of the old file.
9. **Log.** Add the file to `split-log/stage-NN.md` (D10): old lines, parts with lines, the PASS line, the assertion lines with a reason.

Then `bun run check:job`. If `master` changed a file of the stage after the history merge, reset to the new `master` and split again (D5). Never rebase or squash the branch.

Topic names are short and plain: `mail-sync-idle.test.ts`, not `mail-sync-part-2.test.ts`.
