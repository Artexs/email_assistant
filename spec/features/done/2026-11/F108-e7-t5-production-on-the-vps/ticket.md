---
opened: 2026-11-13
landed: 2026-11-20
---

# F108 · E7-T5 Production on the VPS

## Outcome

The home VPS runs the application as a production system: the long-running server holds only the keys it needs, migrations run in a one-off service that alone gets the migrator key, the backups reach Backblaze and a failed backup reaches the operator, and ADR 0019 records that production stays on the home VPS behind Tailscale. A second test organization goes through invite, plan changes and delete on the VPS while the pilot keeps working. Source: Stage 2 row 14 (`docs/product/stage-2/05-execution-plan.md` §2.1), epic `docs/product/stage-2/epics/E07-platform-and-trust.md` (S6f), old segment file `tasks/planned/s6f-hosted-production.md`. It absorbs F021 (env split).

## Scope

- Env split (S6 D25): the database passwords move out of the server's env file; a one-off migrate service; a split tool and a key-name check.
- VPS rollout in two releases (expand, then contract).
- Backup checks on the VPS and in the bucket (read only); no `.env.bak-*` on the VPS (D30).
- ADR 0019, `docs/architecture.md` §10, `deploy/README.md`, capability pages.
- Final checkpoint: second test organization on the VPS; close S6.

## Out of scope

- The CI timing tests (fixed earlier by the CI-green ticket F093; the last stage only checks CI).
- The failed-backup alert and the backup status file (built by F114 stages 03–04); the restore drill (F114 stage 09).
- The sim stack env (`deploy/compose.sim.yaml`) and the local dev env.
- A hosted server, a public domain, an image registry (ADR 0019 says why).

## Acceptance

- On the VPS, `deploy/check-server-env.sh` prints `server env ok`: the running server has no database password and no migrator URL.
- A release runs its migrations through the `migrate` one-off service; the server and `cli` configs hold no migrator URL.
- The last nightly backup on the VPS printed `backup ok`, its status file says `ok`, and the object is listed in the bucket (names and sizes only).
- No `.env.bak-*` file is left on the VPS.
- ADR 0019 "Production stays on the home VPS behind Tailscale" is accepted.
- A second test organization goes through invite, set password, plan `suspended` and `active`, and delete on the VPS; the pilot still syncs. Full list: `plan.md` § Done when.

## Slices

Seven stages, one job each. 01, 02, 03, 05 are worker jobs (02 and 03 may run in parallel); 04, 06, 07 are coordinator runs on the VPS. Release N (01–03) is deployed and the env is split (04) before 05 is spawned. No migration. 01 and 05 change `deploy/compose.yaml`: no other job that changes Compose files runs next to them. Detail: `plan.md` § How to run.

## Sequenced

- Plan after: F114 (E8b alerts and releases: the release, rollback and restore scripts and the backup status file this plan changes; it has `stages/`).
- Build after: E7-T1 Polish UI (F098), E7-T2 platform controls (F099), E7-T3 account data (F106), all in `done/`, and E7-T4 papers and cost (F107, active) in `spec/features/done/` (`05-execution-plan.md` §2.1 row 14). Stage 07 also needs F114 in `done/` (its stage 09 drill proves the restore).
- Gate: — (VPS deploys are pre-approved, owner 2026-11-13). Stage 07 waits for the F114 drill, which waits for the owner's `age` key (`notes/owner-later.md` item 3).

## Notes

Plan: [plan.md](plan.md). Defaults for the owner: [questions.md](questions.md). Interfaces: [interfaces.md](interfaces.md). Scouts: [scouts.md](scouts.md). The old env-split ticket (F021) is dropped and absorbed here.
