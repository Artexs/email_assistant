# F129 stage 16 — Close the standard

Needs stages 05–15: every group of `apps/server/src/scripts/cli-pending.json` empty (tools and helpers). Needs stage 04: `scripts-layout.test.ts`. The last stage: land without `--keep-open`.

Part of [`../plan.md`](../plan.md). Decisions: D6, D10, D11, D12. Review: `claude-sonnet-5-5` before the land.

## Step 1 — Remove the pending list

- **Files:** `cli-pending.json` (deleted), `cli-standard.test.ts` (no pending path left), `eslint.config.js` (no read of the file; only the two fixed exceptions `platform/cli.ts` and `tools/fake-telegram/src/cli-run.ts`), `scripts-layout.test.ts` (switch its own `package.json` reader to `readToolCommands` from `scripts/lib/cli-tools.ts`).
- **Decision:** a group that is not empty is a stop: name it in the final message; do not convert its tools here.
- **Guard checks (required; write each run in the final message):**
  1. Add `process.exit(0)` to one converted script (`org-status.ts`) → `bun run lint` fails; remove it.
  2. Add `process.stdout.write("x")` to `tools/fake-telegram/src/cli.ts` → lint fails; remove it.
  3. Add a top-level `loadConfig()` call to `org-status.ts` → the standard test (spawn with `--no-env-file`) fails for `org:status`; restore.
  4. Add a `package.json` script `"x:y": "bun apps/server/src/scripts/org-status.ts"` → the standard test fails (no description named `x:y`); remove it.

## Step 2 — Pointers and docs

- `CLAUDE.md` § Rules: one line "CLI tools: `docs/cli.md`; list them with `bun run cli:list`; the risk column says what an agent may run (owner rule 2026-11-15)."
- `.agents/limen/styleguide.md` § Prefer: one line pointing to `docs/cli.md` § Convert a tool.
- `docs/code-patterns.md` § Logs: the CLI paragraph names `runCli` and the `process.*` lint rule.
- `docs/cli.md`: remove any "pending" wording; add the production line `$C run --rm cli bun run cli:list`.
- `README.md`: the tool section points to `bun run cli:list`, no hand list of tools (`capability-map.test.ts` checks the names that remain).

## Step 3 — Final checks

- `bun run cli:list` → one row per tool command, exit 0; save the output to `/tmp/f129-s16/cli-list.txt`.
- `bun run cli:list --json` → parses with `cliListSchema`; row count equals the text row count (save both).
- From a temp folder with no `.env`: `env -i PATH="$PATH" HOME="$HOME" bun --no-env-file <repo>/apps/server/src/scripts/org-delete.ts --help`, the same for `mailbox-seed.ts` and `tools/fake-telegram/src/cli.ts` → 0; save the output.
- `git grep -n "gemini:test" -- ':!spec' ':!notes'` → nothing.

## Out of scope

New tools; behaviour changes; the production check (the coordinator records it after the release, plan.md § owner steps).

## Done when

Steps 1–3 done; the plan.md Proof with `s16` and `&& bun run test:e2e > /tmp/f129-s16/e2e.log 2>&1` before `echo PROOF_OK` prints `PROOF_OK`, `test:e2e` under the lock rule `CLAUDE.md` states at HEAD.
