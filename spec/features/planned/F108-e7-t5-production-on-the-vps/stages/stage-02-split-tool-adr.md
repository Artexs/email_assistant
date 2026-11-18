# F108 stage 02 — Split tool, server env check, ADR 0019 and docs

Part of [`../plan.md`](../plan.md). Needs stage 01 (`compose-lib.sh`). Interfaces: [`../interfaces.md`](../interfaces.md) § Scripts.

## Carry-over reads

Stage 01 `compose-lib.sh` and its tests; `.gitignore`; `.env.example` (the three password lines); `deploy/README.md` § First install, § Release, § Backups; `docs/architecture.md` §10; `docs/decisions/README.md`; `docs/decisions/0017-web-access-tailscale-serve.md`; `docs/capabilities/operations.md`, `backups.md`.

## Step 2.1 — `deploy/env-split.sh`

**Goal.** The operator moves the three password lines out of `.env` with one command that cannot lose a value (D6).

**Files.** New `deploy/env-split.sh`, `deploy/db.env.example`; `.gitignore` gets `deploy/db.env`; a test file in `deploy/test/`.

**Decisions.** D1, D6, D30. Write each new file to a temp file in the same folder with `umask 077`, check it, then `mv`; write `deploy/db.env` before `.env`. An `EXIT` trap removes temp files. A value may hold `=`, `#` and spaces: copy the line as bytes, never parse or `source` it.

**Test.** Fixture `.env`: `A=1`, `POSTGRES_PASSWORD=sentinel-p-71`, `B=x=y # z`, `MIGRATOR_PASSWORD=sentinel-m-71`, `APP_PASSWORD=sentinel-a-71`, `C=3`.
1. Split → `.env` is exactly `A=1`, `B=x=y # z`, `C=3` (order kept); `deploy/db.env` is the three lines; its mode is 600; last stdout line `env split ok moved=3`.
2. No sentinel string in stdout or stderr of any test case.
3. Second run → `env split: already split`, exit 0, both files byte-equal to after test 1.
4. `mixed` (db.env exists and `.env` still has `APP_PASSWORD`) → exit 2, both files unchanged.
5. `.env` without `MIGRATOR_PASSWORD` → exit 2, no `deploy/db.env`.
6. A key twice in `.env` → exit 2, nothing written.
7. `--undo` after test 1 → `.env` holds the six lines (set equal to the fixture), no `deploy/db.env`; `--undo` again → exit 2.
8. A stub `mv` that fails on the second call → exit ≠ 0; no temp file and no `*.bak*` file in the folder; `.env` byte-equal to the fixture.

## Step 2.2 — `deploy/check-server-env.sh`

**Goal.** One command proves the running server holds no admin key (D5, D7).

**Files.** New `deploy/check-server-env.sh` (uses `compose-lib.sh`); a test file in `deploy/test/`.

**Test.** Stub `docker` on `PATH` prints an env list.
9. List without D5 keys (5 keys) → stdout `server env ok keys=5`, exit 0.
10. List with `MIGRATOR_DATABASE_URL=postgres://migrator:sentinel-u-72@db/x` and `APP_PASSWORD=sentinel-a-72` → exit 1, stderr `server env bad: APP_PASSWORD,MIGRATOR_DATABASE_URL` (sorted), no sentinel anywhere.
11. `DATABASE_URL=…` alone is ok (not a D5 key).
12. Stub `docker` exits 1 → exit 2.

## Step 2.3 — ADR 0019 and docs

**Goal.** The decision and the runbook match the code.

**Files.** New `docs/decisions/0019-production-on-the-home-vps.md` (status accepted, date of the land); `docs/decisions/README.md` row 0019; `docs/architecture.md` §10; `deploy/README.md`; `.env.example` comment on the three keys; `docs/capabilities/operations.md`.

**Decisions.** ADR 0019 holds: production stays on the home VPS behind Tailscale (P1, P22); why no public domain, hosted server or image registry (one operator, test organizations only, no outside user's mail; vision "EU location before any outside user's mail"); the env layout (D1, D5) and the one-off `migrate` service; what a move needs (a hosted EU server, `restore.sh --target new-host`, a public-access ADR that changes ADR 0017; the old hosted plan is commit `9cdada6`). README: the `C=` line uses `deploy/db.env`; § First install makes `deploy/db.env` from the example and keeps the three keys out of `.env`; a new § Env split runbook (back up, `env-split.sh`, `check-server-env.sh` after the next release, `--undo` before a rollback below release N); every `run --rm cli bun run db:migrate` becomes `run --rm migrate`.

**Test.** 13. `bun run docs:stale --strict` passes (if it covers these pages) and the docs link check of the repo passes.

**Done when.** Tests 1–13 pass; the Proof chain ends with `PROOF_OK`.

**Out of scope.** Changing `server` or `cli` env (stage 03); any VPS step (stage 04).

## Proof

`mkdir -p /tmp/f108-s02 && bun run lint > /tmp/f108-s02/lint.log 2>&1 && bun run typecheck > /tmp/f108-s02/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f108-s02/unit.log 2>&1 && bun run test:int:ci > /tmp/f108-s02/int.log 2>&1 && echo PROOF_OK`
