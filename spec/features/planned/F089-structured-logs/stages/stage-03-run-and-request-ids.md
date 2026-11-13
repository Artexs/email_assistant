# F089 stage 03 — Run ids for job ticks, request ids for HTTP

Part of [`../plan.md`](../plan.md). Read D3, D15, D16, D17 and "Facts checked" P1, P2 of `plan.md` first. Needs stages 01 and 02 landed. Three steps. A review job checks it before the land.

File gate (ticket § Sequenced): this stage edits `platform/http.ts`. It never builds at the same time as F087 stage 4 or 5.

## Step 1 — A context per job tick

**Goal.** Every line that a scheduled job writes carries `job` and a fresh `run_id`; the end of each tick is one line inside the same context.

**Files.** Change: `apps/server/src/platform/scheduler.ts`, `apps/server/src/platform/scheduler.test.ts`.

**Interfaces.**

```ts
// platform/scheduler.ts
import { randomUUID } from "node:crypto";

import { errorFields } from "./errors";
import { createLog, withLogContext } from "./log";

/** One tick of a job in its own log context (D16). Never throws: a failure is one job_failed line. */
export async function runJobTick(name: string, fn: () => Promise<void>): Promise<void>;
```

`runJobTick` body: `const start = performance.now()`; inside `withLogContext({ job: name, run_id: randomUUID() }, async () => { try { await fn(); log.debug("job_done", { ms }); } catch (error) { log.error("job_failed", { ms, ...errorFields(error) }); } })`, with `ms = Math.round(performance.now() - start)`.

`createScheduler().add(name, pattern, fn)` becomes:

```ts
new Cron(
  pattern,
  {
    protect: () => log.debug("job_skipped", { job: name }),
    // A last guard: runJobTick catches every failure itself.
    catch: (error) => log.error("job_failed", { job: name, ...errorFields(error) }),
  },
  () => runJobTick(name, fn)
)
```

The two old-form calls of the file are gone (they are 2 of the 46 calls of D25). `describeError` is no longer imported here.

**Decisions.** D14, D16.

**Test.** In `scheduler.test.ts`. JSON tests set `setLogFormat("json")` and `setLogLevel("debug")` and restore `"text"` and `"info"` in `finally`. `const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`.

1. JSON: `await runJobTick("mail.sync", async () => { await Bun.sleep(1); createLog("mail").info("sync_done"); })` → two lines on `console.log`: `sync_done` (`module` `mail`) and `job_done` (`module` `scheduler`, `ms` a number ≥ 0); both have `job` `"mail.sync"` and the same `run_id`, which matches `UUID`.
2. Two ticks: two `runJobTick("mail.sync", async () => undefined)` calls → two `job_done` lines with different `run_id` values.
3. A failure: `await runJobTick("x", async () => { throw Object.assign(new Error("MARKER-SCHED"), { code: "EAUTH" }); })` resolves; one line on `console.error`: `event` `job_failed`, `job` `"x"`, `error` `"Error"`, `error_code` `"EAUTH"`, a `run_id`; the raw output has no `MARKER-SCHED`.
4. The existing test "a failed job logs its error label and not its message" (text form, real croner tick) now expects the output to contain `job_failed`, `job=throws` and `error=Error`, and not `MARKER-SCHED`. The other 3 existing tests stay as they are.

**Check.** `bun test apps/server/src/platform/scheduler.test.ts` (about 10 s: the croner tests wait for real ticks).

**Done when.** Tests 1–4 pass and the 3 other existing scheduler tests pass.

**Out of scope.** The job functions (`mail.sync`, `triage.worker`, …) and their lines.

## Step 2 — A context and a header per HTTP request

**Goal.** Every line written while the server handles a request carries its `request_id`, and every response has the header `x-request-id` with the same value.

**Files.** Change: `apps/server/src/platform/http.ts`, `apps/server/src/platform/http.test.ts`.

**Interfaces.**

```ts
// platform/http.ts
import { randomUUID } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** D17: a proxy's x-request-id is reused only from a trusted peer and only as a UUID (lower-cased). null: make a new one. */
export function incomingRequestId(
  header: string | undefined,
  peer: string | undefined,
  trusted: BlockList
): string | null;
```

Body: `if (header === undefined || peer === undefined) return null;` `const value = header.trim().toLowerCase();` return `value` when `UUID_PATTERN.test(value)` and `isTrusted(normalizeAddress(peer), trusted)`, else `null` (`isTrusted` and `normalizeAddress` exist in the file).

In `createApp`, the first `app.use` (before the access-log middleware and before `secureHeaders`):

```ts
  // D17: one request id per request, in every log line of the request and in the response header.
  app.use("*", async (c, next) => {
    const requestId =
      (web === null ? null : incomingRequestId(c.req.header("x-request-id"), web.connInfo(c), web.trustedProxies)) ??
      randomUUID();
    await withLogContext({ request_id: requestId }, () => next());
    c.header("x-request-id", requestId);
  });
```

