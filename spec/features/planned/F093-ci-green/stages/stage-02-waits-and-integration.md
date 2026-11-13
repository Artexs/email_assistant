# F093 stage 02 — Condition waits and the integration suite on the pinned Bun

Part of [`../plan.md`](../plan.md). Not `[risky]`. Review before the land only when step 3 changed an integration test or reported a quarantine (plan § Review).

Goal of the stage: the scheduler tests wait for conditions, not fixed sleeps (owner decisions D1, D2), and `bun run test:int:ci` passes on Bun 1.3.14 or each failure is reported by D12. Three steps. Spawn with `--timeout 120m` (step 3 may need a diagnosis).

Needs stage 1 landed: `.bun-version`, `scripts/ci-bun.sh`, `test:unit:ci`, `test:int:ci`.

Read first: `plan.md` D1, D10, D11, D12, D13, F3, F10, F12, NV1, "Rules for every stage".

## Step 1 — The `waitFor` helper (D10)

**Goal:** one bounded condition wait for every test that waits for time-driven code.

**Files:** new `apps/server/test/wait-for.ts` (shared test code lives under `apps/server/test/`, plan F12); new `apps/server/src/platform/wait-for.test.ts` that imports `../../test/wait-for`. The test sits in `src/` because `test:unit` does not run `apps/server/test/`.

**Interfaces:**

```ts
/** Polls `condition` every `everyMs` until it is true; throws after `timeoutMs`. Use it instead of a fixed sleep. */
export async function waitFor(
  condition: () => boolean,
  what: string,
  opts: { timeoutMs?: number; everyMs?: number } = {}
): Promise<void>
```

Defaults: `timeoutMs` 5000, `everyMs` 25. Check the condition first, before any sleep. Loop: if `condition()` → return; if `Date.now() >= deadline` → throw `new Error(\`waitFor: ${what} not true after ${timeoutMs} ms\`)`; `await Bun.sleep(everyMs)`. The deadline is `Date.now() + timeoutMs` at the start.

**Decisions:** D10. The local `waitFor` in `apps/server/test/integration/telegram-logs.test.ts` stays (no mass edit).

**Test** (`apps/server/src/platform/wait-for.test.ts`, `describe("waitFor")`):

1. A condition that is already true returns in less than 100 ms and calls the condition once (count the calls).
2. A condition that turns true after a `setTimeout(…, 100)`: returns; elapsed is at least 90 ms and below 1000 ms.
3. A condition that stays false with `{ timeoutMs: 100, everyMs: 10 }`: rejects with the message `waitFor: never not true after 100 ms` (`what` = `"never"`); elapsed below 1000 ms.

**Check:** `bash scripts/ci-bun.sh test apps/server/src/platform/wait-for.test.ts` → 3 pass; `bun run typecheck` passes (the `apps/server` tsconfig includes `test/**/*`, plan F12).

**Done when:** commit `F093 s2: waitFor, a bounded condition wait for tests`.

**Out of scope:** changing other tests to `waitFor`.

## Step 2 — The scheduler tests wait for conditions (D1, D2, D11)

**Goal:** `apps/server/src/platform/scheduler.test.ts` has no fixed sleep. Each test waits for the event it checks. No change in `scheduler.ts`.

**Files:** `apps/server/src/platform/scheduler.test.ts` only.

**Interfaces used:** `createScheduler()` from `./scheduler`; `setLogLevel` from `./log`; `waitFor` from `../../test/wait-for`; `spyOn` from `bun:test`. Facts (plan F10): `scheduler.ts` logs `debug` "`<name> skipped: the previous run is still going`" when a tick finds the job running, and `error` "`<name> failed: <label>`" when the job throws. `platform/log.ts` writes `debug` and `info` with `console.log` (only when the level allows it) and `warn`/`error` with `console.error`, each with the prefix `[scheduler]` as a separate argument. `setLogLevel` is process-wide: always restore `"info"` in `finally`.

Remove the local `sleep` helper. Keep `EVERY_SECOND = "* * * * * *"` and the per-test limit `10_000`. Helper in the file: `const joined = (calls: unknown[][]): string => calls.map((call) => call.map(String).join(" ")).join("\n");`.

The four tests, as probed (plan F10; 4/4 pass twice on each Bun version, 7.4–8.0 s per file):

