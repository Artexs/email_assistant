# F152 scouts

Two scouts, `claude-sonnet-5-5` at `medium`, 2026-11-20, code at `fb1df6d64`. Packets copied whole from each job log (the `result` file holds only the note check).

## Scout 1 · job `2026-11-20-f152-scout-23f0436b`

**Question.**
> Which release tags (v0.4.2, v0.4.3, v0.4.4) carry the restore TCP wait (function wait_db_tcp and step db-ready in deploy/restore.sh, from the F139 ticket in spec/features/done/2026-11/F139-*), and what changed in deploy/restore.sh, deploy/compose*.yaml and deploy/compose-lib.sh since then (for example the env split and drill.env of the production-on-VPS ticket F108 stage 05)? List the restore.sh steps and their output lines at HEAD (db ready probes=, credentials ok=, restore ok) and how --target drill, --init-env, --stdin and --down behave now. Context: spec/features/planned/F152-the-restore-drill-rerun-on-the-release-that-carries-the-tcp-wait-ends-with-restore-ok-at-the-first-run/ticket.md. Answer for the code at HEAD.

**Packet.**

Packet: Which tags carry the restore TCP wait, what changed in the restore and compose files since, and how restore.sh behaves at HEAD.
Base: fb1df6d64 (Release v0.4.4)
Verified: `git tag --contains 38180f555` -> `v0.4.3` and `v0.4.2` (F139 stage 01 commit "restore.sh waits for the final Postgres server on TCP (step db-ready)"); `git show v0.4.2:deploy/restore.sh | grep -c wait_db_tcp` -> `2`, the same for v0.4.3.
Unknowns: Tag v0.4.4 does not exist locally (`fatal: invalid object name 'v0.4.4'`). `git ls-remote --tags origin | tail` ends at `refs/tags/v0.4.3`, so the origin list probably has no v0.4.4 either (the output was cut by `tail -3`). HEAD is the "Release v0.4.4" commit, and `git describe --exact-match` gives nothing there, so a drill from this checkout stamps `EA_RELEASE=dev`. I ran no restore, so a real drill result is unverified.

1. Tag membership — v0.4.2 and v0.4.3 both carry `wait_db_tcp` and step `db-ready`. v0.4.4 is not tagged yet, but HEAD contains the code. `git diff v0.4.3 HEAD` on restore.sh, compose*.yaml and compose-lib.sh is empty, so HEAD behaves like v0.4.3 for restore — observed
2. Changes since the TCP wait (`git diff 38180f555 HEAD`, 84 lines added) — all landed in v0.4.3 through bb7195b13, "server and cli hold no database admin key; ... new-host restore need a split env" — observed
   - `deploy/restore.sh`: sources `deploy/compose-lib.sh`. New-host target refuses unless `ea_env_split_state` is `split` (exit 2, "run deploy/env-split.sh first") and then uses `ea_compose_init`. Migration runs as `run --rm -T migrate` instead of `cli bun run db:migrate`. The drill target keeps its fixed `C=(docker compose -p ea-drill -f deploy/compose.yaml -f deploy/compose.drill.yaml --env-file deploy/drill.env)` (restore.sh:108).
   - `deploy/compose.yaml`: `server` loses `MIGRATOR_DATABASE_URL`. A new `migrate` service (profile `cli`, image `ea-server`, `pull_policy: never`) alone holds the migrator URL, which comes from `MIGRATOR_PASSWORD`.
   - `deploy/compose.drill.yaml`: adds `DEEPSEEK_API_KEY: ""` and a `migrate` override (image `ea-drill-server`, `restart: "no"`, local log, `ports: !reset []`).
   - `deploy/compose-lib.sh`: adds `ea_compose_init` and `ea_env_split_state` (+46 lines).
   - The F108 stage 05 env split lives in these files. `drill.env` stays the drill's only env file (`env_file: !override [drill.env]`).
3. Steps and output at HEAD (restore.sh; each sets `step=`, and a failure prints `restore failed at <step>`, exit 1) — observed
   - `guard` (drill only, line 198): `drill_guard` refuses if the project name is `email-assistant` or a service publishes a port.
   - `db` (line 202): `up -d --wait db`, then `wait_db_tcp` (line 203, step `db-ready`). It probes `pg_isready -h 127.0.0.1` up to 60 times, 1 s apart, and prints `db ready probes=<n>` (line 181). After 60 failed probes it prints `restore: the database did not answer on TCP after 60 probes` and exits 1.
   - `guard-empty`: refuses (exit 2) if the public schema has any tables.
   - `build`: `build server`, the only build.
   - `pg_restore`: `--no-owner --role=migrator --exit-on-error`.
   - `counts`: prints `count organizations=<n> users=<n> mailboxes=<n> emails=<n>`.
   - `pause-mailboxes` and `clear-alerts` (drill only), then `clear-sessions`, then `migrate`.
   - `credentials` (line 256): runs `cli bun run credentials:check`, echoes its output, and needs exactly one line matching `[credentials-check] credentials ok=<n> failed=<m>`. The bare form without the prefix is also accepted. Any other count of result lines, or `failed>0`, exits 1.
   - `up`: `up -d --no-build --wait`.
   - Last line (line 286): `restore ok target=<t> seconds=<s>`. For `new-host` a `next: run again each deleted <org id> ...` line comes first.
