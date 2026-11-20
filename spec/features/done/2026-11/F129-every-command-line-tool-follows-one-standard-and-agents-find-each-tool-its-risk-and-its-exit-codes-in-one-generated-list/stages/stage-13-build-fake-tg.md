# F129 stage 13 — Build tools and `fake-tg`

Needs stage 00: `@ea/core` `CliDescription`, `EXIT`, `UsageError`, `renderHelp`. Needs stage 01: `runCli`. Needs stage 02: `cli-pending.json` group `build`, the standard test and the lint exception for `tools/fake-telegram/src/cli-run.ts`. Needs stage 04: `scripts/lib/module-graph-build.ts`, `lib/api-spec-build.ts`, `lib/check-migrations-rules.ts`. May run next to 05–12, 14 and 15.

Part of [`../plan.md`](../plan.md). Decisions: D2, D5, D7, D12. Recipe: `docs/cli.md` § Convert a tool.

## Tools

| Command | Risk | Needs | Notes |
| --- | --- | --- | --- |
| `graph:modules` | dev | none | writes the generated module graph files; no `parseArgs` today: a strict empty parse first |
| `api:spec` | dev | none | writes the spec; `--check` compares only (exit 1 on drift) |
| `db:check-migrations` | read | none | CI step expects exit 0 |
| `fake-tg` | dev | none | `serve` opens a port (`--port`, default fixed); other subcommands need a running fake (`exits[3]`: "the fake server did not answer") |

`dev` for build tools: they change only generated files in the checkout.

## Step 1 — Convert the three server tools

- Follow the recipe. `graph:modules` and `api:spec` must not write a file before the parse: `--help` and `--no-such-flag` leave `git status` clean (test 3).

## Step 2 — `fake-tg` on the shared vocabulary

- **Files:** `tools/fake-telegram/src/cli-args.ts` (new: `cliDescriptions` with one item `fake-tg`, the option table, the parser), `cli-run.ts` (new: the only file of the tool that calls `process.exit` or writes to the process streams), `cli.ts` (main logic, returns a code).
- **Interface:** `cli-run.ts` exports `runToolCli({ prefix, descriptions, main, argv? }): Promise<never>` with the `runCliCode` contract of stage 01 (read `platform/cli.ts`; do not import it) for `--help`, `UsageError` → 2 and exit codes; it imports only `@ea/core` and `node:` modules. The local `UsageError` class and `EXIT_*` constants go; `@ea/core` `UsageError` and `EXIT` replace them. `FakeTelegramUnreachable` → 3 stays.
- **Decisions:** text output stays byte for byte; the global `--json` flag keeps its meaning (one JSON value on stdout, D4). `send <text>` and `wait <regex>` keep their positional operand (the plan's positional rule: an existing main operand).
- `tools/fake-telegram` never imports `apps/` (D12); a test asserts it (test 4).

## Test

1. `cli-args` unit test: `["press", "--button", "OK"]` → typed; `["press"]` → usage (neither `--button` nor `--data`); `["read", "--last", "-1"]` → usage; `["nope"]` → usage.
2. `cli.test.ts` existing cases pass; `fake-tg --help` → 0 and prints the summary (was 2).
3. `bun run graph:modules --no-such-flag` → exit 2 and `git status --porcelain` empty afterwards; same for `api:spec`.
4. A unit test reads every `tools/fake-telegram/src/*.ts` import specifier: none starts with `apps/` or a relative path that leaves `tools/`.
5. `fake-tg read --url http://127.0.0.1:1` → exit 3 (existing case if present; else add it).

**Guard check:** add `import "../../../apps/server/src/platform/cli.ts"` to `cli.ts` → test 4 fails; remove it. Name both runs in the final message.

## Out of scope

Fake server behaviour; per-job ports for `fake-tg serve` (F136 owns the e2e ports).

## Done when

Steps 1–2 done; the four files are out of `cli-pending.json`; the standard test passes for them; the plan.md Proof with `s13` and `&& bun run test:e2e > /tmp/f129-s13/e2e.log 2>&1` before `echo PROOF_OK` prints `PROOF_OK` (`fake-tg serve` is the Playwright Telegram server), under the lock rule `CLAUDE.md` states at HEAD; `deploy/compose.sim.yaml` still starts it with the same command.
