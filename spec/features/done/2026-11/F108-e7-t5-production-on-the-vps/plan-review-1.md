# F108 plan review 1

Job `2026-11-18-f108-plan-review-9c30a839` (claude-opus-5-5, thinking high), candidate aae3f966. Final message, filed whole:

FAIL aae3f9665892e396b20d794df52f898c7d0160a6

I reviewed the F108 plan at HEAD aae3f966; `git rev-parse HEAD` matches the candidate. Two findings block the plan: release N cannot be made in the way the plan says, and acceptance bullet 1 cannot be reached on a host that was set up by the runbook. A copy of the findings is in `.limen/jobs/2026-11-18-f108-plan-review-9c30a839/review-findings.md`.

## Blocking

**B1 — Release N cannot be built in the order the plan gives (expand/contract). Proven by reading the code.**
- `plan.md:87` says: "a tag on the land commit of stage 02 is fine, also after 03 lands". The code refuses this:
  - `deploy/release.sh:47-48` refuses a tag when the `package.json` version at that tag is not the tag.
  - `docs/release-checklist.md:14-19` makes every release a `release:prepare` commit on `master`. Line 21 says that `release:prepare` refuses a version that is not greater than the current one.
- So the release-N commit must be on `master` after stage 02 lands and before stage 03 lands. The plan does not put it there:
  - `plan.md:88` says "Stage 04 after stage 03 lands".
  - `stage-04:3,18` makes release N "by `docs/release-checklist.md`" at that later time. That commit then holds stage 03.
- Pre-mortem: the v0.2.x `release.sh` runs that release. It keeps its in-memory `main` (`release.sh:34,98,134`) and runs `cli bun run db:migrate`, but the stage 03 `cli` has no `MIGRATOR_DATABASE_URL` from Compose. The migrate step then fails after the `pending` mark, or it uses the dev URL that `.env` holds (see B2). That is a failed release.
- Missing decision: the coordinator makes and tags the release-N commit (and best also deploys it) between the land of stage 02 and the spawn of stage 03. `plan.md:86-88` and stage 04 Part A must say this.

**B2 — `MIGRATOR_DATABASE_URL` in `.env` reaches the server after the contract; no rule removes it. Proven by reproduction. The content of the VPS `.env` is unverified.**
- How the key gets there:
  - `.env.example:171` holds `MIGRATOR_DATABASE_URL=postgres://migrator:change-me-migrator@127.0.0.1:5433/...`.
  - The runbook makes `.env` by `cp .env.example .env` (`deploy/README.md:21-22`, new host `:896`).
  - `deploy/README.md:31` tells the operator to leave these keys there: "Their values in `.env` do not count for `server`".
- Stage 03 removes the key from `server.environment` (`compose.yaml:50`). The server then gets the key through `env_file: ../.env` (`compose.yaml:46`).
- Reproduction: I removed line 50 from a temp copy of `compose.yaml` and used an `.env` with that line. `docker compose ... --env-file deploy/db.env config --format json` shows `server.environment.MIGRATOR_DATABASE_URL = postgres://migrator:change-me-migrator@127.0.0.1:5433/...`.
- No rule covers this key:
  - The split tool moves only the three password lines (D6, `interfaces.md:10,42`).
  - `ea_env_split_state` looks only at the password keys (`interfaces.md:19`), so the guard says `split`.
  - V3 reads only the three password names (`plan.md:41`, `stage-04:23`).
  - Stage 03 test 1 uses an `.env` "without D5 keys" (`stage-03:20`), so the test never has this case.
- Result: acceptance bullet 1 (`ticket.md:28`, "no migrator URL") fails at `stage-04:30`. Also, every new host made by the runbook fails the check in its release verify after stage 03.
- Missing decision: the split tool must also handle `MIGRATOR_DATABASE_URL` (and maybe `DATABASE_URL`) in `.env`, and the state check must see it. Add a test with an `.env.example`-shaped fixture.

## Unverified

- The key names in the VPS `.env`, `backup.env` `COMPOSE` and the VPS crontab. These need the VPS, which stage 04 reads.
- I ran no JS suite. The candidate changes only plan files, so a suite would not discriminate.

## Notes

