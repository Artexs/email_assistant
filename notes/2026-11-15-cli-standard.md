# CLI standard — idea for a ticket (draft, 2026-11-15)

Status: idea. Not a ticket yet. The owner reads it, answers § 8, then a session runs
`limen ticket new` and the coordinator plans it (`plan-task`).

## 1. Outcome (what becomes true)

Every command-line tool of the repository follows one written standard. An agent finds each tool
in one list, knows what the tool does and whether it may run it without asking, and reads the
result from the exit code alone. A test fails when a tool breaks the standard.

## 2. Why

- Agents check their changes with these tools (`job:run`, `fake-tg`, `mailbox:seed`, `sim`, …).
  A clear, equal shape makes a check fast and the result certain.
- Today each tool has its own shape. An agent must read the code to know the arguments, the
  exit codes and the risk.
- New tools copy whatever old tool the agent opens first, so the differences grow.

## 3. Facts at master, 2026-11-15

- `apps/server/src/scripts/` holds 52 non-test files: 40 entry files and 12 helper files
  (`e2e-activity-rows`, `eval-judge-setup`, `eval-ledger`, `eval-sim-load`, `eval-sim`,
  `invite-delivery`, `mailbox-backfill-gate`, `module-graph-build`, `org-status-lines`,
  `pick-member`, `sim-commands`, `sim-files`). 52 `package.json` commands point at 39 of the
  entry files (some files have subcommands). `e2e-activity.ts` has no `package.json` name:
  the Playwright helpers and one test call it by path. Also `tools/fake-telegram/src/cli.ts`
  (own workspace) and `scripts/one-off/` (history, out of scope).
- Output: `createCliOutput(name)` in `apps/server/src/platform/cli.ts` (`print` → stdout,
  `fail` → stderr, `[name] text`). 11 scripts use it now. F103 stages 03–04 (active) convert
  the rest of the old log lines and set `scripts/` to lint error. F103 D23: CLI text stays
  byte for byte. 19 scripts also write with `process.stdout.write` directly.
- Event lines: `org-delete`, `org-export`, `org-dsr`, `org-break-glass`, `web-two-factor-reset`,
  `stats-week` keep `createLog` event lines on purpose (F103 D26).
- Arguments: 36 scripts use `parseArgs` from `node:util`. 19 have a separate `*-args.ts` with a
  unit test. The others parse inside the entry file. Each has a `usage` string. No script
  answers `--help`.
- Exit codes: 0 ok, 1 for almost every failure, also for bad arguments (`sim`). 7 scripts
  return 2 for bad arguments (`delegates`, `e2e-activity`, `mailbox-settings`, `org-delete`,
  `org-dsr`, `org-export`, …). `fake-tg` has the clearest set: 0 ok, 1 failed, 2 usage,
  3 unreachable. `eval --sim` uses 2 for "stopped at its cap, resume later" — a different meaning.
- Machine output: only `eval` has `--json <file>`.
- Risky actions: `org:delete --confirm <organization name>` is the only confirm pattern.
  `org:dsr` and `llm-check` have dry-run or confirm flags of their own shape.
- Secrets: `mailbox:password` reads the password from stdin only and refuses a TTY. Good
  pattern; not written as a rule.
- Database rule: `docs/code-patterns.md:43` (a DB script calls a module service function, ADR
  0023), `:250` (output through `createCliOutput`).
- Tests: 13 integration tests spawn a script as a subprocess (`apps/server/test/integration/*-cli.test.ts`)
  and compare its text. `capability-map.test.ts` checks that each script named in
  `docs/capabilities/*.md` exists in `package.json`.
- Callers outside the scripts: CI (`.github/workflows/ci.yml`), `scripts/limen-prepare.sh`
  (`db:worktree`), Playwright global setup (`e2e-seed`), runbooks in `docs/`. In production:
  `$C run --rm cli bun run <script>` (F103 stage 17).

