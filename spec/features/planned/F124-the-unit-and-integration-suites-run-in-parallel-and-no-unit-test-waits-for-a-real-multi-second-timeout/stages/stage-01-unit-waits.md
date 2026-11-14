# F124 stage 01 — Short unit waits (auth mail, Telegram getMe, scheduler)

Part of [`../plan.md`](../plan.md). Not `[risky]`: test seams with the old values as defaults.

Goal of the stage: the 6 unit cases of `plan.md` F3 in `apps/server/src` that wait for production timeouts (auth 1, Telegram 1, scheduler 4) are shorter; all but the overlap test run in under 1 s. Production behaviour does not change.

## Step 1 — Auth mail: injectable outer guard extra

- **Goal:** `auth-mail.test.ts:99` ("a send that never settles gives TIMEOUT and closes the transport") runs in under 500 ms.
- **Files:** `apps/server/src/platform/auth-mail.ts`, `apps/server/src/platform/auth-mail.test.ts`.
- **Interfaces:** `AuthMailerDeps` gets `outerExtraMs?: number` with a one-line doc comment ("Extra time of the outer guard timer after the SMTP timeouts; default 5 s."). `createAuthMailer` uses `deps.outerExtraMs ?? OUTER_TIMER_EXTRA_MS`. The constant and its value stay.
- **Decisions:** D3, P2.
- **Test:**
  1. The existing case sets `timeoutMs: 50, outerExtraMs: 0` and asserts `performance.now() - started < 1000` (was `< 6000`). `result` is `{ ok: false, code: "TIMEOUT" }` and `closed` is `1`, as now. Remove the 10,000 ms test timeout argument (the default 5 s is enough).
  2. New case: with `timeoutMs: 50, outerExtraMs: 200`, a send that never settles does not resolve before 200 ms (`elapsed >= 200`) and resolves with `TIMEOUT` before 1,000 ms. It proves that the extra is added, not replaced.
- **Check:** `bun test apps/server/src/platform/auth-mail.test.ts`.
- **Done when:** both cases pass; no other caller of `createAuthMailer` changes (`grep -rn "createAuthMailer(" apps/server/src`).
- **Out of scope:** the SMTP timeouts and `DEFAULT_TIMEOUT_MS`.

## Step 2 — Telegram `botUsername`: injectable timeout

- **Goal:** the `botUsername` cases of `telegram/runtime.test.ts` (line 59 and the cases near it) run in under 500 ms each.
- **Files:** `apps/server/src/modules/channels/telegram/runtime.ts`, `.../telegram/runtime.test.ts`.
- **Interfaces:** `TelegramRuntimeDeps` gets `botUsernameTimeoutMs?: number`; `botUsername` uses `deps.botUsernameTimeoutMs ?? BOT_USERNAME_TIMEOUT_MS`. The constant (3,000) and its comment stay. `main.ts` passes nothing.
- **Decisions:** D3, P2.
- **Test:**
  1. `runtimeFor` takes an optional timeout and the `botUsername` cases pass `50`. The assertions stay: two parallel calls both reject, a third call rejects with `SoftError`, `requests` is `1`.
  2. Add `expect(elapsed).toBeLessThan(1000)` for the hanging `getMe` case, with `elapsed` measured around the three calls. Remove the 15,000 ms test timeout argument.
- **Check:** `bun test apps/server/src/modules/channels/telegram/runtime.test.ts`.
- **Done when:** all cases in the file pass; `grep -rn "BOT_USERNAME_TIMEOUT_MS" apps/server/src` shows the constant is still the default.
- **Out of scope:** `DIRECT_SEND_TIMEOUT_MS` (its test already passes `100`).

## Step 3 — Scheduler tests: cron only where croner is under test

- **Goal:** `platform/scheduler.test.ts` runs in under 5 s in total (now about 7.8 s; the overlap test alone takes 2–3 s), with the same rules proven.
- **Files:** `apps/server/src/platform/scheduler.test.ts` only. No change to `scheduler.ts`.
- **Decisions:** D4.
- **Test:** keep one case per rule:
  1. "a tick never overlaps the previous one": unchanged (real ticks; it is the only proof of croner `protect`, F5).
  2. "a throwing job does not stop the next tick": replace with a `runJobTick` case of the same name: `await runJobTick("throws", async () => { throw new Error("boom"); })` resolves (does not reject), and a second `runJobTick("throws", …)` call after it runs its function again (a counter is `2`). Reason: the cron keeps going because `runJobTick` never throws (its doc comment); croner's own `catch` option is the last guard and stays untested by this file, as now.
  3. "a failed job logs its error label and not its message": call `runJobTick` directly, with no scheduler. Same four `expect` lines (`job_failed`, `job=throws`, `error=Error`, no `MARKER-SCHED`).
  4. "stop() stops all jobs": keep real ticks, but wait for one witness tick (`witnessRuns >= 1`), not two. The rule (jobs stopped before their first tick never run) holds after one tick of a later scheduler.
  5. Other cases of the file: unchanged.
- **Check:** `bun test apps/server/src/platform/scheduler.test.ts` and a JUnit run of the file: `bun test apps/server/src/platform/scheduler.test.ts --reporter=junit --reporter-outfile=/tmp/f124-s01/scheduler.xml`; the `time` of the file suite is under 5.
- **Done when:** all cases pass; the file time is under 5 s.
- **Out of scope:** a fake clock or a fake cron driver (D4 rejects them).

## Stage check

```
bun test packages/core apps/server/src tools/fake-telegram/src apps/web/src/lib apps/web/src/i18n apps/web/integrations --reporter=junit --reporter-outfile=/tmp/f124-s01/unit.xml
```
No case in `/tmp/f124-s01/unit.xml` has `time` of 3 or more, except "a tick never overlaps the previous one" (Done when 1). A one-line check: `grep -oE 'testcase name="[^"]*" [^>]*time="[0-9.]+"' /tmp/f124-s01/unit.xml | grep -v 'name="a tick never overlaps the previous one"' | grep -E 'time="([3-9]|[1-9][0-9]+)\.' ` prints nothing. Save its output to `/tmp/f124-s01/slow.log`. `tools/fake-telegram/src/server.test.ts:73` (1.2 s, long poll) stays as it is.

## Done when

Steps 1–3 done, the stage check prints nothing, then the Stage 01 Proof of `plan.md` § Proof prints `PROOF_OK`.
