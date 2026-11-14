> **Status 2026-11-12 — planned.** Left: the detailed stage plan (an own `plan-task` session), then the build and the VPS steps with `run-task`.

# S6f Production on the home VPS

> **Moved 2026-11-14:** S6f is now `F108-e7-t5-production-on-the-vps`. This file is history; the ticket decides.

> **Scope change 2026-11-12:** this segment was "Hosted EU production" (Hetzner, domain, Caddy, image registry, pilot move, staging). The user cut it (master plan § "Scope change", P22, P23): production stays on the home VPS behind Tailscale. The old plan is in Git history (`9cdada6`). The file name stays so that the links in the master plan keep working.

Scope: the S6 master plan `tasks/active/s6-pre-sale.md` (finding 3, P22, P23, D23 (only the timing-test fix), D25, D30, D31 (backup event), D28 (ADR 0019 as changed), "Rules for every step"); ADR 0017 stays as it is. Also replaces the Limen ticket `spec/features/planned/F021-server-env-scope/` (close it with an `outcome.md` when this segment is done). Needs: S6a–S6e merged. Every step on the VPS waits for the user's go.
Git mode: worktree (`task/s6f-vps-production`). Run mode: pipeline. Review model: stronger reviewer (Opus, high).

## Goal

The home VPS runs the application as a production system: CI is green, the running server holds only the keys it needs, the backups reach Backblaze and can be restored, a failed backup reaches the operator, and an ADR records that production stays on the home VPS behind Tailscale.

## Done when

- The two known timing tests (`runSend > 3`, `AgentMail fake > holdResponseNext`, `docs/known-alerts.md`) are fixed, and the `ci` job is green on `master`; the alert entry is closed.
- The running `server` env has no `POSTGRES_PASSWORD` and no `MIGRATOR_PASSWORD` (`docker compose exec server env` key names only); migrations run in a one-off service with the migrator URL (D25).
- Backups (P23): on the VPS (read only first, the user's go), `deploy/backup.sh` runs nightly, the last run printed `backup ok <name> <bytes>`, and the object is in the Backblaze bucket (`rclone ls` names and sizes only); the bucket lifecycle rule is read and logged. One restore test on the dev machine with `deploy/restore-test.sh` passes (the runbook says "the Mac"; use the machine the user names) (row counts, then the local copy is deleted). A failed backup run is an operator notice (D31, the S6a frame).
- No `.env.bak-*` file is left on the VPS (D30; S5e left one).
- ADR 0019 "Production stays on the home VPS behind Tailscale" (accepted; it records why there is no public domain, hosted server or image registry, and what a move would need: the old S6f plan in `9cdada6`).
- Final checkpoint (master plan checkpoint 3): a second test organization on the VPS goes through `org:invite` (printed link), set password with the terms, connect a test mailbox of the user, triage, `org:plan --plan suspended` (no triage, the banner, Telegram "paused"), `--plan active` (backlog rule), delete organization; then the pilot still works.
- `docs/architecture.md` §10, `deploy/README.md`, notes.

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
