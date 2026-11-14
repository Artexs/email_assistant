# F103 stage 14 — Console and process guard

Part of [`../plan.md`](../plan.md). `[risky]`: text that does not come from our logger (a library's `console.error`, Bun's crash print) would reach the store. Review job before the land. Needs stage 13 landed.

Two steps.

## Step 1 — The console guard

**Goal.** In JSON format, any `console.*` call that does not come from `platform/log.ts` writes one text-free event instead of its text (D25). Example: `better-call` prints `# SERVER_ERROR: <message and stack>` with `console.error`, and the text can hold database values (`docs/known-alerts.md`, the `# SERVER_ERROR` entry; `onAuthError` cannot suppress it).

**Files.** `apps/server/src/platform/log.ts`, `apps/server/src/platform/log.test.ts`, `apps/server/src/main.ts`, `apps/server/src/platform/log-fields.ts` (nothing new: the event has no field).

**Interfaces.**

```ts
/**
 * JSON format only (main.ts). Saves the current console.log and console.error as the writer's sink, then replaces
 * console.log, info, debug, warn, error and trace with a function that writes the event console_output (level warn)
 * with the context fields and dropped_fields 1, and never its arguments. Returns a function that restores console.
 */
export function installConsoleGuard(): () => void;
```

- While the guard is on, `write` sends its lines to the saved sink, not to `console.*` (else a log line would hit the guard). While it is off, `write` reads `console.log` and `console.error` at each call, as today (tests spy on them).
- A second `installConsoleGuard()` while one is on throws `Error("console guard is on")`.
- The guarded functions never throw and never read their arguments (no `String(x)`: a getter can throw or print).
- `main.ts`: right after `setLogFormat(config.LOG_FORMAT)`, when the format is `json`, call `installConsoleGuard()`. Text format (dev) keeps the normal console.

**Decisions.** D25 (new, this stage). D9 (the writer counts one drop for a line without its arguments).

**Test** (`log.test.ts`; each test restores the guard and the spies in `finally`).

1. Spy `console.log` and `console.error`, `setLogFormat("json")`, `installConsoleGuard()`; then `console.error("# SERVER_ERROR: MARKER-1 at x.test")` → the `console.error` spy got one call whose single argument is a JSON line with `event` `console_output`, `level` `warn`, `dropped_fields` 1, and no `MARKER`.
2. Same setup: `createLog("m").info("a", { count: 1 })` → the `console.log` spy got one `a` line (the sink), and no `console_output` line.
3. Inside `withLogContext({ job: "mail.sync", run_id: R })`, `console.log("MARKER-2")` → the `console_output` line carries `job` and `run_id`.
4. `console.info`, `console.debug`, `console.warn`, `console.trace` → one `console_output` line each.
5. After the restore function runs, `console.log` is the spy again; a second install after the restore works; a second install while on throws.

**Check.** `bun test apps/server/src/platform/log.test.ts`.

**Done when.** The five cases pass.

## Step 2 — The process guard

**Goal.** An uncaught exception or an unhandled rejection writes an event with `errorFields`, not Bun's print of the message and the source line, and the process still exits with code 1 (D25).

**Files.** `apps/server/src/platform/process-guard.ts` (new), `apps/server/src/main.ts`, `apps/server/test/integration/process-guard.test.ts` (new), `apps/server/test/integration/crash-entry.ts` (new, test helper), `docs/known-alerts.md` (two entries).

**Interfaces.**

```ts
// platform/process-guard.ts
/** Server process only: an uncaught exception or an unhandled rejection writes one event with errorFields and exits 1 (Bun's default exit code, V12). */
export function installProcessGuard(log: Log): void;
```

- Body: `process.on("uncaughtException", (error) => { log.error("process_uncaught_exception", { ...errorFields(error) }); process.exit(1); })` and the same for `"unhandledRejection"` with `process_unhandled_rejection` and the `reason`.
- `main.ts` calls `installProcessGuard(log)` at the start of `main()`, after `setLogFormat` and the console guard.
- Exit code 1 keeps today's behaviour: Bun 1.4.4 exits with 1 on both (V12), and Compose restarts the container (`restart: unless-stopped`).
- Scripts do not install it: their stderr goes to the operator's terminal.
- `crash-entry.ts` (test helper, not in `src/`): `setLogFormat("json")`, `installConsoleGuard()`, `installProcessGuard(createLog("main"))`, then by `process.argv[2]`: `reject` → `void Promise.reject(new Error("MARKER-CRASH"))`; `throw` → `setTimeout(() => { throw new Error("MARKER-CRASH"); }, 0)`.

**Test** (`process-guard.test.ts`, `Bun.spawn(["bun", "apps/server/test/integration/crash-entry.ts", <mode>])`, read stdout and stderr to the end).

1. `reject`: exit code 1; the output holds one line that parses as JSON with `event` `process_unhandled_rejection` and `error` `Error`; no line holds `MARKER`.
2. `throw`: exit code 1; one `process_uncaught_exception` line; no `MARKER`.

**Check.** `bun test apps/server/test/integration/process-guard.test.ts`.

**Done when.** The two cases pass.

**Docs.** `docs/known-alerts.md`: one entry for `process_uncaught_exception` and `process_unhandled_rejection` (cause: a bug; the container restarts; read `error`, `error_code` and the lines of the same `run_id` or `request_id` before it), one for `console_output` (cause: a library printed to the console; its text is not logged; find the library by the `run_id` or `request_id` and the time; the `# SERVER_ERROR` entry now points here). `docs/code-patterns.md` § Logs: one bullet: "In JSON format, the console guard replaces any other console output with the event `console_output`; the process guard logs `process_uncaught_exception` and `process_unhandled_rejection` and exits 1."

**Done when.** The Proof of `plan.md` (`/tmp/f103-s14`) prints `PROOF_OK`.

**Out of scope.** Changing a library's own output; Bun's output before `main()` runs (a syntax or import error at start prints as today: there is no event then, and it holds no mail data).
