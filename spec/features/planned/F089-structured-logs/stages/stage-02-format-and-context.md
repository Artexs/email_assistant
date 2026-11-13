# F089 stage 02 — Format setting and log context

Part of [`../plan.md`](../plan.md). Read D3, D5, D8, D11, D15 and D21 of `plan.md` first. Needs stage 01 landed. Two steps.

File gate (ticket § Sequenced): this stage edits `platform/config.ts`, `main.ts` and `apps/server/test/preload.ts`. It never builds at the same time as F087 stages 1, 2 or 4, or F090 stage 1.

## Step 1 — `LOG_FORMAT`: config, server start, tests, dev and VPS

**Goal.** The server takes its format from `LOG_FORMAT` (default `json`); dev gets `text` from `.env.example`; the VPS stays on `json` whatever its `.env` says; tests always run in `text`.

**Files.**

- Change: `apps/server/src/platform/config.ts`, `apps/server/src/platform/config.test.ts`.
- Change: `apps/server/src/main.ts` (one line and one import name).
- Change: `apps/server/test/preload.ts`.
- Change: `.env.example`, `deploy/compose.yaml`.

**Interfaces.**

```ts
// platform/config.ts, baseSchema, directly after LOG_LEVEL:
  // json = one JSON object per line (the VPS); text = "[module] event key=value" (dev). ADR 0024.
  LOG_FORMAT: z.preprocess(emptyAsUndefined, z.enum(["json", "text"]).default("json")),
```

```ts
// main.ts, the import from "./platform/log" becomes { createLog, setLogFormat, setLogLevel }; after setLogLevel(config.LOG_LEVEL):
setLogFormat(config.LOG_FORMAT);
```

```ts
// apps/server/test/preload.ts, add (keep the existing lines; import order per the lint):
import { setLogFormat } from "../src/platform/log";

// The tests read console spies in the text form; the CLI tests spawn scripts with this env (ADR 0024, F089).
process.env.LOG_FORMAT = "text";
setLogFormat("text");
```

`.env.example`, directly after the line `LOG_LEVEL=info`:

```
# json = one JSON object per line (the VPS); text = "[module] event key=value" (dev). Unset = json.
LOG_FORMAT=text
```

`deploy/compose.yaml`, `services.server.environment`, after `WEB_DIST: /app/apps/web/dist`:

```yaml
      # The VPS log is JSON lines whatever .env says: a new install copies .env.example, which sets text (ADR 0024).
      LOG_FORMAT: json
```

**Decisions.** D5 refined by D21 (the compose pin), D11.

**Test.** In `config.test.ts`, a `describe("LOG_FORMAT", …)`:

1. `loadConfig(fullEnv).LOG_FORMAT` is `"json"`.
2. `loadConfig({ ...fullEnv, LOG_FORMAT: "text" }).LOG_FORMAT` is `"text"`; `LOG_FORMAT: ""` gives `"json"`.
3. `LOG_FORMAT: "xml"` throws `ConfigError` whose `keys` contain `"LOG_FORMAT"` (use the existing `configError` helper of the file).

**Check.**

```
bun test apps/server/src/platform/config.test.ts
bun -e 'const y = await Bun.file("deploy/compose.yaml").text(); if (!/\n      LOG_FORMAT: json\n/.test(y)) throw new Error("pin missing"); console.log("pin ok")'
```

Do not run `docker compose config`: it needs the env values of the VPS.

**Done when.** Tests 1–3 pass; the pin check prints `pin ok`; `git diff .env.example deploy/compose.yaml` shows only the lines above.

**Out of scope.** `deploy/README.md` (stage 07). The VPS `.env`.

## Step 2 — `withLogContext` and `log.with`

**Goal.** Code can open a log context for a run or a request, and a child logger can add fixed ids; the writer merges them into every line in the order context → child → call (D8).

**Files.** Change: `apps/server/src/platform/log.ts`, `apps/server/src/platform/log.test.ts`.

**Interfaces.**

```ts
// platform/log.ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface LogContext {
  job?: string;
  run_id?: string;
  request_id?: string;
}

/** D15: every line written inside fn (also after await) carries these keys. A nested call adds keys; an outer key keeps its value. */
export function withLogContext<T>(context: LogContext, fn: () => T): T;

export interface Log {
  // … the stage 01 overloads stay …
  /** A child logger: every line adds `fields` after the context keys (D3, D8). */
  with(fields: LogFields): Log;
}
```

Rules:

1. One module-level `AsyncLocalStorage<Readonly<LogContext>>`. `withLogContext` merges: `{ ...context, ...outer }` with `undefined` values removed first (so an outer key wins), then `storage.run(merged, fn)`.
2. Field sources in line order: the context store (keys in the order `job`, `run_id`, `request_id`), the child fields (parent's first, then the child's own), the call fields. Each key goes through the stage 01 checks (name listed, value allowed, not on the line yet); a failure counts one drop on the line. The merge inside `withLogContext` counts nothing.
3. Old form in `json`: the line is `{ time, level, module, event: "legacy_text", msg, …context keys }` (the context keys pass the same checks; a drop adds `dropped_fields`). Old form in `text`: unchanged, `console.log(prefix, ...args)`, no context.
4. `createLog(module)` returns `makeLog(module, [])`; `with(fields)` returns `makeLog(module, [...parentFields, fields])`. The child does not check fields when it is made; the writer checks them at each line.

**Decisions.** D3, D8, D15.

**Test.** In `log.test.ts`, a `describe("context", …)`. Fixed values: `R = "0f0e0d0c-0b0a-4908-8706-050403020100"`, `Q = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"`, `M` and `O` of stage 01. JSON format unless the case says text.

4. In a run: `await withLogContext({ job: "mail.sync", run_id: R }, async () => { await Bun.sleep(1); log.info("sync_done", { count: 1 }); })` → keys in order `time, level, module, event, msg, job, run_id, count`; `job` `"mail.sync"`, `run_id` `R`.
5. Outside any context: a line has no `job`, `run_id` or `request_id`.
6. Nested: inside the run of case 4, `await withLogContext({ request_id: Q }, async () => log.info("a"))` → `job`, `run_id`, `request_id` all present; a line after the inner call returns (still in the outer run) has no `request_id`.
7. Outer key wins: outer `{ run_id: R }`, inner `{ run_id: Q }` → the inner line has `run_id` `R` and no `dropped_fields`.
8. A call cannot replace a context key: inside `{ run_id: R }`, `log.info("a", { run_id: Q })` → `run_id` `R`, `dropped_fields` `1`. Outside any context, `log.info("a", { job: "mail.sync" })` → `job` `"mail.sync"`, no drop.
9. Two runs at once: `await Promise.all([withLogContext({ run_id: R }, async () => { await Bun.sleep(5); log.info("a"); }), withLogContext({ request_id: Q }, async () => { await Bun.sleep(1); log.info("b"); })])` → line `b` has `request_id` `Q` and no `run_id`; line `a` has `run_id` `R` and no `request_id`.
10. Child: `createLog("mail").with({ org_id: O }).info("a", { mailbox_id: M })` → keys after `msg`: `org_id`, `mailbox_id`. Grandchild: `.with({ org_id: O }).with({ mailbox_id: M }).info("a")` → both. A bad child field `.with({ subject: "s" } as never).info("a")` → no `subject`, `dropped_fields` `1`.
11. Child in a run: inside `{ job: "mail.sync", run_id: R }`, `log.with({ org_id: O }).info("a")` → keys after `msg`: `job`, `run_id`, `org_id`.
12. Old form in JSON inside `{ run_id: R }`: `log.info("free text 1")` → `event` `"legacy_text"`, `msg` `"free text 1"`, `run_id` `R`.
13. Old form in text inside `{ run_id: R }`: `log.info("free text 1")` → `out.mock.calls[0]` equals `["[mail]", "free text 1"]`.
14. Text event form inside `{ job: "mail.sync", run_id: R }`: `log.info("sync_done", { count: 1 })` → `["[mail]", `sync_done job=mail.sync run_id=${R} count=1`]`.
15. A bad context value: inside `{ job: "bad job" }`, `log.info("a")` → no `job` key, `dropped_fields` `1`.
16. Return value: `withLogContext({ run_id: R }, () => 7)` is `7`; `await withLogContext({ run_id: R }, async () => 8)` is `8`.

**Check.**

```
bun test apps/server/src/platform/log.test.ts
bun run typecheck
```

**Done when.** Tests 4–16 pass, and the stage 01 tests still pass.

**Out of scope.** Opening a context in the scheduler, HTTP or `job:run` (stage 03). Any call site.

## Stage done when

- Steps 1 and 2 are done.
- The Proof of `plan.md` ends with `PROOF_OK` (`NN` = `02`). The whole unit and integration suites run in `text` (the preload), so no existing test changes.
