# F129 stage 00 — The standard and the core vocabulary

Needs: nothing new. May run next to 03 and 04 (no shared file). Stage 01 needs its `@ea/core` exports.

Part of [`../plan.md`](../plan.md). Decisions: D2, D5, D7, D8.

## Step 1 — Pure CLI vocabulary in `@ea/core`

- **Files:** `packages/core/src/cli/` (new), exported from `packages/core/src/index.ts`.
- **Interfaces (later stages and `fake-tg` use them):**
  ```ts
  export const CLI_RISKS = ["read", "dev", "write", "cost", "outside", "danger"] as const;
  export const CLI_NEEDS = ["none", "db", "greenmail", "imap", "smtp", "telegram", "llm", "agentmail", "dns", "vps", "docker", "git"] as const;
  export const EXIT = { ok: 0, failed: 1, usage: 2, unreachable: 3, incomplete: 4 } as const;
  export interface CliDescription {
    name: string;            // the package.json key, "org:delete"
    subcommand?: string;     // argv[0] for a file with several names ("add" for rules:add)
    summary: string;         // one sentence, at most 100 characters, ends with "."
    risk: CliRisk;
    needs: readonly CliNeed[]; // ["none"] or a list without "none"
    usage: string;           // first line "bun run <name> …"; more lines allowed; no "usage:" prefix
    exits?: Partial<Record<1 | 3 | 4, string>>; // tool meaning of a code, one clause
    outputNote?: string;     // the one allowed exception to "ids and counts only"
  }
  export class UsageError extends Error {}  // message: safe text, no input values
  export function renderHelp(d: CliDescription): string;
  export function renderToolTable(rows: readonly CliToolRow[]): string;
  export const cliDescriptionSchema; // Zod, checks the rules in the comments above
  ```
  `CliToolRow = { name, risk, needs, summary, available }`.
- **Help text** (exact, lines joined by `\n`, ends with `\n`):
  ```
  usage: <usage>
  <summary>
  risk: <risk> · needs: <needs joined by ", ">
  exit: 0 done · 1 failed · 2 usage · 3 unreachable · 4 incomplete
  <for each key of exits: "  <code>: <text>">
  <outputNote, when set: "output: <outputNote>">
  ```
- **Table:** rows sorted by name; columns `name`, `risk`, `needs`, `summary`, padded to the widest cell plus two spaces; an unavailable row: `-`, `-`, `not in this install`.
- **Test** (`packages/core/src/cli/*.test.ts`):
  1. `renderHelp` of `{ name: "org:status", summary: "Prints one organization.", risk: "read", needs: ["db"], usage: "bun run org:status --org-id <uuid>" }` equals the four exact lines.
  2. With `exits: { 1: "the organization is missing" }` the fifth line is `  1: the organization is missing`.
  3. `cliDescriptionSchema` refuses: a summary of 101 characters; `needs: ["none", "db"]`; usage `bun org:status`; risk `admin`; a name with a space.
  4. `renderToolTable` of two rows out of order prints them sorted; an unavailable row prints `not in this install`.
- **Guard check:** drop the summary length rule from `cliDescriptionSchema` → case 3 fails; restore. Name both runs in the final message.
- **Done when:** tests 1–4 pass; no new import from outside `packages/core`.

## Step 2 — `docs/cli.md`

- **Content:** note § 4.1–4.9 as plan D1–D13 decide them, and `bun run cli:list`. Positionals: only a subcommand or an existing main operand (`db:worktree <name>`, `release:prepare <x.y.z>`, `fake-tg send <text>`, `wait <regex>`: `limen-prepare.sh`, the release checklist and e2e helpers call them so). `--help`/`-h` counts before `--` only (`fake-tg send -- -h` sends `-h`). Name the `docs/code-patterns.md` § Logs exception: existing `error.message` prints in mail-connection scripts stay. Outside the standard: `scripts/one-off/`, `scripts/*.sh`, `apps/docs/scripts/`.
- **Section `## Convert a tool`** (stages 05–15 follow it): (1) the args file exports `cliDescriptions` and a parser that throws `UsageError` or returns a typed value; an inline parser moves there; (2) the entry ends with `if (import.meta.main) await runCli({ prefix, descriptions: cliDescriptions, main, close })` (tests import entries); `main` parses first, then loads config; a tool with its own outer catch returns `exitCodeOf(error)` and prints `unreachable:` for 3; (3) `process.exit`, `process.stdout.write`, `process.stderr.write` become a return code, `out.write`, `out.writeErr`; (4) bad arguments return 2, a refusal 1, an unreachable outside system 3; (5) change every caller of a changed code or usage line in the same commit; (6) remove the file from `cli-pending.json`; (7) args unit test: one valid case and each invalid case → usage.
- **Done when:** `docs/code-patterns.md` § Logs CLI paragraph points to `docs/cli.md` in one line.

## Out of scope

`runCli` (stage 01); `cli:list`, the standard test, lint (stage 02); any tool conversion.

## Done when

Steps 1–2 done; the plan.md Proof with `s00` prints `PROOF_OK`.