## 4. Proposed standard (draft for `docs/cli.md`)

### 4.1 Name and place

- A server tool is `apps/server/src/scripts/<area>-<verb>.ts`; a dev tool with its own
  workspace is `tools/<name>/src/cli.ts`.
- The `package.json` name is `<area>:<verb>` (kebab-case parts), as now.
- Several commands of one area may share one file with subcommands (`rules add|list`), as now.

### 4.2 Arguments

- Flags only, kebab-case, `--name value`. Positionals only for a subcommand name.
- The parser is a pure function in `<name>-args.ts` with a unit test. It returns a typed
  result or a usage error. Strict mode: an unknown flag is a usage error.
- Ids are checked (`z.uuid()`), numbers have bounds, enums are listed.
- `--help` prints the usage and the description (§ 4.5) on stdout and exits 0. It loads no
  config, opens no DB and needs no env.
- No interactive prompts. An agent cannot answer them. All input comes from flags, env or stdin.
- A secret never comes from an argument (visible in `ps` and in the shell history). It comes
  from stdin (no TTY) or from env.

### 4.3 Exit codes (one table for all tools)

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| 0    | Done.                                                                           |
| 1    | Failed: the check found a problem, or the action was refused.                    |
| 2    | Usage: bad or missing arguments. Nothing ran.                                    |
| 3    | Unreachable: the DB, GreenMail, IMAP, Telegram or the LLM did not answer.        |
| 4    | Incomplete: stopped at a cap or a limit; run again to continue (`eval --sim`).   |

An uncaught error exits 1 with one `fail` line (`describeError`), never a stack trace with data.

### 4.4 Output

- Human text through `createCliOutput`: results on stdout, problems on stderr.
- Content: ids, codes, counts, dates. No mail text, no subject, no address, no secret, no
  server error text — the rule of F103 for logs. A tool whose job is to show an address
  (`org:delete` mailbox lines, F106 D17) names that exception in its description.
- `--json`: only for a tool whose output another program or an agent parses. Then stdout holds
  exactly one JSON value and nothing else; the schema is a Zod schema next to the args file.
- English only. No colors, no spinners (the output goes to files and agents).
- A long run prints one progress line per step or per N items, not per item.

### 4.5 Description (the source of the tool list)

Each entry script exports one `describeCli` object (or the args file does):

```ts
export const cli = {
  name: "mailbox:check",
  summary: "Connects to one mailbox and prints the folder counts.",
  risk: "read",           // see § 4.6
  needs: ["db", "imap"],  // db | greenmail | imap | smtp | telegram | llm | none
  usage: "bun run mailbox:check --org-id <uuid> --mailbox-id <uuid>",
} satisfies CliDescription;
```

`--help` prints it. `bun run cli:list` prints all of them as a table (`--json` too).
Generated, not written by hand, so it cannot go stale.

### 4.6 Risk classes (who may run what)

| Risk      | Examples                                                    | Rule for agents (owner decides, § 8 Q2) |
| --------- | ----------------------------------------------------------- | --------------------------------------- |
| `read`    | `org:status`, `mailbox:check`, `stats:week`, `cli:list`     | Run freely.                             |
| `dev`     | `mailbox:seed`, `e2e:seed`, `job:run` on the dev DB, `fake-tg` | Run freely on the dev or job DB.     |
| `write`   | `rules:add`, `org:flag`, `delegates:add`                    | Run freely on the dev or job DB.        |
| `danger`  | `org:delete`, `org:dsr`, `org:break-glass`, `web:two-factor-reset` | Needs `--confirm <exact name or id>`. Only when the task names it. |
| `cost`    | `eval`, `llm:check`, `gemini:test`, `triage:label`          | Spends money: only with the task's OK and inside the caps. |
| `outside` | `testmail:remote`, `testmail:send`, `telegram:check` on the real bot | Touches real outside systems: only with the owner's OK. |

