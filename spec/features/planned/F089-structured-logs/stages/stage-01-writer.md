# F089 stage 01 — The writer: event form, allow-list, drop count, JSON and text form

Part of [`../plan.md`](../plan.md). `[risky]`: the allow-list is the guard that keeps mail text, addresses and secrets out of the logs. Read D1, D2, D6–D14 and D19 of `plan.md` first. One step. A review job checks it before the land.

## Step 1 — The writer

**Goal.** `createLog(module)` writes an event-form line as one JSON object or one readable text line, keeps only allow-listed fields with allowed values, counts what it drops, and still writes every old-form call as today.

**Files.**

- New: `apps/server/src/platform/log-fields.ts`.
- Change: `apps/server/src/platform/log.ts` (rewrite), `apps/server/src/platform/log.test.ts` (keep the 3 existing tests, add the new ones).
- Change: `apps/server/src/platform/errors.ts` (add `errorFields`), `apps/server/src/platform/errors.test.ts`.

Not in this stage: `platform/config.ts`, `main.ts`, the test preload (stage 02); `withLogContext` and `log.with` (stage 02); any call site.

**Interfaces.**

```ts
// platform/log-fields.ts
/** Field names a log line may carry after its base keys (ADR 0024). Add a name in the change that first logs it; the review checks that its values are ids, codes, counts or times. */
export const logFieldNames = [
  // ids
  "org_id", "mailbox_id", "email_id", "action_id", "delegation_id", "outbox_id", "user_id",
  // context (stage 02 sets them from AsyncLocalStorage)
  "job", "run_id", "request_id",
  // counts and times
  "count", "attempts", "ms", "tokens_in", "tokens_out", "mailbox_count", "org_count", "suspended_count", "port",
  // codes
  "code", "error", "error_code", "kind", "status", "reason", "scope", "folder_key", "provider", "model",
  "method", "route", "key", "release",
] as const;
export type LogFieldName = (typeof logFieldNames)[number];
export type LogValue = string | number | boolean | null | undefined;
export type LogFields = { readonly [K in LogFieldName]?: LogValue };

export const EVENT_CODE = /^[a-z][a-z0-9_]{0,63}$/;
/** D7: a finite number, a boolean, null, or a short code string. No space, no "@", no URL. */
export function isLogValue(value: unknown): value is string | number | boolean | null;
export function isLogFieldName(name: string): name is LogFieldName; // Set lookup, Object.hasOwn-safe
```

Prettier formats the array one name per line; that is fine.

```ts
// platform/log.ts
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "json" | "text";
export type { LogFields } from "./log-fields";

export interface Log {
  debug(event: string, fields?: LogFields): void;
  /** @deprecated Free-text form; E8a converts the modules (ADR 0024). */
  debug(...args: unknown[]): void;
  info(event: string, fields?: LogFields): void;
  /** @deprecated Free-text form; E8a converts the modules (ADR 0024). */
  info(...args: unknown[]): void;
  warn(event: string, fields?: LogFields): void;
  /** @deprecated Free-text form; E8a converts the modules (ADR 0024). */
  warn(...args: unknown[]): void;
  error(event: string, fields?: LogFields): void;
  /** @deprecated Free-text form; E8a converts the modules (ADR 0024). */
  error(...args: unknown[]): void;
}

export function createLog(module: string): Log;
export function setLogLevel(level: LogLevel): void; // unchanged
export function setLogFormat(format: LogFormat): void;
/** D11: "text" gives text; anything else, also unset, gives json. */
export function logFormatFromEnv(env: Record<string, string | undefined>): LogFormat;
/** D8: fields dropped since the process started. Tests read a difference. */
export function droppedLogFields(): number;
```

Writer rules (one internal `write(level, module, args)` function):

