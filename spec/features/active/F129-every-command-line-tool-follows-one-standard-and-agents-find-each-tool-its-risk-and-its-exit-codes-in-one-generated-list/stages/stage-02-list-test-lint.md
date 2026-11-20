# F129 stage 02 — `cli:list`, the standard test and the lint rule

Needs stage 00: `@ea/core` `CliDescription`, `cliDescriptionSchema`, `renderToolTable`. Needs stage 01: `platform/cli.ts` `runCli`, `createCliOutput(…).json`. Needs stage 04: helpers at their `scripts/lib/` paths (and, through it, stage 03's final `package.json` names). Runs alone in its group.

Part of [`../plan.md`](../plan.md). Decisions: D1, D6, D10, D11, D12.

## Step 1 — Tool discovery and `cli:list`

- **Files:** `apps/server/src/scripts/lib/cli-tools.ts` (+ test), `cli-list.ts`, `cli-list-args.ts` (+ test), root `package.json` (`"cli:list": "bun apps/server/src/scripts/cli-list.ts"`).
- **Interfaces:**
  ```ts
  export interface ToolCommand { name: string; file: string; subcommand?: string; descriptionFile: string } // paths relative to rootDir
  export function readToolCommands(rootDir: string): ToolCommand[];
  export async function loadToolRows(rootDir: string): Promise<{ rows: CliToolRowFull[]; missing: string[] }>;
  // CliToolRowFull = CliDescription & { file: string; available: boolean }
  export const cliListSchema; // z.object({ tools: z.array(…) }) in cli-list-args.ts
  ```
- **Rules:** a script is a tool command when its first token is `bun` and its second a `.ts` file under `apps/server/src/scripts/` or `tools/<x>/src/`. Then the rest must be empty or one subcommand word; else an error names the script. Other scripts (`test:unit` names folders) are no tool. `descriptionFile` = `<dir>/<base>-args.ts` (`tools/fake-telegram/src/cli.ts` → `cli-args.ts`). The loader imports each description file once; an entry file that is absent → `available: false` row (the server image has no `tools/*/src`); an entry present with no description file, or a description file with no `cliDescriptions` export → row with summary `(no description yet)` (not converted yet; gone after stage 16); a file whose `cliDescriptions` has no item named as the command → that name in `missing`.
- **`cli:list`:** text table (`renderToolTable`) on stdout, exit 0; `--json` → one `out.json({ tools })` value; `missing` not empty → one stderr line per name, exit 1. Description: risk `read`, needs `["none"]`.
- **Test:**
  1. A temp root with `"a:x": "bun apps/server/src/scripts/a.ts"`, `"b:y": "bun apps/server/src/scripts/b.ts add"`, `"lint": "eslint ."`, `"test:unit": "bun test tools/fake-telegram/src"` → two commands, `b:y` with subcommand `add`.
  2. `"c:z": "bun apps/server/src/scripts/c.ts --flag"` → throws, message names `c:z`.
  3. A `tools/t/src/cli.ts` command whose `cli.ts` and `cli-args.ts` are absent → `available: false`, not in `missing`.
  4. A description file whose only item is named `a:other` → `missing` holds `a:x`.
  4b. A description file with no `cliDescriptions` export → row `(no description yet)`, not in `missing`.
  5. Spawn `bun --no-env-file apps/server/src/scripts/cli-list.ts --json`, env `{ PATH, HOME }` → exit 0 (every description file loads with no env), stdout parses with `cliListSchema`, one row per tool command.

## Step 2 — The standard test and the pending list

- **Files:** `apps/server/src/scripts/cli-standard.test.ts`, `apps/server/src/scripts/cli-pending.json`.
- **`cli-pending.json`:** groups `danger`, `org`, `mailbox`, `mailbox-cli`, `delegation`, `eval`, `testmail-ops`, `e2e-dev`, `build`, `telegram`, `lab` (stages 05–15), one path from the repo root per line. Every tool file except `cli-list.ts` starts in it, and the `scripts/lib/` helpers that write to the process streams: `eval-drafter`, `eval-extractor`, `eval-sim`, `eval-suspicious` (group `eval`), `invite-delivery` (group `org`); grep for others.
- **Test, one `test()` per tool command not pending** (spawn: `bun --no-env-file <file> [subcommand] <flag>`, env `{ PATH, HOME }`; Bun loads a cwd `.env` even under `env -i`):
  6. The description passes `cliDescriptionSchema`; its `name` equals the command; the first `usage` line starts with `bun run <name>`; `subcommand` equals the `package.json` subcommand.
  7. `--help` → exit 0; stdout holds the summary.
  8. `--no-such-flag` → exit 2; stderr holds `usage: bun run <name>`.
  Timeout 20 s per test.
- **Test, the list itself:**
  9. Each pending file exists and is a tool command's file or under `scripts/lib/`.
  10. No file is pending twice.
- **Guard check:** remove the `--help` branch of `runCliCode` → case 7 fails for `cli:list`; restore. Name both runs in the final message.

## Step 3 — The lint rule

- **Files:** `eslint.config.js`.
- **Rule:** `no-restricted-properties` for `process.exit`, `process.stdout.write`, `process.stderr.write` on `apps/server/src/scripts/**/*.ts` and `tools/*/src/**/*.ts`, test files excluded. `ignores`: `apps/server/src/platform/cli.ts`, `tools/fake-telegram/src/cli-run.ts`, and every file in `cli-pending.json` (read with `readFileSync`, as `layers.json`). Message: "Exit and raw output: runCli and createCliOutput (docs/cli.md)."
- **Guard check:** add `process.exit(0)` to `cli-list.ts` → `bun run lint` fails with the message; remove it. Name both runs in the final message.

## Out of scope

Converting any tool except `cli-list.ts`.

## Done when

Cases 1–10 pass; both guard checks recorded; the plan.md Proof with `s02` prints `PROOF_OK`.
