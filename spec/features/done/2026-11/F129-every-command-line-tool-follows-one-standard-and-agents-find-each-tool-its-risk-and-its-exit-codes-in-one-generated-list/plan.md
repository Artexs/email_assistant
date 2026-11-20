# F129 plan — one CLI standard and a generated tool list

> **Status 2026-11-20 — planned.** Plan base: 34374ba0. 17 stages (00–16), none built. Cold review 1 fixed.

## Input

Owner, 2026-11-15 (note § 8, word for word): "all three defaults accepted." "Q1 … all now, in stages (engineering time is abundant)." "Q2 … yes for `read`/`dev`/`write`; `cost` only when the task names it; `outside` and `danger` only with your OK." "Q3 … yes, one set of tools for dev and production." Input: `notes/2026-11-15-cli-standard.md`, `scouts.md`.

- **D1 Description.** Each tool's description lives in its `<entry>-args.ts` (safe to import with no env: no config read, DB connect or outside call at load; module imports are allowed, nine args files have them): `export const cliDescriptions = [...] satisfies readonly CliDescription[]`, one item per `package.json` name. A tool parsed inline gets an args file. Rejected: a hand registry (stale).
- **D2 Pure part in `@ea/core`** (`packages/core/src/cli/`, main index, no `package.json` change): `CliDescription`, `CLI_RISKS`, `CLI_NEEDS`, `EXIT`, `UsageError`, `renderHelp`, `renderToolTable`. `fake-tg` uses it too. Shapes: stage 00.
- **D3 Runtime in `platform/cli.ts`:** `runCliCode({ prefix, descriptions, main, argv?, close? }): Promise<number>`; `runCli(...)` exits with it. `--help`/`-h` before any `--` → help, exit 0, `main` not called; usage error → 2; unreachable → 3; other error → 1, one `describeError` line, no stack. `exitCodeOf(error): 1 | 3` is exported for tools with their own outer catch. Detail: stage 01.
- **D4 Output.** `createCliOutput` gains `write`, `writeErr` (exact bytes) and `json(value)`; with `--json`, `print` goes to stderr.
- **D5 Exit codes** (`docs/cli.md`): 0 done; 1 failed or refused (a refusal after valid arguments is 1; `mailbox:audit` lost mail was 2); 2 usage only, nothing ran; 3 unreachable; 4 incomplete (`eval --sim` at its cap, `testmail:send` not done; both were 2). 130 = interrupted by Ctrl-C: `runCli` installs no signal handler; locks and resume stay as now.
- **D6 `cli:list`** = `apps/server/src/scripts/cli-list.ts` (risk `read`, needs `none`). `scripts/lib/cli-tools.ts`: `readToolCommands(rootDir): ToolCommand[]` parses root `package.json`; the description file of `<dir>/<base>.ts` is `<dir>/<base>-args.ts`. A missing entry file → row `not in this install` (the image has no `tools/*/src`). Detail: stage 02.
- **D7 Risk rule for agents** (owner Q2): `read`, `dev`, `write` freely on the dev or job DB; `cost` only when the task names it, inside the caps; `outside` and `danger` only with the owner's OK. Same tools in production through `$C run --rm cli bun run <name>` (Q3).
- **D8 Danger guard.** `danger` = `org:delete`, `org:dsr`, `org:export`, `org:break-glass`, `web:two-factor-reset`. Each run that changes data needs `--confirm <organization name>` (compared with `orgNameMatches`, as `org:delete` and the web delete do), except `org:dsr --erase --confirm <address>` as today. Missing → exit 2; wrong → exit 1, nothing changed. New: `org:break-glass` set and `--clear`, `web:two-factor-reset`. `--dry-run` only where a tool has it today (new dry-run paths need new service reads: rejected). Read modes and `org:export` need no confirm. No VPS environment check (edge 12).
- **D9 No new dev-DB guard.** Existing refusals stay (`e2e:seed`, `db:worktree`). Rejected: a shared guard (job, e2e and sim DBs share no signal).
- **D10 Layout.** `scripts/<entry>.ts` and `scripts/<entry>-args.ts` (with its test) only; every other helper moves to `scripts/lib/`. `scripts-layout.test.ts` checks it. Four path-only entries get `package.json` names (stage 03).
- **D11 Standard test** `scripts/cli-standard.test.ts` (unit lane): one test per tool command: a matching description; `bun --no-env-file <file> [sub] --help` with env `{PATH, HOME}` exits 0 (Bun loads a cwd `.env` even under `env -i`); `--no-such-flag` exits 2. Pending tools: `apps/server/src/scripts/cli-pending.json`, `{ "<area>": ["<file>", …] }`, one file per line (tool entries, and `scripts/lib/` helpers that still write to the process streams); spawn checks skip them. Detail: stage 02.
- **D12 Lint.** `no-restricted-properties` on `process.exit`, `process.stdout.write`, `process.stderr.write` in `apps/server/src/scripts/**` and `tools/*/src/**` (non-test), except `platform/cli.ts` and `tools/fake-telegram/src/cli-run.ts`, and except the files in `cli-pending.json`.
- **D13 Inventory** (note § 4.10, checked by scout 3): the table with reasons is in stage 03; the owner-facing rows are Decisions taken 1, 4, 5.

