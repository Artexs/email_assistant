> **Status — S6 done 2026-11-20.** Built as F108 (ticket folder `F108-e7-t5-production-on-the-vps` in `spec/features/`); the final checkpoint ran on the VPS (`notes/2026-11-15-vps-deploy-queue.md` § F108 checkpoint). Not verified lines: `outcome.md` in that folder. Old status (2026-11-12): planned.

# S6f Production on the home VPS

> **Moved 2026-11-14:** S6f is now `F108-e7-t5-production-on-the-vps`. This file is history; the ticket decides.

> **Scope change 2026-11-12:** this segment was "Hosted EU production" (Hetzner, domain, Caddy, image registry, pilot move, staging). The user cut it (master plan § "Scope change", P22, P23): production stays on the home VPS behind Tailscale. The old plan is in Git history (`9cdada6`). The file name stays so that the links in the master plan keep working.

Scope: the S6 master plan `tasks/active/s6-pre-sale.md` (finding 3, P22, P23, D23 (only the timing-test fix), D25, D30, D31 (backup event), D28 (ADR 0019 as changed), "Rules for every step"); ADR 0017 stays as it is. Also replaces the Limen ticket `spec/features/planned/F021-server-env-scope/` (close it with an `outcome.md` when this segment is done). Needs: S6a–S6e merged. Every step on the VPS waits for the user's go.
Git mode: worktree (`task/s6f-vps-production`). Run mode: pipeline. Review model: stronger reviewer (Opus, high).

## Goal

The home VPS runs the application as a production system: CI is green, the running server holds only the keys it needs, the backups reach Backblaze and can be restored, a failed backup reaches the operator, and an ADR records that production stays on the home VPS behind Tailscale.

## Done when

- The two known timing tests (`runSend > 3`, `AgentMail fake > holdResponseNext`, `docs/known-alerts.md`) are fixed, and the `ci` job is green on `master`; the alert entry is closed. Evidence: `docs/known-alerts.md` entry `runSend > 3 …` status `fixed (4ad0fbd)` (ticket `F093-ci-green`); the last three completed CI runs on `master` green (`notes/2026-11-15-vps-deploy-queue.md` § F108 checkpoint).
- The running `server` env has no `POSTGRES_PASSWORD` and no `MIGRATOR_PASSWORD` (`docker compose exec server env` key names only); migrations run in a one-off service with the migrator URL (D25). Evidence: `server env ok keys=38` and no database key in the `cli` env (`notes/2026-11-15-vps-deploy-queue.md` § Stage 06 release); `v0.4.4` migrated through `migrate` (§ Release v0.4.4).
- Backups (P23): on the VPS (read only first, the user's go), `deploy/backup.sh` runs nightly, the last run printed `backup ok <name> <bytes>`, and the object is in the Backblaze bucket (`rclone ls` names and sizes only); the bucket lifecycle rule is read and logged. One restore test on the dev machine with `deploy/restore-test.sh` passes (the runbook says "the Mac"; use the machine the user names) (row counts, then the local copy is deleted). A failed backup run is an operator notice (D31, the S6a frame). Evidence: `backup ok` and `status.json` `ok` (§ Stage 04 runs 2 and 3, § Stage 06); a failed run opened `slo_backup_age` and sent 1 operator notice (§ Stage 04 runs 2 and 3); the restore test ran as the drill with `deploy/restore.sh` on 2026-11-19 and 2026-11-20 (§ Restore drill record, § Restore drill record 2). Not verified: the bucket listing and the lifecycle rule (no read remote on the PC; owner step O1).
- No `.env.bak-*` file is left on the VPS (D30; S5e left one). Evidence: three copies deleted, two kept for the owner because they hold values the live env lacks (§ Stage 06; `notes/owner-later.md` item 5).
- ADR 0019 "Production stays on the home VPS behind Tailscale" (accepted; it records why there is no public domain, hosted server or image registry, and what a move would need: the old S6f plan in `9cdada6`). Evidence: `docs/decisions/0019-production-on-the-home-vps.md`, status accepted.
- Final checkpoint (master plan checkpoint 3): a second test organization on the VPS goes through `org:invite` (printed link), set password with the terms, connect a test mailbox of the user, triage, `org:plan --plan suspended` (no triage, the banner, Telegram "paused"), `--plan active` (backlog rule), delete organization; then the pilot still works. Evidence: § F108 checkpoint (invite, set password with the terms, suspended with `403 org_suspended` and the banner, active, delete; the pilot kept syncing). Not verified: connect a test mailbox, triage, Telegram "paused" and the backlog rule (no test mailbox and no second Telegram account; owner step O2).
- `docs/architecture.md` §10, `deploy/README.md`, notes. Evidence: F108 stage 03 (`stages/stage-03-adr-docs.md` in the ticket folder).

## Owns (from the master plan)

- Decisions D23 (only the timing-test fix), D25 (env split), D30 (no secret copies on the host), D31 (backup event), D28 (ADR 0019 as changed).
- Files (expected): the two timing tests and their code, `deploy/compose.yaml` (the one-off migrate service, the server env list), `.env.example` (which keys the server gets), `deploy/backup.sh` (the notice hook), `deploy/README.md`, `docs/decisions/0019-*.md`, `docs/architecture.md`.

## Stage sketch

1. **Timing tests**: find the cause of each flaky test (fake timers or a fixed clock), fix it, CI green three runs in a row.
2. **Env split** `[risky]`: the server's env list, the one-off migrate service, the local run, the VPS deploy (user's go); the `env` key-name check.
3. **Backups** (user's go): read-only check on the VPS and in the bucket; the failed-backup operator notice; the restore test on the dev machine; remove `.env.bak-*` (user's go).
4. **ADR 0019 and docs.**
5. **Final checkpoint** (checkpoint 3): the second-organization run on the VPS; group review; close S6.

## Questions for the plan session

- How a failed backup reaches the operator: `backup.sh` writes a status file that the server reads, or the script calls the bot API itself (default: a status file; the server's operator job reads it, so no token goes into the script).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are Limen tickets in `spec/features/planned/`.

## Log

- 2026-11-12: Created by the S6 master plan session (`tasks/active/s6-pre-sale.md`).
- 2026-11-12: Rewritten for the scope change (P22, P23): production on the home VPS; Hetzner, domain, Caddy, GHCR, pilot move and staging dropped.
