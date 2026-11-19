# F124 plan review 1

> Scout job `2026-11-14-f124-plan-review-57a98085`, Opus 5.5 high, base a614e3c, 2026-11-14. Filed whole (its findings message).

Packet: Cold review and pre-mortem of the F124 plan (ticket.md, plan.md, two stages). No questions.md is present.
Base: a614e3c (the main checkout is at the same commit. I ran probes there because the worktree has no node_modules.)
Verified: `bun test --parallel=4 packages/core apps/server/src tools/fake-telegram/src apps/web/src/lib apps/web/src/i18n apps/web/integrations` (main checkout, HEAD) -> `Ran 2339 tests across 183 files. [15.49s]`, banner `bun test v1.4.4 (38afee6c8) 4x PARALLEL`
Unknowns: I did not run the int suite in parallel or the pg connection probe, because both need a DB and `.env`. I could not check the CI times in F7 (unit 30 s, int 191 s): `spec/build.md:13` gives only the run id 43449221495, not the times. I did not measure the unit time after stage 01. Estimate: with the 3 slow files excluded, `--parallel=4` gives `Ran 2305 tests across 180 files. [6.11s]`, so after stage 01 the run is probably under 12 s (guessed).
1. `stages/stage-02-parallel-runs.md:70` and `scripts/limen-prepare.sh:4,38` — **blocking** — observed. The step uses `psql "$DATABASE_URL"`, but a Limen job holds `DATABASE_URL` only in `./.env`, never in the shell. Bun loads `.env` by itself; psql does not. Sourcing `.env` breaks the rule "No `.env` reads" (`plan.md:111`). With an empty URL, psql connects to the default local DB, so the N2 numbers can be wrong and still look like a pass. Fix: query through Bun, which loads `.env` by itself (for example `bun -e` with `createDb(process.env.DATABASE_URL)`), and never print the URL.
2. `plan.md:152` and `ticket.md:9` against `stage-02-parallel-runs.md:96` and `plan.md:101` — **major** — observed. Step 3 lets stage 02 run before or with stage 01 ("measures with the unit waits as they are"). But at HEAD, unit with `--parallel=4` takes 15.49 s, which fails the "under 12 s" check of stage 02. Also, ticket.md:9 credits `--parallel=4` with "27 s to 8 s", but F2 measured 8.4 s with 16 workers. My 16-worker run gave `[9.36s]`. `ticket.md:34` ("in order") also conflicts with `plan.md:152`. Fix: stage 02 builds only after stage 01 lands, and ticket.md:9 cites the correct worker count.
3. `stages/stage-01-unit-waits.md:39,53`, `ticket.md:28` and `plan.md:98` — **major** — observed. Stage 01 keeps the overlap test unchanged, with real ticks, but that test can run longer than 3 s. Over 10 runs with random start times (`-t "overlaps"`) I saw 2037–3015 ms, one run at `[3015.57ms]`. The grep at stage-01:53 matches `time="3.0…"`, so the stage check (and the ticket acceptance) fails at random, a few % of runs (guessed rate). The file limit of "under 4 s" (stage-01:35,44) has the same problem: the overlap test takes 2–3 s, and the stop test with one witness tick starts just after a tick boundary, so it waits about 1 s more. The total is close to 4 s plus load overhead. The worker cannot change the overlap test, so it must stop. Fix: raise the limits to 3.5 s and 5 s, or exclude this one test by name.
4. `plan.md:115-127` and `plan.md:135` — **major** — guessed. Nothing in the plan tests CI's CPU limit. All 5 proof runs and the 2 review runs run on the 16-core owner PC. In CI, 4 workers fill all 4 vCPUs (`ci.yml:15`, `ubuntu-latest`), and 27 int sites spawn processes (`grep -rn spawn` -> 27). Tests that wait with `waitFor` (5 s default) or wait on the pool `connectionTimeoutMillis: 5000` (`platform/db/index.ts:19`) can flake only in CI. N1 finds this only after the land, on `master`, and `spec/build.md:13` shows CI was already red twice today from flaky tests. Fix: run at least one proof or review int run under `taskset -c 0-3`.
5. `stages/stage-01-unit-waits.md:40-41` — **minor** — observed. Cases 2 and 3 move to direct `runJobTick` calls. They then repeat `scheduler.test.ts:158` ("a failed tick resolves and writes one job_failed line"). After the change, no test runs a throwing job through `scheduler.add`, so "the cron keeps going after a throw" is shown only by reasoning. That is a small conflict with P2 (`plan.md:62`, "coverage of every test stays"). The plan should name this as an accepted loss.

Other minor findings (observed, not in the 5-item limit):
- **Minor:** `stage-01:5` says "7 unit cases", but Steps 1–3 cover 6 (auth 1, Telegram 1, scheduler 4).
- **Minor:** `ticket.md:26` writes `4×`, but the real banner is `4x` (`plan.md:101` is correct).
- **Minor:** `plan.md:113` says "run only the test files you change", but stage-02 Steps 1–2 need full parallel int runs.
- **Minor:** stage-02:71 asks for "serial … times", but no step runs a serial int suite.
- **Note:** the test counts drifted from the plan base 54fe78f: unit has 2,339 tests now, the plan says 2,262.
- **Note:** `stage-01:43` with one witness tick has a very small window where a broken `stop()` still passes, because a/b and the witness fire at the same second boundary (guessed).

Facts that held (observed):
- auth-mail.ts:11,13,68,88: the constants and the use of `deps.timeoutMs` are as F4 says.
- runtime.ts:17,99: as the plan says. My probe showed the getMe request arrives in 0.2–1.4 ms, so a 50 ms timeout keeps `requests` at 1.
- F5 (croner `trigger()` skips `protect`) holds in croner.js.
- Kysely 0.29.8 has `setIsolationLevel`, and `ScopedDriver.beginTransaction` passes the settings on (scoped-driver.ts:57).
- `withRollback` appears in 89 files, as the plan says.
- CI calls `bun run test:unit` and `bun run test:int` (ci.yml:51,58), so D6 holds.

Checks: the stage-01 JUnit grep finds cases over 3 s, but it fails at random on the unchanged overlap test. The 5-run int proof finds failures from shared state between files on 16 cores. Nothing tests the 4-vCPU CI load, and nothing measures N2 correctly (item 1).

FAIL (1 blocking, 3 major).

## Note check
- Each finding quotes file:line and has a rating: not proven. The evidence is only this final message, not a saved file or a command that qualifies.
- Facts checked against the code at HEAD a614e3c: not proven. I ran the reads and probes in this session, but they used pipes or `;`. I saved no log file; I deleted the /tmp logs to leave no files.
- The packet ends with PASS or FAIL: not proven. The evidence is only this message ("FAIL"), not a file.
- Easy-to-miss rule (no DB migration, no `.env` reads, no push, no file edits in the worktree): followed for the worktree. Evidence: `test -z "$(git status --porcelain)" && echo WORKTREE_CLEAN` printed `WORKTREE_CLEAN`. I read no `.env`, ran no migration and made no push; no command shows this. I wrote `note.md` because Limen told me to. The temporary /tmp probe logs are deleted.
