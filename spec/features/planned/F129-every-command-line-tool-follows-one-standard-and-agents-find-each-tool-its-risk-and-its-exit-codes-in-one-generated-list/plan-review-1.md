FAIL ff96803ae35d67bb98605968318fac546db59b54

HEAD matches the candidate (`git rev-parse HEAD` printed ff96803a…). This was a plan review: I built no stage and ran no stage proof. Stage paths below are relative to the F129 folder, `spec/features/planned/F129-…/`. All code facts were read at HEAD.

## BLOCKING

**B1. Stage 02 cannot pass lint. Two of its rules exclude each other.**
- `stages/stage-02-list-test-lint.md:45-47` puts `apps/server/src/scripts/**` under the lint rule, `lib/` included.
- The only exception list is `cli-pending.json`. Test 9 (`:38`) allows only files of tool commands in it.
- Five helpers call `process.stdout.write`. No tool command names any of them:
  - `eval-drafter.ts:393`
  - `eval-extractor.ts:50`
  - `eval-sim.ts:53`
  - `eval-suspicious.ts:53`
  - `invite-delivery.ts:66`
- Stage 04 moves all five to `lib/`. Whichever order 02 and 04 land in, `bun run lint` fails in stage 02.
- Stages 06 and 10 own the tools that use these helpers, but neither names the helpers.
- Proven by grep at HEAD.
- Decide one of these:
  - allow helper files in the pending list (and change test 9), or
  - give the helpers a writer argument in stage 02, or
  - start the lint rule on `lib/` in stage 14.

**B2. The "no env" proof does not work in a job worktree. Stage 14 guard check 3 cannot fail there.**
- Bun loads `.env` from the cwd even under `env -i`. Reproduction in `/tmp/f129-review/envt`:
  - `env -i PATH HOME bun run x` printed `from_dotenv`.
  - `bun --no-env-file x.ts`, or a cwd with no `.env`, printed `undefined`.
- `scripts/limen-prepare.sh:33,96` writes `.env` into every job worktree.
- Test 7/8 of stage 02 (`stage-02:34-35`) spawn `bun run <name>` from the repo root with `{PATH, HOME}`. Locally they pass for a tool that loads config before the parse.
- CI has no `.env`, so the failure first shows on master CI after the land.
- Stage 14 guard check 3 (`stage-14:14`) moves `loadConfig` above the parse. `runCliCode` answers `--help` before `main` (D3), so `--help` cannot fail that way. With `.env` loaded, `--no-such-flag` cannot fail either.
- Fix: spawn `bun --no-env-file <entry file> [subcommand] …`, or run with a cwd that has no `.env`. Rewrite guard 3 so it really fails, for example with a top-level `loadConfig()` under the no-env spawn.

**B3. The danger guard for `org:break-glass` leaves cases open and breaks a Playwright test. Stage 05 has no e2e run.**
- **Modes:** `org-break-glass-args.ts` has three modes: list (read-only), set and `--clear`. D8 (`plan.md:63`) and `stage-05:14` give `--confirm` and `--dry-run` with no mode. Nothing says whether `--clear` needs confirm, or whether list must refuse without it.
- **Playwright:** `apps/web/e2e/tests/two-factor.spec.ts:225` runs `org-break-glass.ts --org-id … --user-id …` and `:246` runs `--clear`, both by path and without `--confirm`. Set will exit 2, so `execFileSync` throws.
  - Stage 05 does not name this caller.
  - Its proof has no `test:e2e`.
  - A grep for `org:break-glass` does not find a call by path.
- **Dry-run interface:** "counts it would change" needs new read functions in `privacy` and `tenancy`. Two rules stop the worker from writing them: "service functions keep their signatures" (`stage-05:35`) and the rule that a CLI does not query a repository. Questions with no answer:
  - Which counts does `org:delete --dry-run` print?
  - Must `org:dsr --erase --dry-run` avoid `findSubjectData`? That function writes a `dsr.find` audit row, and the rule at `stage-05:27` is "no audit row".
  - Does a break-glass dry-run check `not_owner` and `no_two_factor`? Today it would print "would set" for a run that will be refused.

**B4. Two tools use exit 2 for something other than usage, and no stage changes them.** D5 says 2 means usage only.
- `mailbox:audit` returns 2 for "lost or duplicate INBOX mail" (`modules/mail/audit.ts:51-54`). `docs/capabilities/sync.md:37` documents it. Stage 08 (`stage-08:12`) lists no exit change for it.
- `testmail:send` returns 2 for "not done, no fix needed" (`modules/testmail/send.ts:353`, asserted at `send.test.ts:241`). Stage 11 (`stage-11:11`) lists only "bad args 1 → 2".
- No test catches a 2 that is not a usage error. An agent would read lost mail as "usage, nothing ran".
- Decide: 1 for the audit difference and 4 for the testmail stop. Name the files and docs that change.