1. Level filter first, as today; a filtered line does no other work.
2. Format: the value set by `setLogFormat`; if it was never called, `logFormatFromEnv(process.env)`, read once at the first line and kept.
3. Event form or old form by D10. Plain object test: `typeof v === "object" && v !== null && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)`.
4. Event form: build the line as an ordered list of `[key, value]` pairs: `time` (`new Date().toISOString()`), `level`, `module`, `event`, `msg` (= event, D9). Then the call fields in their own order: for each own key with a value that is not `undefined`, keep it when `isLogFieldName(key)`, `isLogValue(value)` and the key is not on the line yet; else count one drop. If the count is above 0, add `["dropped_fields", count]` and add the count to the process total. Stage 02 adds the context and child keys before the call fields; write the loop so that it takes a list of field sources in order (`[callFields]` now), so stage 02 adds sources without a rewrite.
5. `json`: `JSON.stringify(Object.fromEntries(pairs))`, one argument to `console.log` (debug, info) or `console.error` (warn, error).
6. `text`: two arguments: `` `[${module}]` `` and `` `${event}${pairs after msg as " key=value"}` ``. `null` prints `null`, numbers and booleans with `String`.
7. Old form, `text`: exactly `console.log(prefix, ...args)` / `console.error(prefix, ...args)` as today.
8. Old form, `json`: `{ time, level, module, event: "legacy_text", msg: format(...args) }` (`format` from `node:util`), one argument. Stage 02 adds the context keys to it.
9. The writer never throws: a value whose check throws (a getter) counts as a drop. Wrap the field loop body in `try/catch`.

```ts
// platform/errors.ts (add; describeError stays)
/** D14: the error name (or typeof for a non-object) and its string or number code, never the message. For the event form: log.error("x_failed", { ...errorFields(error) }). */
export function errorFields(error: unknown): { error: string; error_code?: string | number };
```

**Decisions.** D1 (old form stays), D2, D6 refined by D14, D7, D8, D9, D10, D11 (the env part; `setLogFormat`), D12, D13, D19.

**Test.** In `log.test.ts`. Keep `beforeEach`/`afterEach` of the file (spies, `setLogLevel("info")`) and add `setLogFormat("text")` to both. Fixed ids: `M = "7d0c2a8e-5b1f-4c3d-9e2a-0f1b2c3d4e5f"`, `O = "11111111-2222-4333-8444-555555555555"`. Helper: `const jsonLine = (spy) => JSON.parse(String(spy.mock.calls.at(-1)?.[0]))`.

