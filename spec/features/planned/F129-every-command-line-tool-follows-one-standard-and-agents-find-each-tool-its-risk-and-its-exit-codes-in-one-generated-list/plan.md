# F129 plan — one CLI standard and a generated tool list

> **Status 2026-11-20 — planned.** Plan base: 34374ba0. 15 stages (00–14), none built.

## Input

Owner, 2026-11-15 (note § 8, word for word): "all three defaults accepted." The defaults: "Q1 … all now, in stages (engineering time is abundant)." "Q2 … yes for `read`/`dev`/`write`; `cost` only when the task names it; `outside` and `danger` only with your OK." "Q3 … yes, one set of tools for dev and production." Design input: `notes/2026-11-15-cli-standard.md` (§ 4 standard, § 4.10 inventory, § 6 edge cases). Scout packets: `scouts.md`.

- **D1 Description.** Each tool's description lives in its `<entry>-args.ts` (pure: no config, DB or module import): `export const cliDescriptions = [...] satisfies readonly CliDescription[]`, one item per `package.json` name. A tool parsed inline gets an args file. Rejected: a hand registry (stale); importing entry files (loads the server).
- **D2 Pure part in `@ea/core`** (`packages/core/src/cli/`, main index, no `package.json` change): `CliDescription`, `CLI_RISKS`, `CLI_NEEDS`, `EXIT`, `UsageError`, `renderHelp`, `renderToolTable`. `fake-tg` uses it too. Shapes: stage 00.
- **D3 Runtime in `platform/cli.ts`:** `runCliCode({ prefix, descriptions, main, argv?, close? }): Promise<number>`; `runCli(...)` exits with it. `--help` → help, exit 0, `main` not called; usage error → 2; unreachable → 3; other error → 1, one `describeError` line, no stack. Detail: stage 01.
- **D4 Output.** `createCliOutput` gains `write`, `writeErr` (exact bytes) and `json(value)` (one JSON value; with `--json`, `print` goes to stderr). Existing text stays byte for byte (F103 D23).
- **D5 Exit codes** (`docs/cli.md`): 0 done; 1 failed or refused (a refusal after valid arguments is 1, not 2; each area stage names its cases); 2 usage only, nothing ran; 3 unreachable; 4 incomplete (`eval --sim` at its cap, was 2). 130 = interrupted by Ctrl-C: `runCli` installs no signal handler; locks and resume stay as now.
- **D6 `cli:list`** = `apps/server/src/scripts/cli-list.ts` (risk `read`, needs `none`). `scripts/lib/cli-tools.ts`: `readToolCommands(rootDir): ToolCommand[]` parses root `package.json`; a tool command is exactly `bun <apps/server/src/scripts|tools/<x>/src>/<base>.ts[ <subcommand>]`; its description file is `<dir>/<base>-args.ts`. A missing description file → row `not in this install` (the image has no `tools/*/src`). Detail: stage 02.
- **D7 Risk rule for agents** (owner Q2): `read`, `dev`, `write` freely on the dev or job DB; `cost` only when the task names it, inside the caps; `outside` and `danger` only with the owner's OK. Same tools in production through `$C run --rm cli bun run <name>` (Q3).
- **D8 Danger guard.** `danger` = `org:delete`, `org:dsr`, `org:export`, `org:break-glass`, `web:two-factor-reset`. A danger tool that changes data needs `--confirm <exact value>` and has `--dry-run` (prints the counts it would change, changes nothing, exit 0; `--confirm` not needed with it). Missing `--confirm` = exit 2; wrong value = exit 1, nothing changed. `org:export` changes nothing: no confirm. No environment check on the VPS (edge 12). Per tool: stage 05.
- **D9 No new dev-DB guard.** The existing refusals stay (`e2e:seed` "not an e2e database", `db:worktree` loopback). Rejected: one shared guard: job, e2e and sim DBs have no common signal.
- **D10 Layout.** `scripts/<entry>.ts` and `scripts/<entry>-args.ts` (with its test) only; every other helper moves to `scripts/lib/`. `scripts-layout.test.ts` fails on any other top-level file. Four entries without a name get one: `e2e:job-env`, `e2e:activity`, `e2e:suggestions`, `demo:org-setup` (callers by path keep working).
- **D11 Standard test** `scripts/cli-standard.test.ts` (unit lane): per tool command, a matching description, `--help` exit 0 under `env -i`, `--no-such-flag` exit 2. Pending tools: `apps/server/src/scripts/cli-pending.json`, `{ "<area>": ["<file>", …] }`, one file per line; spawn checks skip them. Detail: stage 02.
- **D12 Lint.** `no-restricted-properties` on `process.exit`, `process.stdout.write`, `process.stderr.write` in `apps/server/src/scripts/**` and `tools/*/src/**` (non-test), except `platform/cli.ts` and `tools/fake-telegram/src/cli-run.ts`, and except the files in `cli-pending.json`. `fake-tg` gets its own small runner: a tool never imports `apps/`.
- **D13 Inventory** (note § 4.10, checked by scout 3): remove `gemini:test` (an alias; F138, which was to remove it, is dropped); merge the two mailbox probes into one file, both names stay; keep `testmail:*` (the only real outside delivery path; its move to `tools/` belongs to the AgentMail replacement, `06-architecture-review.md` § 3.17); keep `triage:cost` (per-model view; shares only the price function with M7); keep `org:invite`/`web:invite` and `mailbox:seed`/`testmail:send`; rename `eval --json <file>` to `--json-out <file>`. Table with reasons: stage 03.

