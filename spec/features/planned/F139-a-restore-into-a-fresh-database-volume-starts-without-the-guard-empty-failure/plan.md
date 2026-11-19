# F139 plan — restore waits for the final Postgres server

> **Status 2026-11-19 — planned.** Plan base: 334ce691. Two stages: 01 worker (script, stub test, docs), 02 coordinator VPS drill rerun.

## Input

Owner task (coordinator, 2026-11-20), word for word: "Decide the wait (two successful real queries with a pause, or a wait for the init to end) and record the rejected option. One worker stage with a stub test; one coordinator VPS stage: a drill rerun on the release that carries the fix (ea-drill project, not the live stack). Sequenced: before F108 stage 05 (both edit deploy/restore.sh)."

Ticket acceptance: the stub test fails on the old script and passes on the new one; one drill rerun ends `restore ok` at the first run; the rerun is a record, not a block.

### Decisions

- **D1 — The wait signal is TCP readiness inside the container.** After `up -d --wait db`, `restore.sh` polls `pg_isready -q -h 127.0.0.1 -U postgres -d email_assistant` through `"${C[@]}" exec -T db … </dev/null` until it exits 0. Reason: the image's init server starts with `listen_addresses=''` (socket only); the final server listens on `*`. So a TCP answer is proof that the init ended, on every volume state. `deploy/restore-test.sh` already uses this probe. Rejected: (a) two real queries with a pause: a timing guess; both queries can hit the init server while `db-init/roles.sh` runs, and the pause adds time on every run. (b) A wait for the log line `PostgreSQL init process complete`: the line comes only on a fresh volume, the `local` log driver and the image version can change it, and the final server is not ready at that line yet.
- **D2 — Bound: 60 probes, `sleep 1` between them, about 60 s.** The same bound as `restore-test.sh`. A probe that exits non-zero for any reason (no answer, the container restarts, `exec` fails) counts as "not ready". After the last failed probe the script exits 1 at step `db-ready` with the stderr line `restore: the database did not answer on TCP in 60 s`. No `pg_tables` query, no build, no `pg_restore` follows.
- **D3 — The Compose health check stays as it is (default, owner to confirm).** Reason: a changed `healthcheck` recreates the live `db` container at the next release (a short DB restart), F108 stage 01 says no Compose change runs next to it, and the stub test cannot prove a health check. Rejected: `pg_isready -h 127.0.0.1` in `deploy/compose.yaml` (it fixes every `up --wait db` at once, but with the costs above). `deploy/README.md` § First install step 4 gets the same TCP wait as a runbook command, because step 5 (`db:migrate` over TCP) has the same race on a fresh volume.
- **D4 — Step name and output.** The wait is its own step `db-ready`, between step `db` and step `guard-empty`, so the failure line reads `restore failed at db-ready`. On success the script prints one stdout line `db ready probes=<n>` (`n` = count of probes, 1 when the server was ready at once). The drill record uses it to show that the init phase was seen.
- **D5 — The wait is one shell function `wait_db_tcp` in `deploy/restore.sh`**, called once in `restore()` for both targets (drill and new-host). The production-on-VPS ticket (F108, stages 01 and 05) keeps the call and its place: after `up -d --wait db`, before `guard-empty` (its `interfaces.md`).
- **D6 — Tests stub `sleep`.** The test puts a recording `sleep` stub first on `PATH`, so no test waits a real second (styleguide: no fixed sleep over 100 ms in a test). The script has no env knob for the pause.
- **D7 — The drill rerun is a record (owner rule 2026-11-20).** Stage 02 runs when a release carries stage 01 (the board names v0.4.2). If no such release exists when stage 01 lands, the coordinator files a follow-up ticket for the rerun and closes F139.

### Edge cases (answers)

- Fresh volume: probes fail while the init runs, then pass → normal run (test 1).
- Volume that holds data (a second drill without `--down`): the probe passes at once, `guard-empty` refuses with exit 2 as today (test 4).
- Server never answers: exit 1 at `db-ready` after 60 probes (test 3).
- Stdin: every new `docker` call gets `</dev/null`; only `pg_restore` reads the dump (existing test 7 must still hold).
- Secrets: the probe prints nothing; the script never prints the `pg_isready` output.

## Facts checked (2026-11-19)

- `postgres:17` (local image, 17.11) `docker-entrypoint.sh` line 297: temp server `-c listen_addresses=''`; line 370: `PostgreSQL init process complete; ready for start up.`; line 384: `exec "$@"`. `postgresql.conf.sample`: `listen_addresses = '*'`. Read with `docker run --entrypoint sh postgres:17`.
- `deploy/compose.yaml` health check: `pg_isready -U postgres -d email_assistant` (socket), interval 2 s, retries 15. `compose.drill.yaml` does not override it.
- `deploy/restore.sh` at HEAD: `up -d --wait db` then `guard-empty` runs `psql_db` (socket, `exec -T db`); no retry.
- F108 stage 05 acceptance 10 and F108 `interfaces.md`: F139 lands before F108 stage 05; the F139 test passes there unchanged.

## Not verified

- The exact time the final server needs after the init on the VPS. Stage 02 records `db ready probes=<n>`.

## Done when

- Ticket § Acceptance (2 items).
- `deploy/test/restore.test.ts` holds tests 1–5 of stage 01.

## Rules for every stage

- A gap or a deviation from a decision is a question in the final message, not a choice.
- Format only the files of the stage. Do not touch `deploy/compose*.yaml` (D3).
- No secret, password or dump byte in a log, an output line or a record.

## Proof

`mkdir -p /tmp/f139-s01 && bun run lint > /tmp/f139-s01/lint.log 2>&1 && bun run typecheck > /tmp/f139-s01/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f139-s01/unit.log 2>&1 && echo PROOF_OK`

No `test:int:ci`: the stage changes no server code (`test:unit` holds `deploy/test`).

## User checkpoints and steps

None. Stage 02 is pre-approved for the coordinator (ticket § Acceptance).

## Review

Stage 01: one review job before the land, `claude-opus-5-5` (deploy and VPS restore path, `spec/build.md` standing models). Stage 02: no review.

## Stages

- [ ] [stage 01 — TCP readiness wait in restore.sh, stub test, docs](stages/stage-01-tcp-wait.md) (worker)
- [ ] [stage 02 — drill rerun on the VPS](stages/stage-02-vps-drill-rerun.md) (coordinator, VPS)

## How to run (coordinator)

Stage 01:

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "restore TCP wait · F139" \
  'Implement F139 stage 01. Read spec/features/active/F139-a-restore-into-a-fresh-database-volume-starts-without-the-guard-empty-failure/ticket.md, plan.md and stages/stage-01-tcp-wait.md; build every step of that stage. Final proof: <the Proof command>. In the final message, list as proven only what a saved log shows.'
```

Land stage 01 with `--keep-open`, then F108 stage 05 may start. Stage 02: the coordinator runs it on the VPS when a release carries stage 01 (D7). Drop the job DB after the land.

## Planning progress

- Scouts: 2 (`scouts.md`).
- [written] plan.md, stages/stage-01-tcp-wait.md, stages/stage-02-vps-drill-rerun.md, questions.md.
- Word counts (`wc -w`, before the review): plan.md 1172, stage-01 683, stage-02 439.

## Cold review

Pending.

## Log

- 2026-11-19: plan written at 334ce691.
