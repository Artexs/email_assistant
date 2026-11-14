# F124 · Parallel test runs and short unit waits — plan

> **Status 2026-11-14 — planned.** Plan base: 54fe78f. Two stages, not built.

## Input

Owner words that set the goal, word for word (chat 2026-11-14):

- "this could allow me to reduce number of unnecessary tests which will make the repositories smaller and easier to run so on the test cases, test suites will run faster and so on."
- "It should also validate if this approach is correct and if there are any other or better ones."
- Answer to the proposed defaults ("Aim: both, as two tickets. Speed = `--parallel` ticket. Quality = this audit + rubric."): "ok".

Why a separate ticket: the probe below shows that deletion of tests cannot give much speed. The wall time of the suites comes from real waits and from serial file runs, not from the count of tests.

### Product decisions

- **P1** Speed comes from parallel files and short waits, not from fewer tests. Reason: unit uses 4.7 s CPU in 27 s wall time (F2); 9 of 2,262 unit cases take 21.4 s (F3). Rejected: speed through the test audit (F125); it stays a quality ticket.
- **P2** The coverage of every test stays. This ticket changes how tests wait and run, never what they check. A test whose assertion must change to become fast keeps an assertion that is at least as strict (D3).

### Design decisions

- **D1** `--parallel=4` for both `test:unit` and `test:int` in `package.json`, a fixed number, not the CPU count default. Reason: Limen runs 5 to 7 jobs at once on the owner PC (16 cores), each with its own proof run; the CPU default (16) would start 16 workers per job, each with its own DB pool, against one Postgres server (`max_connections` default 100). The CI runner has 4 vCPUs. Rejected: `--parallel` without a number; `--shard` over CI runners (more CI jobs, more setup time; not needed at 56 s).
- **D2** Keep `--isolate` (implied by `--parallel`). Reason: a file must not see the module state of another file (`configureMailHosts`, `configureFeatures`, `setLogFormat` in `apps/server/test/preload.ts` are global). Rejected: `--no-isolate` (faster, but files see leftovers).
- **D3** A production timeout that a unit test waits for becomes a parameter with the current value as its default. Tests pass a short value (50 ms or less). The assertion on elapsed time gets tighter, not looser. Reason: `docs/code-patterns.md` § Tests forbids a longer timeout as a fix; a shorter injected one is the opposite. Example: `auth-mail.test.ts` sets `timeoutMs: 50`, but the outer guard timer adds a fixed 5,000 ms (`OUTER_TIMER_EXTRA_MS`, F4; the design: the SMTP library times out first, the outer timer is the last guard). So the test waits 5,050 ms and can only assert `< 6000`. With an injectable extra (default 5,000) the test runs in about 100 ms and asserts `< 1000`.
- **D4** Scheduler tests: a test that checks what `runJobTick` does (log line, no throw) calls `runJobTick` directly, with no cron. Only the tests that check croner behaviour (overlap protection through `protect`, `stop()`) keep real one-second ticks. Reason: croner `trigger()` runs the job without the `protect` check (F5), so a manual trigger cannot prove the overlap rule. Rejected: a fake cron driver (it tests the fake, not croner).
- **D5** A cross-file shared-state failure in the parallel int run is fixed in the test, never by a retry, a longer timeout or a serial exception list. Preferred fix for a test that counts rows across all organizations (`countSyncTargets`): run its transaction at `REPEATABLE READ`, so rows that other files commit during the test stay out of its snapshot. If a test cannot be fixed in the stage, stop and report it (Rules).
- **D6** CI needs no workflow change: it calls `bun run test:unit` and `bun run test:int`, which carry the flag.

### Edge cases (answered)

- **Several Limen jobs at once:** each job has its own DB (`scripts/limen-prepare.sh`); 4 workers per job, so 5 jobs open at most about 20 pools against one Postgres. Stage 02 checks the pool size per worker and writes the number in the stage notes (N2).
- **GreenMail shared by parallel files:** tests use random addresses (`CLAUDE.md` § Rules, "Shared runtime"). A test that reads a whole mailbox or a fixed address is a shared-state failure (D5).
- **Order dependence that a serial run hides:** the 5-run proof catches most of it. A failure that appears later on `master` follows the quarantine rule (`docs/code-patterns.md` § Tests).
- **`describe.skipIf` in `e2e-seed.test.ts`:** skips without the E2E env, also in parallel. No change (F125 reports it).