**N1 — Conflict in stage 03 test 2. Proven by reproduction.**
- `stage-03:21` says "no sentinel value appears in any service except `db` and `migrate`". But `server.environment.DATABASE_URL` holds the `APP_PASSWORD` value by design (`compose.yaml:49`, D5 `plan.md:23`, `questions.md:6`).
- The same reproduction printed `DATABASE_URL: postgres://app:sentinel-a@db...`.
- The test as written cannot pass. A worker must guess which sentinel to leave out.

**N2 — Stage 01 breaks `check-logging.sh` in drill mode; the plan has no rule for it. Proven by reproduction.**
- `deploy/check-logging.sh:51-52` refuses every drill-set service except `db`, `server` and `cli` when its profile includes `cli`.
- I added the `interfaces.md:24-35` `migrate` block to a temp `compose.yaml` and ran `bash deploy/check-logging.sh --drill deploy/compose.yaml deploy/compose.drill.yaml`. Result: `check-logging: the drill must not run migrate`, rc=1.
- `apps/server/src/deploy-logging.test.ts:112-113` runs that check on the real files.
- Stage 01 lists `check-logging.sh` in neither Files nor Carry-over (`stage-01:7,28`). The worker must decide whether to allow `migrate` in the drill set. Also, `compose-drill.test.ts:43-48` `serverImageServices()` finds only services that extend `server`, so `migrate` is not in it.

**N3 — The N→N+1 change has no guard and no automatic check; other tickets' releases can cross it. Proven mechanism, plausible trigger.**
- N+1 is run by N's in-memory script (`stage-04:29`), and N has neither the D8 guard nor the D7 check, because both land in stage 03. So the guard never protects the one change that needs it.
- Between the land of stage 03 and Part C, other active tickets release from `master`: F107 `stage-07-vps.md`, F104 `stage-13-pilot-deploy.md`, F102 `stage-20`. If they release an unsplit host at N, the contract deploys with "release ok", and the server keeps the passwords through `.env`.
- Missing rule: no VPS release from the land of stage 03 until Part C ends. Or: the split runs right after N, before stage 03 lands.

**N4 — Other cron lines and one-off commands still use the old env file. Proven by grep.**
- After the split, `--env-file .env` fails hard. Reproduced: `required variable APP_PASSWORD is missing a value`.
- Still on the old file:
  - The cron line at `deploy/README.md:813` (`mailbox:seed`).
  - The `C=` lines in active stage files: F029 `stage-05:11`, F102 `stage-20:14`, F104 `stage-13:15`, F107 `stage-07:14`, F118 `checkpoint-a:25`.
- Stage 02 changes only the README `C=` line and the `db:migrate` lines (`stage-02:45`). `stage-04:35` prints only the backup cron line.
- Missing: stage 04 lists every crontab line that calls Compose. The seam section of `interfaces.md` tells the other tickets about the new `C=` line.

**N5 — The new-host runbook is not updated. Plausible; the doc gap is proven.**
- `deploy/README.md:896-900` (§ VPS lost, step 3) puts the three passwords in `.env`. Stage 02 and stage 03 docs do not list § VPS lost (`stage-02:43-45`, `stage-03:42`).
- After stage 03, `restore.sh --target new-host` refuses with `state old` in the middle of a disaster.

**N6 — The rollback rules across the split are incomplete. Plausible.**
- In the window between Part B and Part C, a rollback from N goes to v0.2.x. N's `rollback.sh` works there because the helper uses `db.env`.
- But the v0.2.x checkout's cron `backup.sh` (`backup.sh:108`) and its `release.sh` then fail on `:?` every night until `--undo` runs.
- `stage-04:14,29-31` names only a rollback to N, so the `--undo` step is not named for that window.
- `rollback.sh` swaps `current` and `previous` (`README.md:62`). From N+1, a rollback goes to N and never "below N". Say exactly when `--undo` applies: at N, or after a pending N+1 that is rolled back to N while `previous` is still v0.2.x.

**N7 — A half-done split has no recovery. Plausible.**
- `stage-02:15` writes `db.env` before `.env`. If the second `mv` fails, the state is `mixed`.
- In `mixed`, the split tool refuses (`interfaces.md:44`), `--undo` refuses (`:45`), and the stage 03 guard refuses `rollback.sh`.
- Test 8 (`stage-02:25`) does not say if `db.env` must be removed. A worker must guess.