## Facts checked (planner, at 34374ba0)

- `scripts/`: 131 non-test files, 57 named entries, 67 commands into it, plus `fake-tg` (`package.json`).
- `platform/cli.ts` has only `createCliOutput`; `describeError`, `SoftError` are in `platform/errors.ts`; DB pool `connectionTimeoutMillis: 5000`.
- No tool answers `--help`; none loads config at top level; `org-member`, `org-sso` and the four `mailbox-cli` tools load config before the parse (scout 1, `env -i` run).
- The image has root `package.json` and `apps/server`, no `tools/*/src` (`deploy/Dockerfile`).
- `gemini:test` is in `package.json`; F138 is in `dropped/`.
- Callers that read codes or text: scout 2 items 1–5.
- `provider-scan.test.ts` names `scripts/eval-config.ts`; `file-size.test.ts` names `scripts/sim-*.ts`.

## Not verified

- Every unreachable path ends in 3 within its timeout (IMAP, Telegram, LLM): each area stage tests one tool per outside system it owns.

## Done when

1. `bun run cli:list` prints one row per tool command; `--json` prints one JSON value that `cliListSchema` parses.
2. `bun run <tool> --help` exits 0 for every tool under `env -i`; `--no-such-flag` exits 2.
3. `cli-pending.json` is gone; `cli-standard.test.ts` has no pending path and passes in `bun run test:unit:ci`.
4. `bun run lint` passes; a `process.exit` added to any script fails it (stage 14 shows it).
5. `inventory.md` lists each D13 row with its result; `gemini:test` is in no `package.json` and no doc.
6. `bun run test:int:ci` and `bun run test:e2e` pass at the last stage.
7. `docs/cli.md` holds the standard; `CLAUDE.md` and the styleguide point to it and to `cli:list`.

## Rules for every stage

- Text stays byte for byte except usage lines and the D5 exit codes. Every caller of a changed code or usage line changes in the same stage: grep `.github/`, `scripts/*.sh`, `deploy/`, `apps/web/e2e`, `apps/docs/e2e`, `apps/server/test`, `docs/`, `evals/`.
- Parse before `loadConfig`; nothing runs before the parse.
- Remove only your own lines from `cli-pending.json`; never re-add one.
- No tool behaviour changes beyond D5, D8 and D13. A gap or a deviation is a question in the final message, not a choice.
- Format only your files. No secrets, addresses or mail text in output or tests.
- F103 D26 event lines stay.
- Proof (styleguide check line, one chain, last command):
  `mkdir -p /tmp/f129-sNN && bun run lint > /tmp/f129-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f129-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f129-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f129-sNN/int.log 2>&1 && echo PROOF_OK`
