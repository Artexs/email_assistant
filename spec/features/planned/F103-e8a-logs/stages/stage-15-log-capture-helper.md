# F103 stage 15 — The log capture helper; the marker tests use it

Part of [`../plan.md`](../plan.md). Needs stage 13 landed (the JSON form has no `legacy_text` any more).

One step.

## Step 1 — The shared capture helper; the marker tests use it

**Goal.** One helper captures every log line and checks it; the five marker tests run in JSON format through it (D11).

**Files.**

- `apps/server/test/log-capture.ts` (new; next to `wait-for.ts`)
- `apps/server/test/log-capture.test.ts` (new; unit cases of the helper; it lives in `test/`, so `test:int` runs it)
- `apps/server/test/integration/triage-logs.test.ts`, `actions-logs.test.ts`, `actions-send-logs.test.ts`, `telegram-logs.test.ts`, `web-auth-logs.test.ts` (change: use the helper)

**Interfaces.**

```ts
// apps/server/test/log-capture.ts
export interface CapturedLogs {
  /** Raw console lines (stdout and stderr), one string per call, in order. */
  readonly lines: readonly string[];
  /** Restores the spies, the level and the format. Call it in finally. */
  stop(): void;
}
/** Spies on console.log and console.error, sets LOG_FORMAT json (setLogFormat) and the level (default "debug"). */
export function captureLogs(opts?: { level?: LogLevel }): CapturedLogs;
/** The list of problems; empty when every line is clean. */
export function logProblems(lines: readonly string[], planted: readonly string[]): string[];
```

- A spy call joins its arguments with one space (`args.map(String).join(" ")`), so a text line from a CLI helper call is also caught.
- `logProblems` gives one problem string (no planted text in it: name the planted value by its index) for each line that: holds any planted string (case-sensitive substring); does not parse as one JSON object; has a key that is not `time`, `level`, `module`, `event`, `msg` or in `logFieldNames`; has `event` `log_call_invalid`; has `dropped_fields`; has `msg` other than `event`.
- `stop()` restores `setLogFormat("text")` and `setLogLevel("info")`.

**Test** (`log-capture.test.ts`).

1. A line `{"time":"…","level":"info","module":"m","event":"a","msg":"a","count":1}` and planted `["X-1"]` → no problem.
2. A line that holds `X-1` → one problem whose text does not hold `X-1`.
3. `not json` → one problem; `{"event":"a","msg":"a","subject":"s"}` → one problem (`subject`); a line with `dropped_fields` → one problem; `log_call_invalid` → one problem.
4. `captureLogs()` then `createLog("m").info("a")` → `lines` has one JSON line; after `stop()` a new call is not captured.

**Change of the marker tests.** Each of the five files replaces its own `spyOn(console, …)` setup with `captureLogs()` and its own marker check with `expect(logProblems(capture.lines, Object.values(MARKERS))).toEqual([])`. Keep every positive check of the file (a line that must appear), changed to the JSON form (`JSON.parse` the line, compare `event` and fields). Each test stays in its own file.

**Check.** `bun test apps/server/test/log-capture.test.ts apps/server/test/integration/triage-logs.test.ts apps/server/test/integration/actions-logs.test.ts apps/server/test/integration/actions-send-logs.test.ts apps/server/test/integration/telegram-logs.test.ts apps/server/test/integration/web-auth-logs.test.ts`.

**Done when.** The cases pass.

**Done when (stage).** The Proof of `plan.md` (`/tmp/f103-s15`) prints `PROOF_OK`.

**Out of scope.** The pipeline canary (stage 16).