## Facts checked (planner, at 34374ba0)

- `scripts/`: 131 non-test files, 57 named entries, 67 commands into it, plus `fake-tg` (`package.json`).
- `platform/cli.ts` has only `createCliOutput`; `describeError`, `SoftError` are in `platform/errors.ts`; DB pool `connectionTimeoutMillis: 5000`.
- No tool answers `--help`; none loads config at top level; `org-member`, `org-sso` and the four `mailbox-cli` tools load config before the parse (scout 1, `env -i` run).
- The image has root `package.json` and `apps/server`, no `tools/*/src` (`deploy/Dockerfile`).
- `gemini:test` is in `package.json`; F138 is in `dropped/`. Callers that read codes or text: scout 2 items 1–5, review 1.
- `provider-scan.test.ts` names `scripts/eval-config.ts`; `file-size.test.ts` names `scripts/sim-*.ts`.

## Not verified

- Every unreachable path ends in 3 within its timeout (IMAP, Telegram, LLM): each area stage tests one tool per outside system it owns.

## Done when

1. `bun run cli:list` prints one row per tool command; `--json` prints one JSON value that `cliListSchema` parses.
2. `--help` exits 0 for every tool with no env and no `.env`; `--no-such-flag` exits 2.
3. `cli-pending.json` is gone; `cli-standard.test.ts` has no pending path and passes in `bun run test:unit:ci`.
4. `bun run lint` passes; a `process.exit` added to any script fails it (stage 16 shows it).
5. `inventory.md` lists each D13 row with its result; `gemini:test` is in no `package.json` and no doc.
6. `bun run test:int:ci` and `bun run test:e2e` pass at the last stage.
7. `docs/cli.md` holds the standard; `CLAUDE.md` and the styleguide point to it and to `cli:list`.

## Rules for every stage

- Text stays byte for byte except usage lines, the D5 exit codes and an unreachable error's line (`[prefix] unreachable: …`, via `exitCodeOf`). Every caller of a changed code or usage line changes in the same stage: grep `.github/`, `scripts/*.sh`, `deploy/`, `apps/web/e2e`, `apps/docs/e2e`, `apps/server/test`, `docs/`, `evals/`.
- Parse before `loadConfig`; nothing runs before the parse.
- Remove only your own lines from `cli-pending.json`; never re-add one.
- No tool behaviour changes beyond D5, D8 and D13. A gap or deviation is a question in the final message.
- Format only your files. No secrets, addresses or mail text in output or tests.
- F103 D26 event lines stay.
- Proof (styleguide check line, one chain, last command):
  `mkdir -p /tmp/f129-sNN && bun run lint > /tmp/f129-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f129-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f129-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f129-sNN/int.log 2>&1 && echo PROOF_OK`
