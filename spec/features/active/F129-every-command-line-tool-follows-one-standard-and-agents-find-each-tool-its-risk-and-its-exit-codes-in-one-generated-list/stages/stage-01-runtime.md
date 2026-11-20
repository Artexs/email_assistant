# F129 stage 01 — `runCli` and the output writers

Needs stage 00: `@ea/core` `CliDescription`, `EXIT`, `UsageError`, `renderHelp`. It reads `apps/server/src/platform/cli.ts` and `platform/errors.ts` at HEAD. May run next to 03 and 04 (no shared file).

Part of [`../plan.md`](../plan.md). Decisions: D3, D4, D5.

## Step 1 — `runCli` and the output writers

- **Files:** `apps/server/src/platform/cli.ts`, `cli.test.ts`.
- **Interfaces:**
  ```ts
  export interface CliRawOutput extends CliOutput { raw(text: string): void; write(text: string): void; writeErr(text: string): void; json(value: unknown): void; }
  export function createCliOutput(name: string, options?: { json?: boolean }): CliRawOutput;
  export async function runCliCode(spec: {
    prefix: string;                                 // the existing output name, "org-delete"
    descriptions: readonly CliDescription[];
    main: (argv: string[], out: CliRawOutput) => Promise<number>;
    argv?: string[];                                // default process.argv.slice(2)
    close?: () => Promise<void>;                    // DB close; runs in finally
  }): Promise<number>;
  export async function runCli(spec: Parameters<typeof runCliCode>[0]): Promise<never>; // process.exit(code)
  export function exitCodeOf(error: unknown): 1 | 3; // the classification below, for tools with their own catch
  ```
- **Behaviour:**
  - `--help` or `-h` as a token before any `--`: print help on stdout and return 0. With several descriptions, pick the one whose `subcommand` equals `argv[0]`; with no match, print every description's help, separated by a blank line. `main` is not called.
  - A `UsageError` or a `node:util` `parseArgs` error (`code` starts with `ERR_PARSE_ARGS_`): stderr `[prefix] <message>` then `[prefix] usage: <usage>`; return 2.
  - A `SoftError`, or an error (or its `cause`) with `code` in `ECONNREFUSED, ENOTFOUND, ETIMEDOUT, ECONNRESET, EHOSTUNREACH, 57P03`, or a pg pool connect timeout: stderr `[prefix] unreachable: <describeError>`; return 3.
  - Any other throw: stderr `[prefix] failed: <describeError>`; return 1. Never a stack, never `error.message` of an inner error.
  - `main`'s number is returned as is; `close` errors are swallowed after one `[prefix] close failed: <describeError>` line.
  - `json(value)`: `JSON.stringify(value)` plus `\n` on stdout; a second call throws. With `{ json: true }`, `print` writes to stderr. `runCliCode` builds the `out` it passes to `main` with `json: true` when argv holds `--json` before any `--`.
- **Test** (`cli.test.ts`, no spawn):
  5. argv `["--help"]` → 0, stdout is `renderHelp`, `main` not called.
  6. argv `["add", "--help"]` with two descriptions (`add`, `list`) → only the `add` help.
  7. `main` throws `new UsageError("missing --org-id")` → 2, stderr two lines, the second `[x] usage: bun run …`.
  8. `main` calls `parseArgs({ args: ["--nope"], options: {} })` → 2.
  9. `main` throws an error with `code: "ECONNREFUSED"` → 3, one stderr line starting `[x] unreachable:`.
  10. `main` throws `new Error("secret text")` → 1; stderr does not hold `secret text`.
  11. `main` returns 4 → 4; `close` ran once in each of cases 7–11.
  12. `json` twice throws; with `{ json: true }`, `print("a")` goes to stderr.
  13. argv `["send", "--", "-h"]` → `main` called with that argv; no help printed.
  14. argv `["--json"]` → the `out` given to `main` writes `print` to stderr.
  15. `exitCodeOf` of `{ code: "57P03" }` → 3; of a `SoftError` → 3; of a `cause` with `ECONNRESET` → 3; of `new Error("x")` → 1.
- **Guard check:** remove the `ECONNREFUSED` match → case 9 fails; remove the `--help` branch → case 5 fails; restore. Name each run in the final message.
- **Done when:** cases 5–15 pass; `createCliOutput` keeps its current output (existing `cli.test.ts` cases unchanged).

## Out of scope

`cli:list`, the standard test, lint (stage 02); any tool conversion.

## Done when

Step 1 done; the plan.md Proof with `s01` prints `PROOF_OK`.