- A `danger` tool refuses to run without `--confirm`, and supports `--dry-run` that prints what
  it would change.
- A `dev` tool refuses to run when `DATABASE_URL` points at a non-dev database (the e2e seed
  already has a `refusing:` check: make it shared).

### 4.7 Code shape

- Entry file: parse → `loadConfig` → `configureMailHosts` if it touches mail → call one module
  service function → print → return the exit code. One shared `runCli(cli, main)` helper in
  `platform/cli.ts` does the `--help`, the uncaught-error line, the DB close and `process.exit`.
- No repository call from a script (ADR 0023, `code-patterns.md:43`). Existing exception: the
  e2e seeds (`rootDeepImportExceptions`).
- A tool runs without a tenant scope, so every org-specific tool takes `--org-id`.

### 4.8 Checks (the standard enforces itself)

- Unit test `cli-standard.test.ts`, over every entry script that `package.json` names:
  it exports a description; `--help` exits 0 in under 2 s with no env; an unknown flag exits 2;
  the `package.json` name equals `cli.name`.
- Lint: `process.exit` and `process.stdout.write` only in `platform/cli.ts` (the `--json`
  writer lives there too).
- `capability-map.test.ts` stays; the tool list adds no hand-written file.

### 4.9 Tests of a tool

- Args file: unit test (valid, each invalid case → usage).
- A tool with DB effect: one integration test that spawns it (the present `*-cli.test.ts` form),
  checks the exit code, the stdout lines and the DB rows. A shared `runScript(name, args, {stdin, env})`
  helper replaces the copied `run()` functions.

## 4.10 Inventory: is the number of tools right? (owner question, 2026-11-15)

The 52 commands by area: org 9, mailbox 11, test mail 7, eval/sim/LLM/triage 6, rules/delegates/
delegations 8, Telegram 3, web 2, other 6 (`db:worktree`, `digest:times`, `e2e:seed`, `graph:modules`, `job:run`, `stats:week`). The count fits a
product with no operator console yet: most `org:*` and `mailbox:*` tools are the operator's
only way to act. But the inventory found overlaps. The first stage of the ticket checks each
candidate and decides keep, merge or remove, with the reason in the stage report.

| Candidate | Finding | Default |
| --------- | ------- | ------- |
| `gemini:test` | An alias of `llm:check --provider gemini` (README, `docs/roadmap.md`, `docs/known-alerts.md`). | Remove; update the 3 docs. |
| `mailbox:probe-move`, `mailbox:probe-send` | Same input (raw host, password on stdin, test mailbox only); `mailbox:check --probe` probes a connected mailbox. | Merge into `mailbox:probe move\|send`. |
| `testmail:*` (5) + `testmail:target` + `testmail:remote` and the `testmail` module | Live test mail through AgentMail. `sim` (E2a offline lab) now makes the labelled corpora. `docs/product/stage-2/06-architecture-review.md` §3.17: move `testmail` to `tools/testmail` in the ticket that replaces AgentMail. Last change 2026-11-14, so it is still in use. | Check what only it does (the real delivery path). Keep that part, move it to `tools/`, remove the rest. `testmail:remote` is a wrapper that runs `testmail:target` on the VPS: not a duplicate. |
| `triage:cost` vs `stats:week` (M7) | `triage:cost` computes cost per mail, percentiles and month cost in the script. `docs/code-patterns.md:275`: a metric has one definition in `packages/core/src/metrics/`. | Move its sums to core or onto the M7 function; keep the command if its per-model view is still needed. |
| `org:invite` vs `web:invite` | Different: `org:invite` creates an organization and its owner; `web:invite` makes a new setup link for an existing user. Both use `invite-delivery.ts`. | Keep both; the descriptions make the difference clear. |
| `mailbox:seed` vs `testmail:send` | Different: `seed` appends mail by IMAP (fast, no delivery); `testmail:send` sends real mail. | Keep both. |
| Helper files in `scripts/` | 12 helpers sit next to entry files, so a list of the folder is not a list of tools. | Move them to `scripts/lib/`; the standard test then reads every file in `scripts/` as a tool. |