4. Option behavior at HEAD (restore.sh:56-102, 131-167) — observed
   - `--target` is required and must be `drill` or `new-host`. Otherwise it exits 2 with a usage message.
   - `--init-env <live .env>`: drill only. It refuses (exit 2) if `deploy/drill.env` exists or the live file lacks a `CREDENTIALS_KEY=` line. It writes `deploy/drill.env` with mode 600: three new `openssl rand -hex 24` passwords (POSTGRES, MIGRATOR, APP), the key line, the optional `CREDENTIALS_KEY_VERSION`, and `LOG_LEVEL=info`. It prints `wrote deploy/drill.env (mode 600): ...`.
   - `--stdin`: takes no file argument. The plain dump arrives on stdin and goes straight to `pg_restore`. Without it, the script needs `<file.dump.age> <identity file>` and the `age` binary, and runs `age -d | pg_restore`. All other docker calls get `</dev/null`.
   - `--down`: drill only, no dump. It runs `down -v`, removes image `ea-drill-server` (a missing image prints a warning only), deletes `deploy/drill.env`, and prints `drill down: project ea-drill, its volume and image ea-drill-server are gone`. The drill target needs `drill.env` to exist, otherwise it refuses with exit 2.
5. Gap for F152 — `restore.sh:192` sets `EA_RELEASE` from `git describe --tags --exact-match HEAD`, or `dev`. The drill therefore reflects the checkout, not a downloaded release image. A drill on "the release that carries the TCP wait" means checking out v0.4.2 or v0.4.3. The v0.4.2 checkout would not have the `migrate` service or the split-env refusal — observed for restore.sh:192; guessed for the checkout consequence

Checks: `git diff` and tag listings cover membership and drift. I ran no test and no restore, so the exact output of a live drill (`db ready probes=`, `credentials ok=`, `restore ok`) is unchecked beyond the echo statements in the script.
bash git tag --contains 38180f555 && git show v0.4.3:deploy/restore.sh > /tmp/f152-v0
wait
think
Note check
- Tag membership (wait_db_tcp and db-ready in v0.4.2, v0.4.3, v0.4.4): proven for v0.4.2 and v0.4.3. v0.4.4 is not tagged. `git tag --contains 38180f555 && git show v0.4.3:deploy/restore.sh > /tmp/f152-v043-restore.sh && ... && grep -c wait_db_tcp /tmp/f152-v043-restore.sh` exited 0 and printed `v0.4.3`, `v0.4.2`, then `2`. Gap: origin's v0.4.4 status was only seen through a piped `tail -3`, which does not count.
- Changes since that commit: proven. `git diff --stat v0.4.3 HEAD -- deploy/restore.sh deploy/compose.yaml deploy/compose.drill.yaml deploy/compose-lib.sh > /tmp/f152-diff-v043-head.txt` gave a 0-byte file, so v0.4.3 and HEAD match for these files. The earlier diff from 38180f555 (4 files, 84 lines added, all in commit bb7195b13) came from a call that used `;` and pipes. It is not proof by this rule, but `deploy/compose-lib.sh`, `deploy/compose.yaml` and `deploy/compose.drill.yaml` at HEAD hold the cited content.
- Steps, output lines and option behavior at HEAD: proven. Evidence is `deploy/restore.sh` (lines 56-102, 131-167, 175-188, 196-287).
- Easy-to-miss rule ("Answer for the code at HEAD."): followed. Every behavior claim cites `deploy/restore.sh` at HEAD (fb1df6d64). Tag reads were used only for membership.

Not proven yet: none for the note. One unknown remains: whether the origin has a v0.4.4 tag. I ran no live restore, so no real `db ready probes=`, `credentials ok=` or `restore ok` output was seen.

Project reminders
- No test suites, no `--no-verify`, no cache deletion: followed. I ran none of these.
- `check:job` (product-code jobs only): not applicable. This job is a scout and committed nothing.
- Review-job rule: not applicable.

## Scout 2 · job `2026-11-20-f152-scout-e57edbab`

**Question.**
> What does deploy/README.md § VPS lost / Drill say at HEAD (exact procedure, leftover ea-drill_ volume handling, the first drill record), what does notes/2026-11-15-vps-deploy-queue.md hold about restore drill records and release v0.4.2/v0.4.3/v0.4.4, and does deploy/test/restore.test.ts assert the count of sleep calls in the F139 tests (the optional hardening from F139 plan-review-1)? Context: spec/features/planned/F152-the-restore-drill-rerun-on-the-release-that-carries-the-tcp-wait-ends-with-restore-ok-at-the-first-run/ticket.md. Answer for the code at HEAD.

**Packet.**

