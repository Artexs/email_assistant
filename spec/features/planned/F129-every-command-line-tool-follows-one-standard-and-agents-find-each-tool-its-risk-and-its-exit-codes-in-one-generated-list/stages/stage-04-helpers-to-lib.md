# F129 stage 04 — Helpers move to `scripts/lib/`

Needs stage 03: root `package.json` with the four new names and `mailbox-probe.ts` (the merged file). May run next to 00, 01 and 02 (02 writes `scripts/lib/cli-tools.ts`, a new file; a land conflict there is "merge master, re-prove").

Part of [`../plan.md`](../plan.md). Decisions: D10.

## Step 1 — Move every non-entry helper

- **Goal:** the top level of `apps/server/src/scripts/` lists tools only, so a folder listing is the tool list.
- **Rule:** a top-level file stays only when it is (a) the file of a root `package.json` tool command, (b) `<entry>-args.ts` of such a file, or (c) a test of (a) or (b). Everything else moves with `git mv` to `apps/server/src/scripts/lib/`, with its `*.test.ts` and `*.test-helper.ts` next to it. At HEAD that is about 40 files: `api-spec-build`, `check-migrations-rules`, `credentials-check-lines`, the `e2e-*-rows` files, `eval-config`, `eval-drafter`, `eval-extractor`, `eval-extras`, `eval-failure-line`, `eval-judge-setup`, `eval-sim-load`, `eval-sim`, `eval-suspicious`, `invite-delivery`, `lab-run`, `mailbox-backfill-gate`, `mailbox-cli`, `module-graph-build`, `ops-alerts-lines`, `org-status-lines`, `pick-member`, `release-prepare-lib`, the `sim-*` helpers, `triage-cost-report`. Derive the real list with the rule, not from this line.
- **Decisions:**
  - A pure move: no code change beyond import paths. The `same-bodies` check of `docs/code-patterns.md` § Size and shape is not needed (no split).
  - `*-args.ts` files stay top level even when other code imports them (`e2e-seed-args.ts` from `apps/web/e2e`, `e2e-job-env-args.ts` from `apps/docs/e2e`).
  - Fix path strings that name a moved file: `file-size.test.ts` (`scripts/sim-*.ts` pattern), `provider-scan.test.ts` (`scripts/eval-config.ts`), comments that name a path, `docs/` and `evals/` lines, `apps/server/src/modules/layers.json` if it names one. Then run `bun run graph:modules` if the module graph files change.
- **Test:** typecheck, lint and both test lanes find a broken import; nothing new.

## Step 2 — Layout test

- **Files:** `apps/server/src/scripts/scripts-layout.test.ts`.
- **Interface:** it uses `readToolCommands(rootDir)` from `scripts/lib/cli-tools.ts` when stage 02 has landed; before that it reads `package.json` with the same exact-form rule in ten lines, and stage 14 switches it to `readToolCommands`.
- **Test:**
  1. Every top-level non-test `.ts` file of `scripts/` is the file of a tool command or `<entry>-args.ts` of one.
  2. Every tool command's file exists.
  3. `scripts/lib/` holds no file that a `package.json` command names.
- **Guard check:** add an empty `scripts/stray-helper.ts` → case 1 fails naming it; delete it. Write both runs in the final message.

## Out of scope

Any change to how a tool parses, prints or exits.

## Done when

Steps 1–2 done; `git log --follow` shows the history of one moved file (name it in the final message); the plan.md Proof with `s04` prints `PROOF_OK`; `bun run test:e2e` passes (Playwright imports `e2e-*-rows` through the seed), run under the lock rule that `CLAUDE.md` states at HEAD.