1. The 3 existing tests pass unchanged (`createLog("tenancy").info("x")` is now the event form; the line still starts with `[tenancy]`).
2. JSON line: `setLogFormat("json")`; `createLog("mail").info("sync_done", { mailbox_id: M, count: 3 })` → `out` called once with one argument; parsed keys in this order: `["time", "level", "module", "event", "msg", "mailbox_id", "count"]`; `level` `"info"`, `module` `"mail"`, `event` and `msg` `"sync_done"`, `count` `3`; `time` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`.
3. Unknown field: JSON, `info("sync_done", { subject: "MARKER-SUBJ" } as never)` → no `subject` key, `dropped_fields` `1`, `"MARKER-SUBJ"` is not in the raw line.
4. Long string: `{ reason: "a".repeat(65) }` → dropped (`dropped_fields: 1`); `{ reason: "a".repeat(64) }` → kept, no `dropped_fields` key.
5. Value shapes, each in its own call, `test.each` with `[fields, kept]`: `{ reason: "has space" }` false; `{ reason: "x@y.test" }` false; `{ reason: "https://h.test/a" }` false; `{ reason: "line\nbreak" }` false; `{ count: Number.NaN }` false; `{ count: Number.POSITIVE_INFINITY }` false; `{ error: new Error("MARKER-ERR") }` false (and `"MARKER-ERR"` not in the raw line); `{ reason: ["a"] }` false; `{ reason: { a: 1 } }` false; `{ count: 10n }` false; `{ status: null }` true (value `null`); `{ route: "/api/mailboxes/:id" }` true; `{ model: "gemini-3.5-flash-lite" }` true; `{ user_id: M }` true; `{ ok: true }` false (name not listed); `{ reason: "" }` true.
6. `undefined` is not a drop: `{ code: undefined, count: 1 }` → no `code` key, no `dropped_fields`.
7. A base key cannot be replaced: `{ msg: "x", level: "error" } as never` → `msg` `"sync_done"`, `level` `"info"`, `dropped_fields` `2`.
8. Drop total: `const before = droppedLogFields()`; one line with 2 bad fields and one with 1 → `droppedLogFields() - before === 3`.
9. Text event form: `setLogFormat("text")`; `info("sync_done", { mailbox_id: M, count: 3 })` → `out.mock.calls[0]` equals `["[mail]", `sync_done mailbox_id=${M} count=3`]`; a drop adds ` dropped_fields=1` at the end; `{ status: null }` prints `status=null`.
10. Old form in text: `info("sync 12 done:", 5)` → `out.mock.calls[0]` equals `["[mail]", "sync 12 done:", 5]`.
11. Old form in JSON: `setLogFormat("json")`; `warn("sync %s failed", "box-1", 3)` → `err` called once; parsed `event` `"legacy_text"`, `msg` `"sync box-1 failed 3"`, `level` `"warn"`, keys exactly `["time", "level", "module", "event", "msg"]`.
12. Event or old form (D10), JSON, `test.each` of `[args, event]`: `["sync_done"]` → `sync_done`; `["sync_done", { count: 1 }]` → `sync_done`; `["Sync_done"]` → `legacy_text`; `["sync done"]` → `legacy_text`; `["sync_done", "x"]` → `legacy_text`; `["sync_done", { count: 1 }, 2]` → `legacy_text`; `["sync_done", new Error("e")]` → `legacy_text`; `["sync_done", Object.create(null)]` → `sync_done`; `["a".repeat(65)]` → `legacy_text`.
13. Streams and levels in both formats: `warn` and `error` go to `console.error`, `debug` and `info` to `console.log`; at level `warn` an `info` line writes nothing in `json` and in `text`.
14. `logFormatFromEnv`: `{ LOG_FORMAT: "text" }` → `text`; `{ LOG_FORMAT: "json" }` → `json`; `{}` → `json`; `{ LOG_FORMAT: "TEXT" }` → `json`; `{ LOG_FORMAT: "" }` → `json`.
15. One line per call: JSON, `info("sync %s", "a\nb")` (old form) → `out` called once and its argument has no raw newline character (`!String(arg).includes("\n")`).
16. A throwing getter: `info("sync_done", { get count() { throw new Error("g"); } } as never)` → no throw, `dropped_fields` `1`.

In `errors.test.ts`:

17. `errorFields(Object.assign(new Error("MARKER"), { code: "EAUTH" }))` → `{ error: "Error", error_code: "EAUTH" }`; `errorFields(Object.assign(new Error("m"), { code: 503 }))` → `{ error: "Error", error_code: 503 }`; `errorFields(new TypeError("MARKER"))` → `{ error: "TypeError" }` (no `error_code` key); `errorFields("MARKER")` → `{ error: "string" }`; `errorFields(null)` → `{ error: "object" }`; `errorFields(Object.assign(new Error("m"), { code: { a: 1 } }))` → `{ error: "Error" }`. `JSON.stringify` of no result contains `MARKER`.

**Check.**

```
bun test apps/server/src/platform/log.test.ts apps/server/src/platform/errors.test.ts
bun run typecheck
bunx eslint apps/server/src/platform/log.ts apps/server/src/platform/log-fields.ts apps/server/src/platform/errors.ts
```

Mutation check, then revert: in `isLogValue`, remove the `://` test → case 5 (`https://h.test/a`) fails. Restore it (`git diff` shows no mutation before the commit).

**Done when.**

- Tests 1–17 pass; the whole unit suite passes (the writer is used by every module; the old form must print as before).
- The mutation check failed and is reverted.
- The Proof of `plan.md` ends with `PROOF_OK` (`NN` = `01`).
- A review job checks the stage before the land (plan § Review).

**Out of scope.** `LOG_FORMAT` in the config schema, `main.ts`, the preload (stage 02). Context (stage 02). Any call site and the lint (stages 04–06). A message table (D9).