- A stage that changes a Playwright caller adds `bun run test:e2e` to its chain, under the lock rule that `CLAUDE.md` states at HEAD.

## Stages

Parallel groups: **G1** {00, 03}; **G2** {01 (needs 00), 04 (needs 03)}; then 02 (needs 01, 03), next to 04; **G3** {05–13}, each needs 02 (`runCli`, `cli-pending.json`) and 04 (`scripts/lib/`), all next to each other; **G4** 14 needs 05–13. No migration, no `bun.lock` change.

0. [00 standard and core vocabulary](stages/stage-00-core-and-docs.md)
1. [01 runCli and output writers](stages/stage-01-runtime.md)
2. [02 cli:list, standard test, lint](stages/stage-02-list-test-lint.md)
3. [03 inventory](stages/stage-03-inventory.md)
4. [04 helpers to lib/](stages/stage-04-helpers-to-lib.md)
5. [05 danger tools](stages/stage-05-danger-tools.md) [risky]
6. [06 org and web tools](stages/stage-06-org-web.md)
7. [07 mailbox tools](stages/stage-07-mailbox.md)
8. [08 mailbox-cli tools](stages/stage-08-mailbox-cli.md)
9. [09 delegation, rules, telegram, reports](stages/stage-09-delegation-telegram.md)
10. [10 eval, sim, lab, llm](stages/stage-10-eval-sim-lab.md)
11. [11 testmail and ops](stages/stage-11-testmail-ops.md)
12. [12 e2e and dev DB tools](stages/stage-12-e2e-dev.md)
13. [13 build tools and fake-tg](stages/stage-13-build-fake-tg.md)
14. [14 close the standard](stages/stage-14-close.md)

## User checkpoints and owner steps

- No checkpoint stops the build. Record after the release that carries stage 14 (coordinator, VPS): `$C run --rm cli bun run cli:list` shows every server tool and `fake-tg  not in this install`; `$C run --rm cli bun run org:status --help` exits 0.

## Review

Stage 05 ([risky]: data-changing guards): review `claude-opus-5-5`. Stages 02 and 14: review `claude-sonnet-5-5` (the enforcement). Others land on the proof.

## How to run (coordinator)

Spawn per `spec/build.md` TRACK: "Implement F129 stage NN. Read ticket.md, plan.md and stages/stage-NN-*.md. Final proof: the plan.md Proof with sNN. List as proven only what a saved log shows." Start by the groups above. `limen land <job> --yes --keep-open` except stage 14. A land conflict in `cli-pending.json`, `package.json` or a doc: merge master, re-prove.

## Decisions taken

Planner defaults (detail and undo: `questions.md`); the coordinator copies them to `docs/owner-decisions.md`.

1. scope · `gemini:test` removed; `llm:check --provider gemini` does the same (D13).
2. user-visible · `org:break-glass` and `web:two-factor-reset` need `--confirm`; all data-changing danger tools get `--dry-run` (D8).
3. user-visible · bad arguments exit 2 everywhere, refusals exit 1, `eval --sim` cap exits 4 (D5).
4. user-visible · `eval --json <file>` becomes `--json-out <file>` (D13).
5. scope · `testmail` stays in the server for now (D13).
6. rule-exception · `fake-tg` has its own exit site `tools/fake-telegram/src/cli-run.ts` (D12).
7. scope · no new dev-DB guard (D9).
8. rule-exception · positional operands stay for `db:worktree`, `release:prepare`, `fake-tg send`/`wait` (stage 00).

## Planning progress

- [written] plan.md, questions.md, scouts.md (4 scouts), stages 00–14.
- Word counts (wc -w): plan 1500, stages 414–700, ticket 541.

## Cold review

Not run yet.

## Log