## Facts checked

- **F1** Bun 1.4.4 (`.bun-version`, local `bun --version`) has `--parallel=<N>`, `--isolate`, `--no-isolate`, `--shard`, `--timings`, `--changed` (`bun test --help`, 2026-11-14; docs https://bun.com/docs/test/parallel).
- **F2** Serial unit run, owner PC, 2026-11-14 (`bun test <test:unit paths> --reporter=junit`): 2,262 pass, 177 files, 27.3 s wall, 4.7 s user CPU. Same with `--parallel` (16 workers): 2,262 pass, 8.4 s.
- **F3** The 9 slowest unit cases (JUnit, 2026-11-14) sum 21.4 s: `telegram/runtime.test.ts:59` 6.0 s; `platform/auth-mail.test.ts:99` 5.1 s; `platform/scheduler.test.ts` lines 16, 87, 49, 67: 2.8 + 2.0 + 2.0 + 1.0 s; `tools/fake-telegram/src/server.test.ts:73` 1.2 s; `modules/borders.test.ts:22` 0.9 s; `mail/imap/smtp.test.ts:410` 0.5 s.
- **F4** `platform/auth-mail.ts`: `DEFAULT_TIMEOUT_MS = 15_000`, `OUTER_TIMER_EXTRA_MS = 5_000` (lines 11, 13), `deps.timeoutMs` (line 68). `telegram/runtime.ts`: `BOT_USERNAME_TIMEOUT_MS = 3_000` (line 17); the test makes two waits of it (3 s each).
- **F5** croner 11.0.0 (`node_modules/croner/dist/croner.js`): `trigger()` calls `_trigger()` directly; the `protect` check is only in `_checkTrigger`, the scheduled path.
- **F6** Serial int run, owner PC, shared dev DB, 2026-11-14: 1,682 pass, 1 skip, 135 files, 183 s wall, 54 s user CPU. Top 10 files hold 72 % of the time; `imap-contract.test.ts` alone 43.5 s (62 cases). With `--parallel=4`: 56 s, 1 fail: `mail-jobs.test.ts:299` "countSyncTargets counts active mailboxes of organizations that are not suspended" (a global count; other files commit mailboxes during it).
- **F7** CI (`spec/build.md` TRACK, run 43449221495): unit 30 s, int 191 s, ci job 4 m 56 s. The CI runner `ubuntu-latest` has 4 vCPUs (GitHub hosted runner spec).

## Not verified

- **N1** The CI time with `--parallel=4` on 4 vCPUs. Checked by: the first `master` CI run after the stage 02 land (How to run step 5).
- **N2** Peak DB connections in a parallel int run. Known: `testDb()` (`apps/server/test/integration/helpers.ts`) calls `createDb(url)`, pool `max` 10 (`platform/db/index.ts:19`); pools open connections on demand and files close them in `afterAll`. Worst case per job: 4 files × 10 = 40. Unknown: `max_connections` of the shared Postgres server and how many Limen jobs share it. Checked by: stage 02 Step 1 (`SHOW max_connections`, peak of `pg_stat_activity` during a parallel run). If 5 jobs × the peak exceeds `max_connections`, the worker stops and reports (no silent change of the pool size).
- **N3** That 5 green runs mean no order dependence. It lowers the risk; it is no proof. The quarantine rule covers a later failure.

## Done when

1. No unit case is longer than 3 s in a serial JUnit run of `test:unit` (stage 01 Check).
2. `auth-mail.test.ts` asserts the timeout result in under 1,000 ms with an injected outer extra; `runtime.test.ts` `botUsername` cases run in under 500 ms each.
3. `package.json` `test:unit` and `test:int` carry `--parallel=4`.
4. `bun run test:unit:ci` passes, total under 12 s on the owner PC; the log header shows `4x PARALLEL`.
5. `bun run test:int:ci` passes 5 times in a row; each run under 80 s on the owner PC.
6. The first `master` CI run after the land is green; its `test:int` step is shorter than 191 s.

## Rules for every stage

- Change only the files of the stage. Format only those files; never run `bun run format` or `prettier --write .`.
- No retry, no longer test timeout, no `test.skip`, no serial exception list as a fix (`docs/code-patterns.md` § Tests). A test you cannot make pass in parallel within the stage: stop, report the test name, the failure and your analysis in the final message.
- A production default never changes. Only a new optional parameter with the old value as its default (D3).
- An assertion never gets weaker. If you must change one, the new one is at least as strict; name each changed assertion in the final message.
- No `.env` reads, no VPS, no push. `test:e2e` only under `flock /tmp/email-assistant-shared-tests.lock` (not needed here).
- A gap or a deviation is a question in the final message, not a choice.
- While you work, run only the test files you change. The full Proof runs once, after the last commit.

## Proof

Stage 01:
```
mkdir -p /tmp/f124-s01 && bun run lint > /tmp/f124-s01/lint.log 2>&1 && bun run typecheck > /tmp/f124-s01/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f124-s01/unit.log 2>&1 && bun run test:int:ci > /tmp/f124-s01/int.log 2>&1 && echo PROOF_OK
```

Stage 02 (5 int runs):
```
mkdir -p /tmp/f124-s02 && bun run lint > /tmp/f124-s02/lint.log 2>&1 && bun run typecheck > /tmp/f124-s02/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f124-s02/unit.log 2>&1 && bun run test:int:ci > /tmp/f124-s02/int-1.log 2>&1 && bun run test:int:ci > /tmp/f124-s02/int-2.log 2>&1 && bun run test:int:ci > /tmp/f124-s02/int-3.log 2>&1 && bun run test:int:ci > /tmp/f124-s02/int-4.log 2>&1 && bun run test:int:ci > /tmp/f124-s02/int-5.log 2>&1 && echo PROOF_OK
```

Run it after the last commit, with nothing after it.

## Owner checkpoints and owner steps

None.

## Review

Stage 02 gets a review job before the land (board reviewer model): a flaky `master` CI costs every later job. The reviewer runs `bun run test:int:ci` twice at the candidate commit. Stage 01 lands on the worker proof.

## Stages

- [ ] [Stage 01 — Short unit waits (auth mail, Telegram getMe, scheduler)](stages/stage-01-unit-waits.md)
- [ ] [Stage 02 — `--parallel=4` for unit and int, shared-state fixes, 5-run proof](stages/stage-02-parallel-runs.md)

## How to run (coordinator)

1. Move the ticket to `spec/features/active/` and commit before the first spawn. Run `scripts/plan-drift.sh <ticket folder> 54fe78f` first (plan-refresh rule until 21 Nov).
2. Spawn stage 01 (standing models of `spec/build.md` TRACK):
   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "short unit waits · F124" \
     'Implement F124 stage 01. Read spec/features/active/F124-the-unit-and-integration-suites-run-in-parallel-and-no-unit-test-waits-for-a-real-multi-second-timeout/ticket.md, plan.md and stages/stage-01-unit-waits.md; build every step of that stage. Final proof: the Stage 01 command of plan.md § Proof. In the final message, list as proven only what a saved log shows.'
   ```
3. Land stage 01 with `limen land --keep-open`. Then spawn stage 02 the same way (label `parallel test runs · F124`, stage file `stages/stage-02-parallel-runs.md`, the Stage 02 proof). Stage 01 and 02 may also run at the same time: they touch different files, and stage 02 measures with the unit waits as they are.
4. Review stage 02 (§ Review), then land it. Drop each job DB after its land.
5. After the land: `gh run list --branch master --workflow CI --limit 3`. A red run from a parallel failure: quarantine rule the same day, and a note in § Log here.

## Planning progress

- [x] ticket.md
- [x] plan.md
- [x] stages/stage-01-unit-waits.md [written]
- [x] stages/stage-02-parallel-runs.md [written]
- [ ] cold review

## Log

- 2026-11-14: planned in an interactive owner session (Opus 5.5), from the probes in F2–F6.