The header is set after `next()` returns: set before, it is lost on a raw `Response` (probe P2). Do not convert the other log lines of `http.ts` here (stage 05).

**Decisions.** D17.

**Test.** In `http.test.ts`. `U = "3f2b8c1d-4e5a-4b6c-8d7e-9f0a1b2c3d4e"`, `trusted = buildTrustedProxies(["172.18.0.0/16"])`.

5. `incomingRequestId` table (`test.each`): `(U, "172.18.0.1")` → `U`; `(U.toUpperCase(), "172.18.0.1")` → `U`; `(U, "::ffff:172.18.0.1")` → `U`; `(U, "203.0.113.9")` → `null`; `(U, undefined)` → `null`; `(undefined, "172.18.0.1")` → `null`; `("abc", "172.18.0.1")` → `null`; `(`${U},${U}`, "172.18.0.1")` → `null`; `("x".repeat(36), "172.18.0.1")` → `null`.
6. `createApp({ checkDb: async () => true, web: null })`: `/health` (200), `/nope` (404), and a `checkDb` that throws (500) each answer with an `x-request-id` that matches the UUID pattern; two `/health` requests get two different ids; a request with the header `x-request-id: U` gets an id that is not `U` (no web, no trusted peer).
7. JSON and debug: a `/health` request writes the access line (still the old form in this stage, so `event` `legacy_text`) with `request_id` equal to the response header. Restore the format and level in `finally`.

**Check.** `bun test apps/server/src/platform/http.test.ts`.

**Done when.** Tests 5–7 pass and the existing `http.test.ts` tests pass.

**Out of scope.** The trusted proxy list itself. The `x-request-id` in the web app. Telegram updates (D26).

## Step 3 — `job:run` and the integration test

**Goal.** A job run by hand also has a context, and one test proves on the real DB that a triage run and an `/api/me` request at the same time each keep their own id in every line.

**Files.**

- Change: `apps/server/src/scripts/job-run.ts`.
- New: `apps/server/test/integration/log-context.test.ts`.

**Interfaces.** In `job-run.ts`, after the `TELEGRAM_BOT_TOKEN` check, wrap the code from `const db = createDb(...)` to the end of its `finally` in `return await withLogContext({ job: args.name, run_id: randomUUID() }, async () => { … })`. The exit codes and the old-form lines stay (scripts are E8a).

The integration test, one `test(…, 30_000)`:

- Setup: copy the shape of `triage-logs.test.ts` (`createOrgWithMailbox`, `insertDefaultSettings`, `insertTestEmail`, `pauseOtherMailboxes`, a fake `generate` with one successful classifier answer, `createTriageJob` with `scope: { kind: "all" }`, `now` fixed at `2026-11-20T10:00:00Z`) inside `withRollback(db, async (trx) => …)`. Copy `appFor` of `web-me.test.ts` (the `webTestApp` with `tenancyRoutes`) with one session `"good-owner"` → the owner of `webOrg(db)`; clean the org up in `afterEach`.
- Inside the rollback, after the setup: `setLogFormat("json")`, `setLogLevel("debug")`, spy on `console.log` and `console.error`; then `const [, res] = await Promise.all([runJobTick("triage.worker", () => triage.run()), app.request("/api/me", as("good-owner"))])`; restore the spies, `setLogFormat("text")`, `setLogLevel("info")` in `finally`.
- Parse each captured call: one argument, `JSON.parse`.

**Test.**

8. `res.status` is 200; `const H = res.headers.get("x-request-id")` matches the UUID pattern.
9. The lines with `request_id === H`: at least 1 (the access line); none of them has `job` or `run_id`.
10. The lines with `job === "triage.worker"`: at least 2 (`job_done` and at least one line of the triage or LLM code); all have the same `run_id`, a UUID; none has `request_id`.
11. Every captured line has `request_id === H` or the `run_id` of case 10 (no line without a context).
12. The mail of the setup is `triaged` after the run (the run really did its work).

**Check.** `bun test apps/server/test/integration/log-context.test.ts` (needs the job DB that the prepare script made).

**Done when.** Tests 8–12 pass. This closes the "Not verified" item "the store through `pg` and Kysely awaits" of `plan.md`: say so in the final message with the log line of the test run.

**Out of scope.** Converting the triage or tenancy lines (E8a).

## Stage done when

- Steps 1–3 are done.
- The Proof of `plan.md` ends with `PROOF_OK` (`NN` = `03`).
- A review job checks the stage before the land (plan § Review): it checks D17 (no reuse from an untrusted peer, no non-UUID value) and that no line of test 11 lacks a context.