No missing tool was found for the agents' checks: `job:run` runs one part of the server,
`fake-tg` drives Telegram, `mailbox:seed` puts mail in GreenMail. `cli:list` (§ 4.5) is the
one new command.

## 5. Migration

- Stage 1 is the inventory of § 4.10: it removes and merges before the other stages convert,
  so no stage converts a tool that goes away.

- F103 stages 03–04 land first: they move the output and set `scripts/` to lint error. This
  ticket starts after them, so no two jobs edit the same script files.
- Then stages by area (org, mailbox, delegation, eval/sim, telegram/testmail, dev tools,
  `fake-tg`), each: description, args file + test, exit codes, `runCli`. Text stays byte for
  byte, except usage lines and exit 1 → 2 for bad arguments.
- Exit code changes: grep every caller (CI, `limen-prepare.sh`, Playwright setup, runbooks in
  `docs/`, `docs/capabilities/`) in the same stage.
- The standard test starts with an allow-list of the old scripts; each stage removes its
  scripts; the last stage deletes the allow-list.

## 6. Edge cases to cover in the plan

1. CLI tests compare text: a changed usage line or exit code changes a test. Each stage lists them.
2. `eval --sim` exit 2 means "resume later" today; it becomes 4. The sim runbook
   (`evals/sim/README.md`) and any script that reads it change too.
3. `--help` must not import modules with side effects at load (DB pool, config). The
   description lives in a file with no heavy imports.
4. Production container: `cli:list` and `--help` work in the server image (no dev deps,
   no `bun --filter`).
5. DB down, GreenMail down, Telegram fake not started → exit 3 with one clear line, not a
   stack trace or a hang. Each "unreachable" path needs a timeout.
6. Long runs (`mailbox:backfill`, `eval --sim`): Ctrl-C leaves a state the next run continues;
   the lock files stay as now.
7. Parallel jobs on one machine: tools with a fixed port (`fake-tg serve` default port) take
   `--port`; see the e2e port note below.
8. Event lines (F103 D26) stay in the scripts that have them: the standard does not remove them.
9. `--json` and `print` in one run: with `--json`, human lines go to stderr only.
10. Subcommand files (`rules`, `delegates`, `testmail`, `sim`): one description per subcommand,
    so `cli:list` shows each `package.json` name.
11. `scripts/one-off/` and the shell scripts in `scripts/` are out of scope.
12. A `danger` tool on the production VPS: `--confirm` stays the only guard; no extra
    environment check that blocks the operator.

## 7. Related but separate

- Per-job ports for `test:e2e` (8081, 8092 fixed today; only one run at a time under
  `flock`). A separate ticket: it lets parallel jobs run Playwright. Not part of this one.
- F124 (parallel tests) and F125 (test classification) touch the CLI integration tests:
  the plan names the order with them.

## 8. Questions for the owner (defaults in bold)

Owner answer 2026-11-15: all three defaults accepted.

- **Q1 Scope.** Convert all tools now in stages, or only new tools plus each tool when an
  agent touches it? **Default: all now, in stages (engineering time is abundant).**
- **Q2 Risk rules.** Is the table in § 4.6 right for what agents may run without asking?
  Especially: may an agent run `cost` tools inside the existing caps ($1 per run, $20 per month)
  when its task needs it? **Default: yes for `read`/`dev`/`write`; `cost` only when the task
  names it; `outside` and `danger` only with your OK.**
- **Q3 Production.** Must the same tools and the same rules work on the VPS through
  `$C run --rm cli`? **Default: yes, one set of tools for dev and production.**

Everything else in this note is a default that the planner may change with a reason.
