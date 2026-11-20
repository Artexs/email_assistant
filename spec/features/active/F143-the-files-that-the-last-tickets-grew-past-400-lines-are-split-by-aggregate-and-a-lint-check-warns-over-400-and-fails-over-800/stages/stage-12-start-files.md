# F143 stage 12 — server start-up files by runtime [risky]

Needs stage 03: `start/runs.ts` (`createRunTracker`), `start/shutdown.ts` (`createShutdown`), `start/jobs.test.ts`. May run next to every stage except 03 (stage 04 keeps `webDeps` exported from `./web`).
Part of [`../plan.md`](../plan.md). Review: Opus, before the land.

## Goal

`apps/server/src/main.ts` only loads config, opens the DB and calls one start function per runtime, in the `HEAD` order. Start, logs, jobs and shutdown do not change (D9).

## Step 1 — start files

- **Files:** `apps/server/src/start/context.ts` and one file per runtime: `mail.ts` (mail sync, heartbeat), `operator.ts` (operator notices, service-level alerts), `triage.ts` (start re-gate, model-scope jobs), `jobs.ts` (always-on jobs), `push.ts`, `telegram.ts`, `http.ts` (web, server, shutdown, signals, `server_listening`). Each ≤ 400 lines; `main.ts` ≤ 150.
- **Interface:** `export interface StartContext { config; db; log; scheduler; runs: RunTracker; startedAt: Date; late: { telegram: TelegramRuntime | null } }`, plus the shared values that two start files need (the worker names them at `HEAD`). Each file exports `start<Runtime>(ctx: StartContext, …): <what a later start needs>`.
- `late.telegram`: the operator send reads it at send time; `startTelegram` sets it; the shutdown steps read it at shutdown time.
- **Order stays as at `HEAD`.** Fact: `mail.sync`, `platform.heartbeat`, `channels.operator` and `ops.slo` are scheduled before the start re-gate; the re-gate runs (and exits 1 on failure) before the triage worker and the committer exist; signal handlers exist before `server_listening`. Do not reorder any block.
- History: make the runtime files with `history-copies.sh` from `main.ts` (D5), then trim and restructure. `context.ts` is new code.

## Step 2 — lint seams

- `eslint.config.js`: add `apps/server/src/start/**` to the composition-root globs (`roots`, the index-only targets) and to the targets of the `platform/cli.ts` zone. So no module imports `start/`, `start/` imports modules only through `index.ts`, and `start/` cannot print CLI output.
- Run `bun run graph:modules`; commit its output if it changes.

## Step 3 — text-reading tests

- **File:** `apps/server/src/start/source.test-helper.ts`: `export function startSource(): string` = the text of `main.ts`, then every `start/*.ts` (no test files) in the order `main.ts` calls their start function (read the call order from `main.ts`, not the file names).
- These tests read `main.ts` as text; each reads `startSource()` instead, with no assert change: `main.test.ts`, `composition.test.ts`, `trust-docs.test.ts`, `sender-context-docs.test.ts`, `open-loops-docs.test.ts`, `own-model-docs.test.ts`, `scripts/mail-hosts-configured.test.ts`, `start/jobs.test.ts`, `apps/server/test/integration/trust-regate.test.ts`; grep for more and name each in the final message.
- One assert changes in meaning: the `trust-regate.test.ts` check that `regateAll(… "start")` comes before `createCommitterJob(` becomes: in `main.ts`, the `startTriage(` call comes before the `startJobs(` call, and `regateAll(… "start")` is in `start/triage.ts`.
- If an assert needs `main.ts` itself (for example "main.ts calls `setLogRelease`"), keep that call in `main.ts`.

## Test

1. `start/jobs.test.ts` cases 11–12 of stage 03 pass on `startSource()` with the same 22 and 20 names.
2. New case in `jobs.test.ts`: the `start*(` calls in `main.ts` come in this order: `startMail`, `startOperator`, `startTriage`, `startJobs`, `startPush`, `startTelegram`, `startHttp` (adjust the names to the files of step 1; the order is the `HEAD` block order).
3. Existing guards, unchanged: `runs.test.ts`, `shutdown.test.ts`, `main-start-log.test.ts`, `main-sso-kill.test.ts`, `borders.test.ts`.
4. Lint guard: a scratch file in `start/` that imports a module's non-index file fails `bun run lint`; a scratch module file that imports `start/` fails. Revert; write both in the final message.
5. Guard check: swap two `start*` calls in `main.ts` in a scratch edit; case 2 fails. Revert.

## Docs

A `docs/` page that points a job at `main.ts` (`capabilities/digest-and-notices.md`) points at its start file.

## Done when

- Cases 1–5 pass; `main.ts` ≤ 150 lines; each `start/*.ts` ≤ 400.
- Proof: `plan.md` § Proof with `NN=12`.

## Out of scope

New jobs, new log events, a changed cron or env switch.
