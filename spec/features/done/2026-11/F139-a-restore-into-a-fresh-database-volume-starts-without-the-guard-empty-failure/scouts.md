# F139 scouts

Two scouts, started 2026-11-19 at base 334ce691. Packets copied whole from each job log.

## Scout 1

Question: How does deploy/restore.sh wait for Postgres before step guard-empty (commands, retries, timeouts, how it runs psql), and how does deploy/test/backup.test.ts stub docker/psql commands (PATH stubs, fixtures, fail N times then succeed)?

Job: 2026-11-19-f139-scout-1-bf2927e6

Packet: How restore.sh waits for Postgres before guard-empty, and how deploy/test/*.test.ts stub docker
Base: 334ce691
Verified: `grep -n "pg_isready\|up -d\|--wait" deploy/restore.sh deploy/*.sh` -> `deploy/restore.sh:178:  "${C[@]}" up -d --wait db </dev/null`
Unknowns: none. I did not run the tests. I read the code only.

1. `deploy/restore.sh:177-178` (step `db`) — The only wait is one call: `"${C[@]}" up -d --wait db </dev/null`. There is no retry loop, no sleep and no timeout in the script. `--wait` blocks on the compose healthcheck of `db`. That check is `pg_isready -U postgres -d email_assistant`, with `interval: 2s` and `retries: 15` (`deploy/compose.yaml:31-34`). The Postgres init temporary server passes `pg_isready`. This is the F139 race. — observed
2. `deploy/restore.sh:162-164,181-184` (step `guard-empty`) — This step runs right after step `db`. `psql_db` runs `"${C[@]}" exec -T db psql -U postgres -d email_assistant -v ON_ERROR_STOP=1 -At "$@" </dev/null`. It uses `docker compose exec -T` into the running `db` service, not `run`. The user is `postgres`. The DB is `email_assistant`. The query is `select count(*) from pg_tables where schemaname = 'public'`. If the output is not `^[0-9]+$`, the script prints `restore: could not read the table count` and runs `exit 1` with the step still set to `guard-empty`. `on_exit` then prints `restore failed at guard-empty` and exits 1. A count above 0 means `refuse` (exit 2). `${C[@]}` is the drill compose line (`-p ea-drill -f deploy/compose.yaml -f deploy/compose.drill.yaml --env-file deploy/drill.env`) or the new-host line (`-f deploy/compose.yaml --env-file .env`) (`restore.sh:103-111`). — observed
3. `deploy/test/restore.test.ts:78-100` — This is the test file for restore.sh. A single bash `docker` stub is written to `stubs/` and put first on `PATH`. `run()` is at line 103. The stub logs one line per call to `calls.log` (args, stdin byte count, `COMPOSE_PROJECT_NAME`, `EA_RELEASE`). It branches on `$*` substrings. The `pg_tables` branch (line 92) prints `cat "$S/tables"` or `0`, then exits 0. Other branches cover `config`, `from organizations` and `credentials:check`. File-based switches in `stubs/` control the stub: `tables`, `docker-fail` (a substring of the args that makes it exit 1), `config-json`, `counts`, `creds-*`. `age` and `openssl` are also stubbed. The stub helper is `stub(name, body)` (line 51). `setSwitch(name, content)` is at line 58. Helpers are `calls()`, `dockerCalls()` and `indexOfCall()`. No stub there fails N times and then succeeds. The `up --wait` call always returns 0. — observed
4. `deploy/test/backup.test.ts:34-62` — This file holds the fail-N-then-succeed pattern, for `backup.sh`. The `rclone` stub appends a line to `${root}/rclone.calls` on each call. It computes `calls=$(wc -l <file)`. It exits 1 with a stderr message when `calls <= ${STUB_RCLONE_FAIL_FIRST:-0}`, else exits 0. The test passes `STUB_RCLONE_FAIL_FIRST: "2"` through `run({ env })`. Test 6 asserts the call count equals 3. The always-fail switch is `STUB_RCLONE_FAIL`. `curl` uses `STUB_CURL_FAIL`. The `docker` stub there is minimal: `printf 'PGDMPfake-dump-body'`. Test 10 rewrites it with `sleep "${STUB_DOCKER_SLEEP:-0}"`. The test copies the script into a `mkdtempSync` temp root, and `run()` spawns `bash` with `cwd: root` and `PATH=${stubs}:$PATH`. — observed
5. `deploy/restore-test.sh:29-33` — This different script has its own `pg_isready` poll loop: `docker exec "$container" pg_isready -q -h 127.0.0.1 ...; sleep 1`. It is not part of restore.sh. — observed

Checks: `deploy/test/restore.test.ts` covers the call order, the stdin handling and the guard-empty refusals (exit 2 on `tables`>0). It misses a db that is ready, then "shutting down", then ready again, because the stub has no per-call counter for `pg_tables` or `up`. A counter-file stub like `rclone` in `backup.test.ts` would fit. `backup.test.ts` covers retry counts and the exponential wait for `backup.sh` only.
[limen 2026-11-19T22:03:25.703Z] note check sent
bash test -z "$(git status --short)" && git diff --quiet HEAD
wait

## Scout 2

Question: Which Postgres image and version does the deploy compose use, and how does its init work for a fresh volume? Which other tickets edit deploy/restore.sh or deploy/README.md, and what does the drill record say?

Job: 2026-11-19-f139-scout-2-fdaa5c65

Packet: Which Postgres image and entrypoint init does the deploy compose use, which tickets touch `deploy/restore.sh` and `deploy/README.md`, and what do the drill records say?
Base: 334ce691
Verified: `docker run --rm postgres:17 postgres --version` -> `postgres (PostgreSQL) 17.11 (Debian 17.11-1.pgdg13+2)`
Unknowns: Whether the final server listens on TCP the instant the init-complete line appears. I read the entrypoint source, not a live log. The image's internal PID layout during init was not run (guessed from source, see item 2).

1. `deploy/compose.yaml:18` — the `db` service uses `postgres:17`. The health check is `pg_isready -U postgres -d email_assistant`, interval 2s, retries 15. It has no `-h`, so it connects over the unix socket. `compose.sim.yaml:26` also uses `postgres:17`. — observed
2. Entrypoint init (`/usr/local/bin/docker-entrypoint.sh` in the local image). `docker_temp_server_start` (line 297) starts a temporary server with `-c listen_addresses='' -p ${PGPORT:-5432}`. It listens on the unix socket only, with no TCP. The entrypoint prints `PostgreSQL init process complete; ready for start up.` (line 370) after `docker_temp_server_stop`. It then runs `exec "$@"` (line 384), which starts the final server as PID 1. During init, PID 1 is the entrypoint script and the temporary server is its child (guessed from the `exec` at line 384). — observed (lines), guessed (PID layout)
   - Signals that init ended: the log line above, or a TCP probe such as `pg_isready -h 127.0.0.1`.
   - `deploy/restore-test.sh:26-33` already does the TCP probe, with the comment "The image's init server listens on the socket only, so wait for TCP".
   - `restore.sh:178` uses `up -d --wait db` and trusts the socket health check, then runs `guard-empty` at line 181. This is the race.
3. Other `restore.sh`/`README.md` editors.
   - F108 (active, production on the VPS):
     - Stage 01: `stage-01-migrate-service.md:3` says it shares `restore.sh` with F139. On a land conflict, merge master, keep both, re-prove. Step 10 changes the `migrate` step of `restore.sh`.
     - Stage 03: rewrites `README.md` sections and keeps the first drill record; "F139 owns its `guard-empty` line".
     - Stage 05: edits `restore.sh` for `new-host` only. Acceptance 10: "The F139 test of the readiness wait (`deploy/test/restore.test.ts` or its own file) passes unchanged".
     - Stages 04, 06 and 07 also mention the files. Stage 07 item 10 cites the drill in `docs/capabilities/backups.md`.
   - Other active or planned tickets that match the grep but did not read as editors in my search: F115 (stages 17/18), F138 (stage 03), F062, F121. I did not open them; they may only mention the path. — guessed
4. Drill record, `notes/2026-11-15-vps-deploy-queue.md:65-74` (2026-11-19, tag `v0.3.1`). — observed
   - `restore ok target=drill seconds=173`, wall time 548 s with two failed starts.
   - Counts before, drill and after: `organizations=2 users=2 mailboxes=1 emails=313`.
   - Finding (2): "First start on a fresh volume fails at `guard-empty` (db healthy during image init); rerun works; needs a ticket."
5. `docs/known-alerts.md:47-52` (§ restore drill): — observed
   - Cause: on a fresh volume the first run fails with `FATAL: the database system is shutting down`.
   - The Fix line says "run the same `restore.sh` command again" and "A ticket for the guard-empty race is open with the coordinator". F139 must replace this line.
   - `deploy/README.md:1054` repeats it as a "Known fault … Run the same command again".

Checks: `deploy/test/backup.test.ts` is the stub-`docker` pattern the F139 ticket names. I did not run it. No existing check covers the readiness wait.
[limen 2026-11-19T22:03:38.106Z] note check sent

## Planner check

Scout 2 item 2 (entrypoint) was not proven by the scout. The planner read the entrypoint and postgresql.conf.sample itself (plan.md § Facts checked).