**B5. "Unreachable → 3" conflicts with the byte-for-byte rule, and there is no shared function to classify an error.**
- `org-status.ts:53-55`, `telegram-check.ts:31-33` and `llm-check.ts:102-121` catch every error in `main`. They print their own `failed: …` and return 1, so `runCliCode` never sees the error.
- Stage 06 Step 2, stage 07 Step 2, stage 09 Step 2 and stage 10 test 5 each require exit 3 and an `unreachable:` line.
- To pass, a worker must break either "text stays byte for byte" (`plan.md:96`) or the recipe. Four parallel stages would each choose differently.
- Decide one of these:
  - export `classifyCliError(error): 1 | 3` from `platform/cli.ts`, and state that the `failed:` line may become `unreachable:`, or
  - state that `main` drops its outer catch.

## TEST GAP

- **T1. Stages whose callee runs under Playwright have no `test:e2e`:**
  - stage 06: `org-flag.ts` is spawned by path in six specs, for example `apps/web/e2e/tests/activity.spec.ts:29`.
  - stage 13: `fake-tg serve` is the Playwright web server (`apps/web/e2e/servers.ts:10`) and runs in `deploy/compose.sim.yaml:76`.
  - The plan rule at `plan.md:104` covers only a changed caller, not a changed callee.
- **T2. Danger tests in `stage-05:37-48` leave cases out:**
  - tests 7 and 8 do not assert "no audit row";
  - there is no test for `web:two-factor-reset` without `--confirm` or with `--dry-run`;
  - there is no test for `org:break-glass` list or `--clear` (see B3);
  - there is no test for a wrong `org:dsr --erase` confirm.
- **T3. No test that `cli:list` runs with no env.** `stage-02:26` (test 5) spawns `cli:list` with the full env. `cli:list` imports every args file, and D1 purity is not enforced (N1). Today all 29 args files import with exit 0 under `env -i`: I ran the loop.
- **T4. `--help` anywhere in argv (`stage-01:24`) has no test for an operand that looks like a flag,** for example `fake-tg send -h` or a `wait <regex>`.

## NOTE

- **N1 (proven, rules conflict).** D1 (`plan.md:56`) says args files are pure: no config, DB or module import. At HEAD, nine args files import modules or `pg`:
  - `eval-args.ts` (`modules/triage`, `platform/llm`, `platform/eval-ledger`)
  - `llm-check-args.ts` (`platform/llm`)
  - `mailbox-seed-args.ts`, `mailbox-settings-args.ts`, `mailbox-signals-args.ts` (`modules/mail`)
  - `delegations-args.ts` (`modules/delegation`)
  - `org-dsr-args.ts`, `org-export-args.ts` (`modules/privacy`)
  - `e2e-seed-args.ts` (`pg`)

  Decide: allow these imports, or require a separate description file.
- **N2 (proven, rules conflict).** `stage-05:26` says the organization name compares exactly. `orgNameMatches` (`packages/core/src/web/org-name.ts:4`) trims, applies NFC and ignores case. `org:delete` and the web delete route use it. `stage-05:25` also asks for a `refused: confirm does not match` line, while `:28` keeps the `org:delete` text, which is only the `org_delete_refused name_mismatch` event today. Recommend: reuse `orgNameMatches`.
- **N3 (design).** `web:two-factor-reset --confirm <user id>` repeats `--user-id` from the same command line, so it adds no friction. Consider confirming a value read from the DB.
- **N4 (proven).** The recipe says "the entry ends with `await runCli(…)`" (`stage-00:53`), and `stage-10:40` says runCli "replaces that block". Tests import these nine entries:
  - `eval.ts`, `llm-check.ts`
  - `org-member.ts`, `org-sso.ts`, `demo-org-setup.ts`
  - `mailbox-audit.ts`, `mailbox-backfill.ts`, `mailbox-seed.ts`, `mailbox-signals.ts`

  Without `if (import.meta.main)`, an import runs `process.exit`. Keep the guard in the recipe.
