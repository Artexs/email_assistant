# F139 stage 01 — TCP readiness wait in restore.sh, stub test, docs

Needs: no earlier stage. A worker job. Shares `deploy/restore.sh` with the production-on-VPS ticket (F108 stage 01 changes its `migrate` step): on a land conflict, merge master, keep both, re-prove. Writes `wait_db_tcp` and step `db-ready`, which F108 stage 05 keeps.

Part of [`../plan.md`](../plan.md). Not `[risky]`.

## Step 1 — the wait in `deploy/restore.sh`

**Interfaces.** New function `wait_db_tcp` (no arguments; uses `C`). It sets `step=db-ready`, probes up to 60 times with `"${C[@]}" exec -T db pg_isready -q -h 127.0.0.1 -U postgres -d email_assistant </dev/null`, runs `sleep 1` between two probes (never after the last one, never before the first), prints `db ready probes=<n>` on success, and on failure prints `restore: the database did not answer on TCP in 60 s` to stderr and exits 1. `restore()` calls it once, right after `up -d --wait db` and before `step=guard-empty`, for both targets.

**Decisions.** D1, D2, D4, D5. Keep the rule "only `pg_restore` reads stdin".

**Out of scope.** `deploy/compose*.yaml` (D3), other deploy scripts, the `migrate` step.

## Step 2 — stub test in `deploy/test/restore.test.ts`

**Stub model.** Extend the existing `docker` stub (switch files in `stubs/`, the counter pattern of the `rclone` stub in `deploy/test/backup.test.ts`):

- Switch `init-probes` = N (default `0`). A call with `pg_isready` and `-h 127.0.0.1` appends to a counter file; while the count ≤ N it exits 2; after that it writes `ready` to a phase file and exits 0.
- While the phase is not `ready` and N > 0: the `pg_tables` query prints `psql: error: … FATAL:  the database system is shutting down` to stderr and exits 2; a `pg_isready` call without `-h` exits 0 (the init server answers on the socket).
- Switch `never-ready`: every TCP probe exits 2.
- A recording `sleep` stub on `PATH` appends one line per call and returns at once (D6).

With N = 0 the existing tests pass; only call lists gain the probe.

**Tests** (numbered as in the file's style):

1. Drill from stdin, `init-probes` = 3: exit 0; stdout holds `db ready probes=4` and `restore ok target=drill`; 4 probe calls, all after the `up -d --wait db` call and before the first `pg_tables` call; 3 `sleep` calls; no line `restore failed at`.
2. Same as 1 with `--target new-host`: exit 0, 4 probe calls before `pg_tables`.
3. `never-ready`: exit 1; stderr holds `restore: the database did not answer on TCP in 60 s` and `restore failed at db-ready`; 60 probe calls; 59 `sleep` calls; no `pg_tables`, no `build server`, no `pg_restore` call.
4. `init-probes` = 0 and `tables` = 1 (drill): 1 probe call, 0 `sleep` calls, exit 2 at `guard-empty` as today, no `pg_restore`.
5. Every probe call reads no stdin (`stdin=0`) and, for the drill, carries `-p ea-drill` (extend the existing stdin test or add one).

**Before-change check.** Run test 1 once against `deploy/restore.sh` of the base commit. It must fail with exit 1 at `guard-empty`. Write the command and the result in the final message (ticket § Acceptance 1). Commit nothing from that run.

## Step 3 — docs

- `docs/known-alerts.md` § restore drill: the Fix line says `restore.sh` waits for the final server on TCP (step `db-ready`); `restore failed at db-ready` means no answer in 60 s (read `$C logs db`). Remove "run the same command again" and "A ticket … is open". Status: `fixed in code; drill rerun pending`.
- `deploy/README.md` § VPS lost: replace the "Known fault … Run the same command again" sentences with one sentence on the fix; keep the rest of the first drill record. § New host step 6: the script waits until the database answers on TCP.
- `deploy/README.md` § First install step 4 (D3): after `$C up -d --wait db`, `until $C exec -T db pg_isready -q -h 127.0.0.1 -U postgres -d email_assistant; do sleep 1; done`.
- `docs/capabilities/operations.md` § Restore rule 2: the guard runs after the TCP wait (60 s, exit 1 at `db-ready`).

**Done when.** Tests 1–5 pass; the before-change check failed as described; the Proof command of `plan.md` prints `PROOF_OK` after the last commit.