1. **`a tick never overlaps the previous one`.** `spyOn(console, "log").mockImplementation(() => undefined)`; `setLogLevel("debug")`. A gate: `let release = () => {}; const gate = new Promise<void>((resolve) => { release = resolve; });`. The job: `running += 1; runs += 1; maxRunning = Math.max(maxRunning, running); if (runs === 1) await gate; running -= 1;`. Then `await waitFor(() => joined(logSpy.mock.calls).includes("slow skipped: the previous run is still going"), "a skipped tick")`; `expect(runs).toBe(1)`; `release()`; `await waitFor(() => runs >= 2, "a run after the release")`. `finally`: `scheduler.stop()`, `release()`, `setLogLevel("info")`, `logSpy.mockRestore()`. After: `expect(maxRunning).toBe(1)`.
2. **`a throwing job does not stop the next tick`.** `spyOn(console, "error")` muted (the error lines are expected, plan F3). Job: `runs += 1; throw new Error("boom")`. `await waitFor(() => runs >= 2, "two runs")`. `finally`: `scheduler.stop()`, `errorSpy.mockRestore()`. `expect(runs).toBeGreaterThanOrEqual(2)`.
3. **`a failed job logs its error label and not its message`.** `spyOn(console, "error")` muted. Job throws `new Error("MARKER-SCHED")`. `await waitFor(() => joined(errorSpy.mock.calls).includes("throws failed: Error"), "the error line")`. `finally`: `scheduler.stop()`. Then read the output, `errorSpy.mockRestore()`, and keep the two assertions: contains `throws failed: Error`, does not contain `MARKER-SCHED`.
4. **`stop() stops all jobs`.** Add jobs `a` and `b` that count `runs`; `scheduler.stop()`. Then a second scheduler `witness` with one job that counts `witnessRuns`. `await waitFor(() => witnessRuns >= 2, "two witness ticks")` (at least one full second of ticks passed). `finally`: `witness.stop()`. `expect(runs).toBe(0)`.

Each test calls `stop()` in `finally`, so a failed wait leaves no running cron job.

**Decisions:** D1, D2, D11. Rejected: a fake clock for croner (croner reads the wall clock; no seam in `createScheduler` and no product change in this ticket).

**Test:** the four tests above.

**Check:**

- `bash scripts/ci-bun.sh test apps/server/src/platform/scheduler.test.ts` → 4 pass. Run it 3 times; all pass.
- `bun test apps/server/src/platform/scheduler.test.ts` → 4 pass.
- `grep -nE "sleep\(|setTimeout" apps/server/src/platform/scheduler.test.ts` prints nothing.

**Done when:** commit `F093 s2: scheduler tests wait for the tick, not a fixed sleep`.

**Out of scope:** `scheduler.ts`; other tests with sleeps (`polling.test.ts`, `auth-mail.test.ts` wait 50 ms or less).

## Step 3 — The integration suite on the pinned Bun (D12, NV1)

**Goal:** know and fix the state of `test:int` on Bun 1.3.14. CI skipped it since 2026-11-08 because `test:unit` failed first (plan F1).

**Files:** only the integration tests or test fakes that step 3 must fix (`apps/server/test/**`, `tools/fake-telegram/test/**`), and `docs/known-alerts.md` when a fix closes a known alert.

**Do:**

1. Read the CI run of the stage 1 land: `gh run list --branch master --workflow CI --limit 5 --json databaseId,headSha,conclusion,status`, then `gh run view <id> --log-failed | grep -E "\(fail\)|hook timed out|Ran "` (or `--log` when it passed). Write its `test:int` result into the final message.
2. Run `bun run test:int:ci > /tmp/f093-s02/int-ci-first.log 2>&1` (this job has its own DB from the prepare step; no lock, `CLAUDE.md`). `grep -E "\(fail\)|Ran " /tmp/f093-s02/int-ci-first.log`.
3. For each failing test, find the cause: run it alone with `bash scripts/ci-bun.sh test <file>` and with `bun test <file>`. A pass on 1.4.4 and a fail on 1.3.14 is a version cause. Then act by the D12 table in `plan.md`:
   - Test code, a test fake, or a fixed sleep → fix it here (D1: `waitFor`; release a fake, as stage 1 did). Keep every assertion.
   - Bun 1.3.14 behaviour that also reaches product code, a real product bug, or no cause after 30 minutes → **stop**. Do not change product code, do not skip the test. Write in the final message: the test name, the file, the cause, the evidence (log lines, probe result). The coordinator quarantines it by D13 and continues this job.
4. At most three distinct causes fixed in this stage. More → stop and report the list.
5. Each fix: one commit `F093 s2: <test> <what changed>`.

**Decisions:** D7, D12, D13. Never `test.skip`, a retry or a longer timeout as a fix; only the coordinator quarantines.

**Test:** the failing tests themselves, after the fix, on both Bun versions.

**Check:** `bun run test:int:ci` → 0 fail (Proof); `bun run test:int` (local Bun) → 0 fail.

**Done when:** `test:int:ci` passes, or the final message reports each open failure by D12 and no other change was made for it.

**Out of scope:** e2e (`test:e2e` already passes on 1.3.14 in CI, plan F11); the `ci.yml` order of steps.

## Stage done when

- Steps 1–2 are committed; step 3 is committed or reported.
- The Proof of `plan.md` § Proof, stages 2 and 3 form, with `sNN` = `s02`, prints `PROOF_OK`:

  ```
  mkdir -p /tmp/f093-s02 && bun run lint > /tmp/f093-s02/lint.log 2>&1 && bun run typecheck > /tmp/f093-s02/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f093-s02/unit-ci.log 2>&1 && bun run test:int:ci > /tmp/f093-s02/int-ci.log 2>&1 && git diff --exit-code "$(git merge-base HEAD master)" -- bun.lock deploy/Dockerfile && echo PROOF_OK
  ```

  When step 3 stopped with a report, the Proof fails at `test:int:ci`; the final message says so and names the failing tests. Do not change the Proof.
- The final message lists the totals lines of `unit-ci.log` and `int-ci.log`, the CI run id read in step 3.1 and its result, and each D12 report.
