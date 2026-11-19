---
opened: 2026-11-19
---

# F139 · A restore into a fresh database volume starts without the guard-empty failure

## Outcome

`deploy/restore.sh` on a fresh database volume passes the `guard-empty` step at the first run. The operator never has to run the restore twice, and the drill record needs no "run it again" line. Source: finding (2) of the first restore drill (`notes/2026-11-15-vps-deploy-queue.md` § Restore drill record; `docs/known-alerts.md` § restore drill).

## Scope

- The readiness wait in `deploy/restore.sh` before `guard-empty` (`restore.sh:181` at `c7b4f058`). Cause: the Postgres image starts a temporary server during its init, `pg_isready` passes, the temporary server stops ("the database system is shutting down"), then the final server starts. The wait must end only when the final server answers: two real queries with a pause between them, or a wait for the end of the init phase. The plan decides and records the rejected option.
- The same wait in every other script that starts `db` on a fresh volume (`deploy/README.md` § VPS lost / New host).
- A test in `deploy/test/` with a stub `docker` on `PATH` that answers healthy during init, then "shutting down", then ready (the stub-command pattern of `deploy/test/backup.test.ts`).
- `docs/known-alerts.md` § restore drill: the fix line replaces "run the same command again".

## Out of scope

- The drill cadence, the backup path, `credentials:check` at old tags, `restore.sh --target new-host` behaviour beyond the wait.
- The env split of the production ticket (F108); F108 stage 05 keeps this wait.

## Acceptance

- The stub test fails on the script before the change and passes after it; `bun run test:unit:ci` is green.
- One `deploy/restore.sh --target drill` rerun on the VPS (coordinator, pre-approved, about 9 minutes, in the `ea-drill` project, on a release that carries the fix) ends `restore ok` at the first run with no `guard-empty` failure line; counts equal the live ones as in the first drill. The rerun is a record, not a block: if it cannot run before the ticket's last code stage lands, it becomes a follow-up ticket (owner rule 2026-11-20, `spec/build.md`).

## Sequenced

- Plan after: none.
- Build after: none (F114 is in `done/`).
- Gate: —. Lands before F108 stage 05 (both edit `deploy/restore.sh`). The VPS rerun rides release v0.4.2.

## Notes

Written 2026-11-20 from the drill record (`notes/2026-11-20-replan-parallel.md` § 2). Needs plan: a small planner job (one worker stage, one coordinator VPS stage).