- A stage that changes a tool Playwright runs, or its caller, adds `bun run test:e2e` to its chain, under the lock rule that `CLAUDE.md` states at HEAD.

## Stages

Parallel groups: **G1** {00, 03}; **G2** {01 (needs 00), 04 (needs 03)}; then 02 (needs 01, 04); **G3** {05–15}, each needs 02 (`runCli`, `cli-pending.json`) and 04 (`scripts/lib/`), all next to each other; **G4** 16 needs 05–15. No migration, no `bun.lock` change.

Files: [00 core and docs](stages/stage-00-core-and-docs.md) · [01 runCli](stages/stage-01-runtime.md) · [02 list, test, lint](stages/stage-02-list-test-lint.md) · [03 inventory](stages/stage-03-inventory.md) · [04 lib/](stages/stage-04-helpers-to-lib.md) · [05 danger](stages/stage-05-danger-tools.md) [risky] · [06 org](stages/stage-06-org-web.md) · [07 mailbox](stages/stage-07-mailbox.md) · [08 mailbox-cli](stages/stage-08-mailbox-cli.md) · [09 rules, delegation](stages/stage-09-rules-delegation.md) · [10 eval, sim, llm](stages/stage-10-eval-sim-llm.md) · [11 testmail, ops](stages/stage-11-testmail-ops.md) · [12 e2e, dev DB](stages/stage-12-e2e-dev.md) · [13 build, fake-tg](stages/stage-13-build-fake-tg.md) · [14 Telegram, reports](stages/stage-14-telegram-reports.md) · [15 lab, triage](stages/stage-15-lab-triage.md) · [16 close](stages/stage-16-close.md).

## User checkpoints and owner steps

- No checkpoint stops the build. Record, after the release that carries stage 16 (coordinator, VPS): `$C run --rm cli bun run cli:list` shows every server tool and `fake-tg  not in this install`; `$C run --rm cli bun run org:status --help` exits 0.

## Review

Stage 05: `claude-opus-5-5`. Stages 02, 16: `claude-sonnet-5-5`. Others land on the proof.

## How to run (coordinator)

Spawn per `spec/build.md` TRACK: "Implement F129 stage NN (ticket.md, plan.md, stages/stage-NN-*.md). Final proof: the plan.md Proof with sNN." Start by the groups. `limen land <job> --yes --keep-open` except stage 16. A land conflict in `cli-pending.json`, `package.json` or a doc: merge master, re-prove.

## Decisions taken

Planner defaults (detail and undo: `questions.md`); the coordinator copies them to `docs/owner-decisions.md`.

1. scope · `gemini:test` removed; `llm:check --provider gemini` does the same (D13).
2. user-visible · `org:break-glass` (set, clear) and `web:two-factor-reset` need `--confirm <organization name>` (D8).
3. user-visible · bad arguments exit 2, refusals and `mailbox:audit` lost mail exit 1, stops exit 4 (D5).
4. user-visible · `eval --json <file>` becomes `--json-out <file>` (D13).
5. scope · `testmail` stays in the server for now (D13).
6. rule-exception · `fake-tg` has its own exit site `tools/fake-telegram/src/cli-run.ts` (D12).
7. scope · no new dev-DB guard (D9).
8. rule-exception · positional operands stay for `db:worktree`, `release:prepare`, `fake-tg send`/`wait` (stage 00).

## Planning progress

- [written] plan.md, questions.md, scouts.md (4 scouts), stages 00–16.
- Word counts: see the last commit message.

## Cold review

`claude-opus-5-5` (stage 05 is [risky]). `plan-review-1.md`: 5 blocking, 4 test gaps, 14 notes, all taken; N11 resolved by naming the `docs/code-patterns.md` § Logs exception in `docs/cli.md`. Main changes: stage 02 needs 04 (B1); no-env spawn by `--no-env-file` (B2); D8 without new dry-run paths, break-glass modes, Playwright callers (B3); `mailbox:audit` 2 → 1, `testmail:send` 2 → 4 (B4); `exitCodeOf` (B5); stages 09 and 10 split into 14 and 15 (N13).

## Log
