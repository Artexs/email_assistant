# F143 stage 03 — server start-up by runtime [risky]

Needs: nothing. May run next to every other stage (stage 04 keeps `webDeps` exported from `./web`).
Part of [`../plan.md`](../plan.md). Review: Opus, before the land.

## Goal

`apps/server/src/main.ts` (615 lines) only loads config, opens the DB and calls one start function per runtime, in the `HEAD` order. Start, logs, jobs and shutdown do not change. Decision D9.

## Step 1 — run tracker

- **File:** `apps/server/src/start/runs.ts`.
- **Interface:**
  ```ts
  export interface RunTracker {
    /** The scheduler callback: it starts run(), keeps the newest promise under name, returns it. */
    track(name: string, run: () => Promise<void>): () => Promise<void>;
    /** Resolves when the newest run of every tracked name has settled (Promise.allSettled). */
    settled(): Promise<void>;
  }
  export function createRunTracker(): RunTracker;
  ```
- It replaces the 20 `let …Run` variables. At `HEAD` shutdown waits for these 20 jobs: `triage.worker`, `loops.analyze`, `replies.drafter`, `replies.sweep`, `trust.history`, `trust.regate`, `trust.tripwire`, `loops.match`, `contacts.refresh`, `actions.committer`, `triage.returned`, `actions.expiry`, `loops.chaser`, `channels.notifier`, `channels.digest`, `channels.report_mail`, `channels.push`, `channels.operator`, `ops.slo`, `platform.retention`. `mail.sync` and `platform.heartbeat` are not waited for; keep it so. If `HEAD` differs from this list, stop and ask.
- Call sites keep the literal `scheduler.add("<name>", <cron>, runs.track("<name>", …))`: three docs tests match `scheduler\.add\("`.

## Step 2 — start files

- **Files:** `apps/server/src/start/context.ts` and one file per runtime: `mail.ts` (mail sync, heartbeat), `operator.ts` (operator notices, service-level alerts), `triage.ts` (start re-gate, model-scope jobs), `jobs.ts` (always-on jobs), `push.ts`, `telegram.ts`, `http.ts` (web, server, shutdown, signals, `server_listening`). Each ≤ 400 lines.
- **Interface:** `export interface StartContext { config; db; log; scheduler; runs: RunTracker; startedAt: Date; late: { telegram: TelegramRuntime | null } }` plus the shared values that two start files need (the worker names them at `HEAD`). Each start file exports `start<Runtime>(ctx: StartContext, …): <what a later start needs>`.
- `late.telegram`: the operator send reads it at send time; `startTelegram` sets it.
- Order, exits and log events stay as at `HEAD`: the start-up re-gate failure exits 1 before any worker exists; signal handlers exist before `server_listening`; shutdown stops the scheduler, then Telegram (10 s cap), then `runs.settled()` (30 s cap), then the server, the web, the DB, exit 0.
- `eslint.config.js`: add `apps/server/src/start/**` to the composition-root globs (`roots` and the index-only targets): no module imports `start/`; `start/` imports modules only through `index.ts`.
- `main.ts` keeps its path.
- History: make the runtime files with `history-copies.sh` from `main.ts` (D5), then trim and restructure. `runs.ts`, `context.ts` and the test helper are new code with no history merge.

## Step 3 — text-reading tests

- **File:** `apps/server/src/start/source.test-helper.ts`: `export function startSource(): string` = the text of `main.ts` and every `start/*.ts` (no test files), in file-name order.
- The tests that read `main.ts` as text (`main.test.ts`, `composition.test.ts`, the `*-docs.test.ts` files, `scripts/mail-hosts-configured.test.ts`; grep for more) read `startSource()` instead. No assert changes; if an assert needs `main.ts` itself, keep it on `main.ts`, or ask.

## Test

`apps/server/src/start/runs.test.ts`:
1. `track("a", run)` with a run that resolves after a deferred `resolve()`: `settled()` is still pending after one macrotask; after `resolve()` it resolves.
2. Two calls of the `a` callback; the first run never resolves, the second resolves: `settled()` resolves (the newest run only, as at `HEAD`).
3. A run that rejects: `settled()` resolves, no throw.
4. No tracked name: `settled()` resolves at once.

`apps/server/src/start/jobs.test.ts` (reads `startSource()`):
5. The sorted `scheduler.add("<name>"` names equal the 22 names at `HEAD`: the 20 above plus `mail.sync`, `platform.heartbeat`.
6. The sorted `runs.track("<name>"` names equal the 20 names above.

Existing integration guards, unchanged: `main-start-log.test.ts` (JSON lines, SIGTERM, exit 0; exit 1 on a crash), `main-sso-kill.test.ts`. Guard check: remove one `runs.track` wrap in a scratch edit; case 6 fails. Revert; write it in the final message.

## Docs

A `docs/` page that points a job at `main.ts` (`capabilities/digest-and-notices.md`) points at its start file.

## Done when

- `main.ts` ≤ 150 lines; every `start/*.ts` ≤ 400.
- Cases 1–6 pass; the guard check fails case 6.
- Proof: `mkdir -p /tmp/f143-s03 && bun run lint > /tmp/f143-s03/lint.log 2>&1 && bun run typecheck > /tmp/f143-s03/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f143-s03/unit.log 2>&1 && bun run test:int:ci > /tmp/f143-s03/int.log 2>&1 && echo PROOF_OK`

## Out of scope

New jobs, new log events, a change of any cron.