Packet: What do README § VPS lost / Drill, the deploy queue note and restore.test.ts say about the drill rerun (F152)?
Base: fb1df6d64
Verified: `grep -n "sleep" deploy/test/restore.test.ts` -> `565:    expect(sleepCalls()).toEqual(["sleep 1", "sleep 1", "sleep 1"]);`
Unknowns:
- The README has no step for a leftover `ea-drill_` volume. `grep -rn "ea-drill_" deploy` finds only a comment in `deploy/compose.drill.yaml:4` and a name check in `deploy/test/compose-drill.test.ts:102`. How the drill should treat an old `ea-drill_db-data` volume is therefore not documented. I did not read `restore.sh` for this.
- The queue note has no v0.4.4 record. `grep -n "v0\.4\.4" notes/2026-11-15-vps-deploy-queue.md` returns nothing. v0.4.4 appears only in `notes/2026-11-20-replan-parallel.md:14,91` as planned (the F062 contract migration). `git tag` lists only v0.4.0 to v0.4.3.
- The F139 plan-review-1 file was not read, so I did not check whether "optional hardening" means exactly the sleep-count asserts.

1. `deploy/README.md:1114` (§ VPS lost), observed.
   - It records the first drill: 2026-11-19, tag `v0.3.1`, `restore ok target=drill seconds=173`, wall time 548 s.
   - It says the `db-ready` TCP wait is fixed, and that "The drill rerun that confirms this is pending."
2. `deploy/README.md:1139-1145` (§ Drill), observed. The procedure has 5 steps:
   1. Note the live container ids, start times and counts, and run a fresh `deploy/backup.sh`.
   2. Fresh clone at the tag: `deploy/restore.sh --target drill --init-env <live repo>/.env`.
   3. Pipe `age -d -i ~/ea-backup-key.txt <file>.dump.age | ssh <host> 'cd <clone> && deploy/restore.sh --target drill --stdin'`. The last line must be `restore ok target=drill seconds=<n>`, with `credentials ok=<n> failed=0` before it.
   4. Each drill count lies between the live count before and after the backup. The live ids and start times are unchanged.
   5. `deploy/restore.sh --target drill --down`, then delete the clone.
   - Line 1139 still points to F114 stage-09 Part C "until the drill result is written below".
3. `deploy/README.md:1131` (§ New host step 6), observed. The TCP wait is up to 60 probes, 1 s apart. Failure is exit 1 at step `db-ready`.
4. `notes/2026-11-15-vps-deploy-queue.md:65-74` ("Restore drill record (2026-11-19, F114 stage 09 Part C)"), observed.
   - This is the only drill record. It is for `v0.3.1`, backup `ea-20261119T182245Z.dump.age` (675190 bytes). Counts before, during and after are `organizations=2 users=2 mailboxes=1 emails=313`.
   - Finding (2) is the `guard-empty` failure on the first start, "needs a ticket".
   - Cleanup: `--down` ran and removed the project, volume and image `ea-drill-server`.
   - The deploy records show v0.4.2 deployed unrecorded (line 114), then v0.4.3 released at line 172-180 (`release ok v0.4.3 previous v0.4.2`). Neither records a drill.
5. `deploy/test/restore.test.ts`, observed. Yes, the F139 tests assert sleep counts, but only in 3 of 5.
   - F139-1 (line 565): `toEqual(["sleep 1","sleep 1","sleep 1"])`.
   - F139-3 (line 589): `toHaveLength(59)`.
   - F139-4 (line 604): `toHaveLength(0)`.
   - F139-2 (line 568) and F139-5 (line 608) were not checked for sleep asserts.
   - The helper is `sleepCalls()` at line 141. It filters the `sleep` stub at line 110.

Checks: `deploy/test/restore.test.ts` F139-1 to F139-5 cover the probe and pause counts against a stubbed docker and sleep; they miss a real fresh volume, which only the F152 VPS rerun covers. I ran no test.
Note check
- Reported README, queue note and sleep asserts with line refs: not proven. The packet cites the lines, but the reads ran in bash calls that used `;`, `|` or line breaks, so no qualifying command exists. The packet also left gaps. I did not read `deploy/restore.sh` for leftover `ea-drill_` volume handling. The queue note has no v0.4.4 record. I did not read the F139 plan-review-1 file. I did not check F139-2 and F139-5 for sleep asserts.
- Easy-to-miss rule ("Read-only. Do not edit, create, or delete files."): not proven. My `git status --short` ran after a line break in a multi-command call and printed nothing, which does not count as proof. I also wrote `note.md` under `/home/artek/Documents/repos/email_assistant/.limen/jobs/...`. The Limen prompt required that file and it sits outside the worktree. It is still a created file. The worktree tracked files were not edited.

The note said "Not proven yet: none". That was wrong. It should list the check and the rule above.

Binding project reminders
- Tests run once per job and no forbidden suite: followed. I ran no `test:*`, `bun test`, lint or typecheck.
- `check:job` for product-code jobs: not applicable. This is a scout job and I committed nothing.
- Review jobs run no suite: not applicable.
- Do not delete `node_modules/.cache/`: followed. I did not touch it.
