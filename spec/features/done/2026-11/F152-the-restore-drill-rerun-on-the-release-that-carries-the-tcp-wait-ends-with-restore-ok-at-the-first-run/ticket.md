---
opened: 2026-11-19
landed: 2026-11-20
---

# F152 · The restore drill rerun on the release that carries the TCP wait ends with restore ok at the first run

## Outcome

The restore drill rerun on the release that carries the TCP wait ends with restore ok at the first run. The first drill (2026-11-19) needed a second start because the restore queried the database while the Postgres image still ran its init server. The fix that waits for the final server on TCP (F139, step `db-ready` in `deploy/restore.sh`) is in code and tests, but no real fresh volume has proven it. This rerun proves it on the VPS when the run sees the init server (`probes` above 1; else the record says the init phase was not seen), and gives the production ticket (F108 stage 07) its proof of the new restore path.

## Scope

- One drill in project `ea-drill` on a fresh volume, at the tag that the live stack runs, as `deploy/README.md` § VPS lost / Drill says. Run once, no rerun on failure.
- The drill record: `notes/2026-11-15-vps-deploy-queue.md`, `deploy/README.md` § VPS lost, `docs/known-alerts.md` § restore drill, `docs/capabilities/backups.md`.
- Test hardening that the F139 review named as optional, taken in here: the new-host restore test asserts its 3 pauses and that its probes come after `up -d --wait db`.

## Out of scope

- Any change to `deploy/restore.sh`, the Compose files or the wait itself. A failure opens a new ticket.
- The live stack: no release, no rollback, no env change. The drill cadence (next drill 2027-05-19).

## Acceptance

- The first drill run prints `db ready probes=<p>` and `credentials ok=<k> failed=0` and ends `restore ok target=drill seconds=<n>`, with no line `restore failed at`.
- Each drill count lies between the live counts before and after the drill backup.
- The live `db` and `server` container ids and start times are the same before and after the drill.
- `docs/known-alerts.md` § restore drill says `fixed (drill 2, <date>, <tag>)`, and the queue note holds "Restore drill record 2".
- Test F139-2 in `deploy/test/restore.test.ts` asserts 3 `sleep` calls and probes after `up -d --wait db`; it fails when the pause line is deleted or the wait runs before `up`.

## Slices

Two stages, which may run at the same time: 01 is a coordinator VPS run, 02 is a small worker test stage. No migration, no `bun.lock` change. See `plan.md` § How to run.

## Sequenced

- Plan after: none (F139 has its stages; it is in `done/`).
- Build after: F139 (in `done/`). Stage 01 needs a live release that carries F139 stage 01 (`v0.4.2` or later; `v0.4.3` is live) and no release run in flight on the VPS.
- Gate: — (pre-approved coordinator VPS run, `CLAUDE.md` § VPS).

## Notes

Source: the follow-up of F139 stage 02 (`spec/features/done/2026-11/F139-a-restore-into-a-fresh-database-volume-starts-without-the-guard-empty-failure/stages/stage-02-vps-drill-rerun.md`). The rerun is a record, not a block (owner rule 2026-11-20).
