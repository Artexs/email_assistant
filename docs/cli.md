# CLI standard

Every command-line tool of the repository follows this page. A tool is a `package.json` script that runs a file in `apps/server/src/scripts/` or `tools/<name>/src/`. An agent finds each tool, its risk and its exit codes with `bun run cli:list` and `bun run <tool> --help`. The list comes from the tools' own descriptions, so it cannot go stale. Design input: `notes/2026-11-15-cli-standard.md`. Build plan: `spec/features/active/F129-*/plan.md` (decisions D1–D13). Old tools move to this standard stage by stage; `apps/server/src/scripts/cli-pending.json` names the files that are not converted yet.

The pure vocabulary (`CliDescription`, `CLI_RISKS`, `CLI_NEEDS`, `EXIT`, `UsageError`, `renderHelp`, `renderToolTable`, `cliDescriptionSchema`) is in `packages/core/src/cli/`. The runtime (`runCli`, `runCliCode`, `exitCodeOf`) is in `apps/server/src/platform/cli.ts`.

## Name and place

- A server tool is `apps/server/src/scripts/<area>-<verb>.ts`. A dev tool with its own workspace is `tools/<name>/src/cli.ts`.
- The `package.json` name is `<area>:<verb>`, kebab-case parts.
- Several commands of one area may share one file. The first argument is then the subcommand (`rules add`), and each command has its own `package.json` name and description.
- In `scripts/`, only `<entry>.ts` and `<entry>-args.ts` (with its test) sit next to each other. Every other helper lives in `scripts/lib/`. `scripts-layout.test.ts` checks it.

## Arguments

- Flags only, kebab-case, `--name value`.
- Positional arguments: only a subcommand, or one main operand that callers already use: `db:worktree <name>`, `release:prepare <x.y.z>`, `fake-tg send <text>`, `fake-tg wait <regex>`. `scripts/limen-prepare.sh`, the release checklist and the e2e helpers call them so.
- The parser is a pure function in `<entry>-args.ts`. It returns a typed value or throws `UsageError`. An unknown flag is a usage error (strict mode). It reads no config and opens no DB.
- Check each value: ids with `z.uuid()`, numbers with bounds, enums by their list.
- `--help` or `-h` before any `--` prints the help text on stdout and exits 0. `main` does not run. After `--`, the words are operands: `fake-tg send -- -h` sends `-h`.
- `--help` loads no config, opens no DB and needs no env.
- No interactive prompt. An agent cannot answer one. Input comes from flags, env or stdin.
- A secret never comes from an argument (it shows in `ps` and in the shell history). It comes from stdin, with no TTY, or from env.

## Exit codes

One table for all tools.

| Code | Meaning                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- |
| 0    | Done.                                                                                        |
| 1    | Failed: a check found a problem, or the tool refused after valid arguments.                  |
| 2    | Usage: bad or missing arguments. Nothing ran.                                                |
| 3    | Unreachable: the DB, GreenMail, IMAP, Telegram or the LLM did not answer in time.            |
| 4    | Incomplete: stopped at a cap or a limit. Run it again to continue (`eval --sim` at its cap). |

- A tool may say what a code means for it in `exits` (one clause per code 1, 3, 4). `--help` prints it.
- Exit 130 (Ctrl-C) is not in the table. `runCli` installs no signal handler. A long run leaves a state that the next run continues, and its lock files stay as they are.
- An uncaught error exits 1 with one `describeError` line and no stack. An unreachable outside system exits 3 with one line `[prefix] unreachable: …`.

## Output

- Human text goes through `createCliOutput`: results on stdout, problems on stderr, `[name] text`. `write` and `writeErr` print exact bytes for machine output that a person or a test reads line by line.
- Content: ids, codes, counts and dates. No mail text, subject, address, secret or server error text. A tool whose job is to show an address names that exception in `outputNote` of its description.
- Exception to the log rule, from `docs/code-patterns.md` § Logs: an existing print of `error.message` in a mail-connection script (`mailbox-cli.ts`, `mailbox-probe.ts`, `mailbox-check.ts`, `mailbox-connect.ts`, `mailbox-rescan.ts`) stays. A new one is allowed only in a mail-connection script, never for a Telegram error.
- `--json` only for a tool whose output another program parses. Stdout then holds exactly one JSON value and nothing else (`out.json(value)`); human lines go to stderr. The schema is a Zod schema next to the args file.
- English only. No colors, no spinners.
- A long run prints one progress line per step or per N items, not per item.
- Event lines (`createLog`, for example `org_delete_refused`) stay in the tools that have them.

## Description

The args file of each entry exports one description per `package.json` name:

```ts
export const cliDescriptions = [
  {
    name: "mailbox:check",
    summary: "Connects to one mailbox and prints the folder counts.",
    risk: "read",
    needs: ["db", "imap"],
    usage: "bun run mailbox:check --org-id <uuid> --mailbox-id <uuid>",
  },
] satisfies readonly CliDescription[];
```

