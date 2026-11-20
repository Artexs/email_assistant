# Where worker time and CPU go (2026-11-20)

Question (owner): workers are slow and the CPU is at full load for hours. Is the cause the rule of 2026-11-20 00:50 that moved the checks from the coordinator to each worker?

Short answer: partly. The rule did not add many test runs. Three things changed at the same hour, and together they overload the 16-core machine:

1. F124 stage 02 (commits `ea0d5afb`, `6b90a4da`, 00:33–00:40) made `test:int` and `test:unit` run with `--parallel=4`. Each `test:int` run now starts 4 Bun test processes, each with its own database.
2. The coordinator started 12–14 workers at once (00:00Z and 06:00Z today). Earlier days had 2–8.
3. Each code worker now ends with typecheck + lint + unit + "its lane", and many workers take "lane" to mean the full integration suite.

14 jobs × up to 2 suites × 4 test processes ≈ 50–100 Bun processes plus Postgres on 16 cores. Load average now: 24–28.

## Method

Scripts: `/tmp/wtime/scan2.py`, `ran.py`, `sleeps.py`, `bg.py` (not in the repo). They read `.limen/jobs/*/session/*.jsonl` for jobs started 2026-11-17 to 2026-11-20, take the time from each tool call to its result, and read the `Ran N tests across M files. [T]` lines of `bun test`. Unit suite = 531 test files, integration suite = 443. "Before" = jobs started before 2026-11-19 23:51Z, "after" = later. Times are approximate.

## Results

Worker wall time, by kind (interval union, parallel calls count once):

| | Before (215 jobs) | After (76 jobs) |
|---|---|---|
| Average wall time | 113 min | 44 min |
| Model thinking | 75 min (66 %) | 7 min (16 %) |
| `sleep N; cat /tmp/…log` polls (waits for a background test run) | 30 min (27 %) | 34 min (77 %) |
| Foreground lint, typecheck, tests | ~7 min | ~3 min |

Jobs today are shorter (smaller stages), but 77 % of a worker's time is now a wait for its own background checks.

Full suite runs (from `Ran …` lines):

| Suite | Before: runs, median, p90 | After: runs, median, p90 |
|---|---|---|
| Integration (443 files), workers | 275 runs, 91 s, 853 s | 69 runs, 496 s, 841 s |
| Unit (531 files), workers | 58 runs, 108 s, 142 s | 141 runs, 99 s, 173 s |
| Full runs per worker job | int 2.2, unit 1.6 | int 1.5, unit 1.9 |

- The number of full runs per job did not go up. The time per integration run went up about 5× (median 91 s → 496 s). That is CPU contention, not more tests.
- Today 113 background check chains (typecheck + lint + unit, often + int) ran in workers.
- Reviewers also rerun full suites (int median 497 s) instead of reading the worker's retained evidence.
- `eslint .` is type-aware (`parserOptions.project`) and has no `--cache`: 35–300 s per run under load. Workers run it about 5 times per job.
- 2,506 worker tool calls ended at about 120 s: the bash tool limit of the Claude bridge. So workers put long checks in the background and poll with `sleep 119`. Each poll is a model turn (tokens), not CPU.
- The Limen start gate admits a job when CPU idle ≥ 25 %. A worker uses CPU only minutes after start, when its checks run, so the gate admits too many jobs. Reading at 09:41 CET: 22 % idle, gate closed.

## Suggestions (largest gain first)

1. **Cap the parallel test processes per job.** Read `--parallel` from an env var (`EA_TEST_PARALLEL`, default 4) and set it to 1 in Limen jobs (`scripts/limen-prepare.sh` or the job env). CI and a single local run keep 4.
2. **One seat-wide slot pool for full suites.** Wrap full `test:int` / `test:unit` runs in a semaphore of about 3 slots (for example `flock` on `/tmp/ea-suite-slot-{1..3}.lock`). Jobs queue for a slot instead of all competing for CPU at once.
3. **Workers run the tests they touch, the full suites once.** Iterations: only changed test files (`bun test <files>`) and `eslint <changed files>`. The full unit + int run happens once, at the end, after `git merge master`. Fix `.agents/limen/reminders.md`: "lane" means the changed test files, not the whole integration suite.
4. **Lint with a cache.** `eslint --cache --cache-location node_modules/.cache/eslint .` Each worktree keeps its own cache, so the second run is fast.
5. **Fewer workers at once.** About 6 to 8 code workers on 16 cores. Planners, scouts and reviewers that do not run suites can run beside them.
6. **Reviewers reuse evidence.** A reviewer reruns only the tests in the diff, and the full suite only when the worker's evidence is missing or old.

Expected effect: integration runs return to about 90 s, and worker wall time goes down by about half, because the polls wait on shorter runs.

## Follow-up: which check costs most, and can a worker run fewer tests (2026-11-20)

Clean timing, CI run `44703422996` on master (CI machines, no other load):

| Check | Time |
|---|---|
| `lint` | 52 s |
| `typecheck` | 35 s |
| `test:unit` (531 files) | 91 s |
| `test:int` (443 files) | 335 s |
| `test:e2e` (CI only, workers rarely run it) | 935 s |

Serial test time from the F125 audit (`audit/data/timing-summary.md`): unit 98 s, int 1,125 s. The integration suite is 11× the unit suite.

Lint cache, measured in the main checkout on a loaded machine: `eslint --cache .` first run 47.8 s, second run 1.7 s, second run with one changed file 1.9 s. Same result (exit 0) each time. Caveat: the cache re-lints only changed files, so a type change can hide a type-aware lint error in an unchanged file. CI runs without a cache and catches it.

Test selection options, estimated on 18 stage merges of 2026-11-18 to 2026-11-20 (`/tmp/wtime/graph.py`, a static import-graph model, plus `Bun.spawn` path edges):

- `bun test --changed=<ref>` (built into Bun 1.4.4, follows imports transitively): median 86 % of the int time still runs. The cause: tests import modules through `index.ts` files (the layer rule demands it) and `@ea/core` through its index, so one change reaches almost every test. 298 of 965 server and core source files each reach ≥ 300 of 443 int files, even when the `@ea/core` index is excluded. Not worth it.
- Precise selection needs a per-test-file coverage map (run each int file once with `--coverage`, map source file → test files, refresh nightly). Gaps: 45 int files start CLI processes (`Bun.spawn`, 33 % of int time), and coverage does not follow child processes; SQL migrations. Not built; gain unknown.
- Slow lane: the 20 slowest int files are 50 % of int time (10 → 36 %, 50 → 71 %).
- Name rule: 280 of 443 int files start with a module name (`mail-` 46, `channels-` 44, `actions-` 31, …). A worker that changed `modules/mail` runs its own changed test files plus `mail-*.test.ts`.

Recommended worker loop: while working, `eslint --cache`, changed test files and the module's name-matched int files; at the end, after `git merge master`, the full unit suite once and the full int suite once, under a seat-wide slot lock.
