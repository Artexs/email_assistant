# F103 stage 14 — Console and process guard

Part of [`../plan.md`](../plan.md). `[risky]`: text that does not come from our logger (a library's `console.error`, Bun's crash print) would reach the store. Review job before the land. Needs stage 13 landed.

Two steps.

## Step 1 — The console guard

**Goal.** In JSON format, a `console.*` call that does not come from `platform/log.ts` writes one text-free event instead of its text (D25). Example: `better-call` prints `# SERVER_ERROR: <message and stack>`, which can hold database values.

**Interface** (`apps/server/src/platform/log.ts`):

```ts
/**
 * JSON format only (main.ts). Saves the current console.log and console.error as the writer's sink, then replaces
 * console.log, info, debug, warn, error and trace with a function that writes the event console_output (level warn)
 * with the context fields and dropped_fields 1, and never its arguments. Returns a function that restores console.
 */
export function installConsoleGuard(): () => void;
```

- While the guard is on, the writer sends its lines to the saved sink, not to `console.*`. While it is off, the writer reads `console.log` and `console.error` at each call, as today (tests spy on them).
- A second `installConsoleGuard()` while one is on throws `Error("console guard is on")`.
- The guarded functions never throw and never read their arguments (no `String(x)`: a getter can throw or print).
- `main.ts` runs at top level (there is no `main()` function): right after `setLogFormat(config.LOG_FORMAT)`, when the format is `json`, call `installConsoleGuard()`. Text format (dev) keeps the normal console. No new field name.

**Decisions.** D25, D9.

**Test** (`platform/log.test.ts`; restore the guard and the spies in `finally`).

1. Spy `console.log` and `console.error`, `setLogFormat("json")`, `installConsoleGuard()`; `console.error("# SERVER_ERROR: MARKER-1 at x.test")` → the `console.error` spy got one call whose single argument is a JSON line with `event` `console_output`, `level` `warn`, `dropped_fields` 1, and no `MARKER`.
2. Same setup: `createLog("m").info("a", { count: 1 })` → the `console.log` spy got one `a` line and no `console_output` line.
3. Inside `withLogContext({ job: "mail.sync", run_id: R })`, `console.log("MARKER-2")` → the `console_output` line carries `job` and `run_id`.
4. `console.info`, `console.debug`, `console.warn`, `console.trace` → one `console_output` line each.
5. After the restore function runs, `console.log` is the spy again; a second install after the restore works; a second install while on throws.

**Done when.** The five cases pass.

## Step 2 — The process guard

**Goal.** An uncaught exception or an unhandled rejection writes an event with `errorFields`, not Bun's print of the message and source line; the process still exits with code 1 (D25).

**Interface** (`apps/server/src/platform/process-guard.ts`, new):

```ts
/** Server process only: an uncaught exception or an unhandled rejection writes one event with errorFields and exits 1 (Bun's default exit code, V12). */
export function installProcessGuard(log: Log): void;
```

- `uncaughtException` → `log.error("process_uncaught_exception", { ...errorFields(error) })`, then `process.exit(1)`; `unhandledRejection` → `process_unhandled_rejection` with the `reason`, then exit 1.
- `main.ts` calls `installProcessGuard(log)` at top level, after `setLogFormat` and the console guard, before any job or server starts. The `SIGTERM` and `SIGINT` handlers (`shutdown`) do not change.
- Exit code 1 keeps today's behaviour (Bun 1.4.4 exits 1 on both, V12); Compose restarts the container.
- Scripts do not install it: their stderr goes to the operator's terminal.
- Test helper `apps/server/test/integration/crash-entry.ts` (not in `src/`): `setLogFormat("json")`, `installConsoleGuard()`, `installProcessGuard(createLog("main"))`, then by `process.argv[2]`: `reject` → `void Promise.reject(new Error("MARKER-CRASH"))`; `throw` → `setTimeout(() => { throw new Error("MARKER-CRASH"); }, 0)`.

**Test** (`apps/server/test/integration/process-guard.test.ts`, `Bun.spawn(["bun", "apps/server/test/integration/crash-entry.ts", <mode>])`, read stdout and stderr to the end).

1. `reject`: exit code 1; one output line parses as JSON with `event` `process_unhandled_rejection` and `error` `Error`; no line holds `MARKER`.
2. `throw`: exit code 1; one `process_uncaught_exception` line; no `MARKER`.

**Docs.**

- `docs/known-alerts.md`: an entry for the two process events (a bug; the container restarts; read `error`, `error_code` and the lines of the same `run_id` or `request_id`), one for `console_output` (a library printed; find it by id and time); the `# SERVER_ERROR` entry points there.
- `docs/code-patterns.md` § Logs: one bullet on both guards.

**Done when.** The two cases pass; `main-start-log.test.ts` still passes; the Proof (`/tmp/f103-s14`) prints `PROOF_OK`.

**Out of scope.** A library's own output; Bun's output before `main.ts` runs (a syntax or import error at start prints as today; it holds no mail data).