- `summary`: one sentence, at most 100 characters, ends with `.`.
- `needs`: `["none"]`, or a list of `db`, `greenmail`, `imap`, `smtp`, `telegram`, `llm`, `agentmail`, `dns`, `vps`, `docker`, `git`. `none` never mixes with another.
- `usage`: the first line starts with `bun run <name>`. More lines are allowed. No `usage:` prefix.
- `cliDescriptionSchema` checks these rules.
- The args file must be safe to import with no env: it reads no config, connects to no DB and calls no outside system at load. Imports of modules are allowed.

`--help` prints `renderHelp` of the description:

```
usage: bun run org:status --org-id <uuid>
Prints one organization.
risk: read · needs: db
exit: 0 done · 1 failed · 2 usage · 3 unreachable · 4 incomplete
```

## `bun run cli:list`

Prints one row per tool command: name, risk, needs and summary, sorted by name. `--json` prints the same as one JSON value. A tool whose entry file is absent (the server image has no `tools/*/src`) shows `-`, `-`, `not in this install`. The list reads the descriptions, so a new tool appears with no edit of a list.

## Risk classes

| Risk      | Examples                                                                         | Rule for agents                                                             |
| --------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `read`    | `org:status`, `mailbox:check`, `stats:week`, `cli:list`                          | Run freely.                                                                 |
| `dev`     | `mailbox:seed`, `e2e:seed`, `job:run`, `fake-tg`                                 | Run freely on the dev or job DB.                                            |
| `write`   | `rules:add`, `org:flag`, `delegates:add`                                         | Run freely on the dev or job DB.                                            |
| `cost`    | `eval`, `llm:check`, `triage:label`                                              | Spends money: only when the task names it, inside the caps.                 |
| `outside` | `testmail:remote`, `testmail:send`, `telegram:check` (real bot)                  | Touches a real outside system: only with the owner's OK.                    |
| `danger`  | `org:delete`, `org:dsr`, `org:export`, `org:break-glass`, `web:two-factor-reset` | Only with the owner's OK, and each run that changes data needs `--confirm`. |

- A `danger` run that changes data needs `--confirm <organization name>`, compared with `orgNameMatches` as `org:delete` and the web delete do. `org:dsr --erase` takes `--confirm <address>`. A missing confirm exits 2. A wrong one exits 1 and changes nothing. Read modes and `org:export` need no confirm. `--dry-run` exists only where a tool has it today.
- No extra environment check blocks the operator on the VPS: `--confirm` is the only guard.
- The same tools work in production: `$C run --rm cli bun run <name>`.
- There is no shared "not a dev DB" guard. The existing refusals (`e2e:seed`, `db:worktree`) stay.

## Code shape

- The entry file parses first, then loads config, then calls one module service function, prints, and returns the exit code. Nothing runs before the parse.
- A tool that touches the DB calls the service function of a module index, as a route does. It does not query a repository (`docs/code-patterns.md` § Layers and borders, ADR 0023).
- A tool runs with no tenant scope, so an organization-specific tool takes `--org-id`.
- `process.exit`, `process.stdout.write` and `process.stderr.write` appear only in `platform/cli.ts` and in `tools/fake-telegram/src/cli-run.ts` (a tool never imports `apps/`). Lint enforces it.

## Checks

- `scripts/cli-standard.test.ts` (unit lane) runs one test per tool command: the description matches the `package.json` name; `bun --no-env-file <file> [subcommand] --help` with env `{PATH, HOME}` exits 0; `--no-such-flag` exits 2. `--no-env-file` is needed because Bun loads a `.env` from the working directory, also under `env -i`.
- Lint: the three process calls above fail outside the two exit sites.
- `capability-map.test.ts` stays: each script that `docs/capabilities/*.md` names exists in `package.json`.

## Tests of a tool

- Args file: a unit test with one valid case and each invalid case → usage.
- A tool with DB effect: one integration test that spawns it, checks the exit code, the stdout lines and the DB rows.

## Convert a tool

Steps for stages 05–15 of F129. Do them in this order.

1. The args file exports `cliDescriptions` and a parser that throws `UsageError` or returns a typed value. An inline parser moves there.
2. The entry ends with `if (import.meta.main) await runCli({ prefix, descriptions: cliDescriptions, main, close })`. Tests import entries, so the `import.meta.main` guard stays. `main` parses first, then loads config. A tool with its own outer catch returns `exitCodeOf(error)` and prints `unreachable:` for 3.
3. `process.exit`, `process.stdout.write` and `process.stderr.write` become a return code, `out.write` and `out.writeErr`.
4. Bad arguments return 2. A refusal returns 1. An unreachable outside system returns 3.
5. Change every caller of a changed code or usage line in the same commit: grep `.github/`, `scripts/*.sh`, `deploy/`, `apps/web/e2e`, `apps/docs/e2e`, `apps/server/test`, `docs/`, `evals/`.
6. Remove the file from `cli-pending.json`. Never add one back.
7. Args unit test: one valid case and each invalid case → usage.

Output text stays byte for byte, except usage lines, the exit codes of this page and the line of an unreachable error.

## Outside the standard

`scripts/one-off/`, the shell scripts in `scripts/*.sh` and `apps/docs/scripts/`.
