# F108 stage 02 — Split tool and server env check

Needs stage 01: `deploy/compose-lib.sh` (`EA_D5_KEYS`, `ea_env_split_state`, `ea_compose_init`). May run next to 03 (no shared file). A worker job.

Part of [`../plan.md`](../plan.md). Interfaces: [`../interfaces.md`](../interfaces.md) § Scripts.

## Carry-over reads

Stage 01 `compose-lib.sh` and its tests; `.gitignore`; `.env.example` (the three password lines and `MIGRATOR_DATABASE_URL`); the stub-command pattern of `deploy/test/backup.test.ts` (a `stub(name, body)` script in a temp folder first on `PATH`; a stub that must count or fail on call N appends to a calls file in the temp root, as the `rclone` stub does).

## Step 2.1 — `deploy/env-split.sh`

**Goal.** The operator moves the D5 lines out of `.env` with one command that cannot lose a value (D6).

**Files.** New `deploy/env-split.sh`, `deploy/db.env.example`; `.gitignore` gets `deploy/db.env`; a test file in `deploy/test/`.

**Decisions.** D1, D5, D6, D30. Write each new file to a temp file in the same folder with `umask 077`, check it, then `mv`; db.env first, `.env` second. An `EXIT` trap removes temp files. A value may hold `=`, `#` and spaces: copy the line as bytes, never parse or `source` it. Values are compared in the script (the `mixed` finish), never printed.

**Test.** Fixture `.env` (shaped like `.env.example`): `A=1`, `POSTGRES_PASSWORD=sentinel-p-71`, `B=x=y # z`, `MIGRATOR_PASSWORD=sentinel-m-71`, `MIGRATOR_DATABASE_URL=postgres://migrator:sentinel-u-71@127.0.0.1:5433/x`, `APP_PASSWORD=sentinel-a-71`, `C=3`.
1. Split → `.env` is exactly `A=1`, `B=x=y # z`, `C=3` (order kept); `deploy/db.env` holds the four D5 lines; its mode is 600; last line `env split ok moved=4`; then `ea_env_split_state` prints `split`.
2. The same fixture without the `MIGRATOR_DATABASE_URL` line → `moved=3`.
3. No sentinel string in stdout or stderr of any test case.
4. Second run → `env split: already split`, exit 0, both files byte-equal to after test 1.
5. Half-done split: db.env as after test 1, `.env` still the fixture → `env split ok finished=4`, files as after test 1.
6. `mixed` with a different value (db.env has `APP_PASSWORD=other`, `.env` has `APP_PASSWORD=sentinel-a-71`) → exit 2, stderr names `APP_PASSWORD`, both files unchanged.
7. `.env` without `MIGRATOR_PASSWORD` and no db.env → exit 2, no `deploy/db.env`.
8. A key twice in `.env` → exit 2, nothing written.
9. `--undo` after test 1 → `.env` holds the seven lines (set equal to the fixture), no `deploy/db.env`, state `old`; `--undo` again → exit 2.
10. A stub `mv` that fails on the second call → exit ≠ 0; no temp file and no `*.bak*` file in either folder; `.env` byte-equal to the fixture; a second run then gives test 5's result.

## Step 2.2 — `deploy/check-server-env.sh`

**Goal.** One command proves the running server holds no D5 key (D5, D7).

**Files.** New `deploy/check-server-env.sh` (uses `compose-lib.sh`); a test file in `deploy/test/`.

**Test.** Stub `docker` on `PATH` prints an env list.
11. List without D5 keys (5 keys) → stdout `server env ok keys=5`, exit 0.
12. List with `MIGRATOR_DATABASE_URL=postgres://migrator:sentinel-u-72@db/x` and `APP_PASSWORD=sentinel-a-72` → exit 1, stderr `server env bad: APP_PASSWORD,MIGRATOR_DATABASE_URL`, no sentinel anywhere.
13. `DATABASE_URL=postgres://app:sentinel-d-72@db/x` alone → ok (not a D5 key), no sentinel in output.
14. Stub `docker` exits 1 → exit 2.
15. The recorded `docker` argv holds `exec -T server env` and the env file chosen by the helper.

**Check.** `bun test deploy/test`.

**Done when.** Tests 1–15 pass; the Proof chain ends with `PROOF_OK`.

**Out of scope.** Docs and ADR (stage 03); changing `server` or `cli` (stage 05); any VPS step (stage 04).

## Proof

The chain of [`../plan.md`](../plan.md) § Proof with `sNN` = `s02`; it ends with `PROOF_OK`.