**N8 — The drill cited in stage 05 runs the old code. Proven by reading.**
- `F114 stage-09:29` runs the drill at `checkout --detach v0.1.0`, so it runs the old `restore.sh` (`cli` migrate, the old `--env-file .env`).
- P5 (`plan.md:15`) and `stage-05:30` cite that drill as the F108 restore proof. But the new `migrate` and helper path in `restore.sh` has only stub and config tests.
- Missing decision: the tag of the drill, at N+1 or later, and the `migrate` service in its V2 config check.

**N9 — The deletion rule for `.env.bak-*` files is weaker than "no lost key". Plausible.**
- D12 and Q6 (`plan.md:30`, `questions.md:10`) delete a copy when its key names are a subset of the live files. A copy with an older value that someone still needs then goes.
- A comparison by line (`grep -Fxvf`, nothing printed) or by value hash proves "no lost value" and prints no secret.

**N10 — "Back up" in the § Env split runbook is ambiguous. Plausible.**
- `stage-02:45` says "(back up, `env-split.sh`, …)". The README already teaches `cp -p .env .env.bak-*` (`README.md:220`), which D30 forbids. Name the DB backup (`deploy/backup.sh`).

**N11 — Small points where a worker or the coordinator must guess.**
- `backup.sh` must take "only the file arguments" (`stage-01:15`), but the helper exposes only the whole `EA_COMPOSE` array (`interfaces.md:17`).
- Stage 04 step 11 uses "the PC", but the B2 read key is on the Mac (`README.md:872`, `notes/2026-11-03-pilot-vps.md:26`). So the default O1 is the likely path.
- Stage 04 step 13 does not search `deploy/`.

**N12 — Stage size. Plausible.**
- Stage 01 changes 8 deploy files plus `check-logging.sh` (N2) and has 11 tests. It can split into 1.1 (helper) and 1.2 (`migrate`).
- Stage 02 mixes two scripts with tests, the ADR and the full runbook. The ADR and docs could be their own stage.

**N13 — D7 and the check in practice. Proven by reading.**
- The first release whose verify runs `check-server-env.sh` is N+2, because N's script runs N+1. Stage 04 step 7 checks by hand, and that is correct. `plan.md:25` should say it.

**N14 — Facts confirmed.**
- `compose.yaml` interpolates only the three passwords and `EA_RELEASE`.
- No runtime code reads the D5 keys; only the `db-worktree` and `e2e-*` scripts do.
- `restore.sh:103-111,228,233` match `plan.md:37`.

## Checks run

- `git rev-parse HEAD` → `aae3f9665892e396b20d794df52f898c7d0160a6`.
- Compose reproduction in a temp dir, on Compose 5.6.1, with line 50 of `compose.yaml` removed:
  - `docker compose ... --env-file deploy/db.env config --format json` → the server env holds `MIGRATOR_DATABASE_URL` from `.env`, and `DATABASE_URL` holds the `APP_PASSWORD` sentinel.
  - `--env-file .env config --quiet` → `required variable APP_PASSWORD is missing a value`.
- `check-logging.sh --drill` with the `migrate` block from `interfaces.md` in a temp copy → `the drill must not run migrate`, rc=1.
- Greps for `--env-file .env` and `MIGRATOR_DATABASE_URL`.

## Note check

- HEAD is the candidate aae3f966: proven. `git rev-parse HEAD` (a single command, exit 0) → aae3f9665892e396b20d794df52f898c7d0160a6.
- Each finding quotes file:line, with a label: proven. `.limen/jobs/2026-11-18-f108-plan-review-9c30a839/review-findings.md` (B1–B2, N1–N14, each with file:line and a label).
- Each of the five focus areas has a verdict: proven. `.limen/jobs/2026-11-18-f108-plan-review-9c30a839/review-findings.md`:
  - Release order: B1, N3.
  - Rollback across the split: N6, N7.
  - Cron and the old env file: N4, N6.
  - Drill: N2, N8.
  - Stage size: N12.
- Easy-to-miss rule (no finding asks only for code detail): followed. `.limen/jobs/2026-11-18-f108-plan-review-9c30a839/review-findings.md`: each finding names a missing decision, a conflict, an edge case or a missing test.
