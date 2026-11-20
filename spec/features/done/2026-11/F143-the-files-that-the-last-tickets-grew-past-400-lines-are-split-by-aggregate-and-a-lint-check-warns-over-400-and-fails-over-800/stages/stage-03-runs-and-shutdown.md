# F143 stage 03 — run tracker and shutdown of the server start-up [risky]

Needs: nothing. May run next to every other stage except 12 (12 needs this stage).
Part of [`../plan.md`](../plan.md). Review: Opus, before the land.

## Goal

The 20 `let …Run` variables and the `shutdown()` body of `apps/server/src/main.ts` become two small tested units. Start, logs, jobs and the stop order do not change. This prepares the file split of stage 12 (D9).

## Step 1 — run tracker

- **File:** `apps/server/src/start/runs.ts`.
- **Interface (stage 12 uses it):**
  ```ts
  export interface RunTracker {
    /** The scheduler callback: it starts run(), keeps the newest promise under name, and returns that promise (a rejection reaches the scheduler). */
    track(name: string, run: () => Promise<void>): () => Promise<void>;
    /** Resolves when the newest run of every tracked name has settled (Promise.allSettled). */
    settled(): Promise<void>;
  }
  export function createRunTracker(): RunTracker;
  ```
- At `HEAD` shutdown waits for these 20 jobs: `triage.worker`, `loops.analyze`, `replies.drafter`, `replies.sweep`, `trust.history`, `trust.regate`, `trust.tripwire`, `loops.match`, `contacts.refresh`, `actions.committer`, `triage.returned`, `actions.expiry`, `loops.chaser`, `channels.notifier`, `channels.digest`, `channels.report_mail`, `channels.push`, `channels.operator`, `ops.slo`, `platform.retention`. `mail.sync` and `platform.heartbeat` are not waited for; keep it so. If `HEAD` differs, stop and ask.
- Call sites keep the literal `scheduler.add("<name>", <cron>, runs.track("<name>", …))`: three docs tests match `scheduler\.add\("`.

## Step 2 — shutdown

- **File:** `apps/server/src/start/shutdown.ts`.
- **Interface (stage 12 uses it):**
  ```ts
  export interface ShutdownSteps {
    stopScheduler(): void;
    stopTelegram: (() => Promise<void>) | null; // read at shutdown time (late binding)
    settled(): Promise<void>;
    stopServer(): Promise<void>;
    closeWeb(): Promise<void>;
    destroyDb(): Promise<void>;
    exit(code: number): void;
    sleep(ms: number): Promise<void>;
  }
  export function createShutdown(steps: () => ShutdownSteps): () => Promise<void>;
  ```
- Order as at `HEAD`: scheduler stop; Telegram stop raced against 10 s (an error is ignored); `settled()` raced against 30 s; server stop; web close; DB destroy; `exit(0)`. A second call does nothing.
- `main.ts` builds the steps from its values and registers SIGTERM and SIGINT before it logs `server_listening`, as now.

## Step 3 — the tests that read the old variables

These asserts read the `Promise.allSettled([` list or the `xRun` names and cannot hold after step 1. Change each to read the `runs.track("<name>"` call of the same job (same meaning: the job is waited for at shutdown):
- `apps/server/src/composition.test.ts` (the history, sender-profile, push, report-mail and tripwire blocks; grep `allSettled` and `Run\b`).
- `apps/server/test/integration/trust-regate.test.ts` (the `Promise\.allSettled` regex for `regateRun` and `tripwireRun`).
- Any other test that a grep for `allSettled\|Run =` in tests that read `main.ts` finds. Name each in the final message. No other assert changes.

## Test

`apps/server/src/start/runs.test.ts`:
1. `track("a", run)` with a deferred run: `settled()` is pending after one macrotask; after `resolve()` it resolves.
2. The `a` callback twice; the first run never resolves, the second resolves: `settled()` resolves (newest run only, as at `HEAD`).
3. A run that rejects with `Error("x")`: the callback returns a promise that rejects with it; `settled()` resolves.
4. No tracked name: `settled()` resolves at once.

`apps/server/src/start/shutdown.test.ts` (fake steps that push their name to a list; a fake `sleep` that resolves on demand):
5. All steps resolve: the list is `stopScheduler, stopTelegram, settled, stopServer, closeWeb, destroyDb, exit(0)`.
6. `stopTelegram` never resolves: after the 10 000 ms sleep resolves, shutdown goes on to `settled`.
7. `settled` never resolves: after the 30 000 ms sleep resolves, shutdown goes on to `stopServer`.
8. `stopTelegram` is null: no Telegram step, the rest in order.
9. Two calls: each step runs once.
10. `stopTelegram` rejects: shutdown goes on.

`apps/server/src/start/jobs.test.ts` (reads `main.ts`; stage 12 widens it):
11. The sorted `scheduler.add("<name>"` names equal the 22 names: the 20 above plus `mail.sync`, `platform.heartbeat`.
12. The sorted `runs.track("<name>"` names equal the 20 names above.

Existing integration guards, unchanged: `main-start-log.test.ts` (JSON lines, SIGTERM, exit 0; exit 1 on a crash), `main-sso-kill.test.ts`.

Guard checks (scratch edits, then revert; write them in the final message): drop `settled` from the shutdown steps → case 5 fails; remove one `runs.track` wrap → case 12 fails.

## Done when

- Cases 1–12 pass; the guard checks fail as stated.
- Proof: `plan.md` § Proof with `NN=03`.

## Out of scope

Moving start-up blocks out of `main.ts` (stage 12). New jobs, new log events, a changed cron.