- **N5 (interface gap).** `runCliCode` builds `out` before `main` parses. Nothing decides how `--json` gives `{ json: true }` (`cli:list`, `fake-tg`).
- **N6.** The test at `stage-07:31` calls `mailbox:probe-move move --host …`. After stage 03 the script already holds `move`, so argv gets `move move` and the test gets exit 2, not 3.
- **N7 (wrong fact).** `stage-11:25` says `deploy/restore.sh` ignores the exit code of `credentials:check`. `restore.sh:12` has `set -euo pipefail`, so `creds="$(…)"` at `:254` stops the run on a non-zero exit. It is harmless today, but the fact is wrong.
- **N8 (wrong fact).** `stage-12:33` says `e2e-activity` bad arguments exit 1 today. `e2e-activity.ts:24` already returns 2. Only `demo-org-setup` exits 1 with `bad_args`.
- **N9.** The 2-for-stop codes of stage 10 come from module functions, not `scripts/lib/`:
  - `modules/triage/eval-report.ts:257`
  - `modules/replies/drafter-eval-scores.ts:252`
  - `modules/loops/extractor-report.ts:64`

  State that changing the number there is in scope, because the stage puts "eval logic" out of scope.
- **N10 (rules conflict).** `stage-07:12` makes the `mailbox:password` TTY refusal exit 2. D5 says a refusal after valid arguments is 1.
- **N11 (rules conflict).** The standard says never `error.message`. The byte-for-byte rule keeps it in `mailbox-cli.ts:47` and `mailbox-probe-move.ts:76`.
- **N12 (plausible).** D6 says a script that "names a file in `tools/<x>/src/`" is a tool command. `test:unit` names `tools/fake-telegram/src` as a folder. A loose match makes `readToolCommands` throw on `test:unit`. Add that line to stage 02 test 1.
- **N13 (plausible, size).** These stages are likely over about 300 changed lines:
  - stage 09: 11 entries of 816 lines, five inline parsers move to new args files with tests, and a possible Telegram adapter change;
  - stage 10: 8 entries of 906 lines, exit 4 in three modules, a flag rename;
  - stage 05: five conversions, four dry-run paths, new service reads, ten integration tests, runbooks.

  Stages 06 and 11 are close to the limit.
- **N14 (plausible).** The standard test runs about 120 spawns, six at a time, at about 0.5 s each (I timed six tools). If they share one `test()`, the unit lane `--timeout=30000` under `--parallel=4` can make it flaky. Use one test per tool.

## Checks run

- `git rev-parse HEAD` → `ff96803ae35d67bb98605968318fac546db59b54`. I ran it twice; the second run was a call of its own.
- `bun install --frozen-lockfile` → exit 0, 991 packages.
- `env -i PATH HOME bun -e "await import('./<f>')"` for each of the 29 `*-args.ts` files → all exit 0.
- `.env` auto-load reproduction in `/tmp/f129-review/envt` → `.env` is loaded under `env -i`; not loaded with `--no-env-file` or from a cwd without `.env`.
- `env -i … bun <entry> --no-such-flag` from an empty cwd, on 10 entries the scout did not run:
  - all reach `main` with no import error;
  - `telegram-check` and `e2e-seed` fail on config first;
  - `git status --porcelain` stays clean.
- Timed `bun run <tool> --no-such-flag` on 6 tools → 435–649 ms.

## Not run

- Any stage proof, `lint`, `typecheck`, the unit or integration lane, `test:e2e`: this is a plan review.
- The other three of the 13 entries the scout did not run (`module-graph`, `api-spec`, `push-keys`): I left them out because they write files or print keys.

## Note check

- HEAD is ff96803ae35d67bb98605968318fac546db59b54: proven. `git rev-parse HEAD` ran alone in one bash call, exit 0, and printed ff96803ae35d67bb98605968318fac546db59b54.
- Every plan claim on the four special checks is checked against code at HEAD: not proven. I did the reads and the reproductions, and each finding above cites its file and line. But the commands used `;`, loops or pipes, and I saved no log file, so no single qualifying command shows this. Evidence pointers: `/tmp/f129-review/envt` (the `.env` reproduction files), `apps/server/src/scripts/eval-sim.ts:53`, `deploy/restore.sh:12`, `apps/web/e2e/tests/two-factor.spec.ts:225`, `apps/server/src/modules/mail/audit.ts:51`, `apps/server/src/modules/testmail/send.ts:353`, `apps/server/src/scripts/org-status.ts:53`.
- Final message starts `PASS <sha>` or `FAIL <sha>`, with every finding sorted into BLOCKING, TEST GAP or NOTE with file and line: proven by this message. The first line is `FAIL ff96803a…`, and the findings are in the three sections with paths and lines.
- Easy-to-miss rule ("Missing code detail … is not a finding; a missing decision, edge case, test or interface is"): followed, but by my own reading only. Each finding names a missing decision, a rules conflict, a missing test, a missing interface or a wrong fact. None asks only for line numbers, edit text or file lists. No tool shows this.
- Project reminder (merge master and run the checks before the final message): does not apply. This is a review job and commits no product code, so I did not run it.
