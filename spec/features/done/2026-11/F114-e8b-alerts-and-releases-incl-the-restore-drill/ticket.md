---
opened: 2026-11-13
landed: 2026-11-19
---

# F114 · E8b Alerts and releases (incl. the restore drill)

## Outcome

The operator gets one Telegram alert when a service level breaks (sync late, urgent mail not told in time, LLM failures, disk, backup age), a repeat while it stays open, and one "resolved" line. Each release is a tagged version with a changelog that one command deploys and one command rolls back without a rebuild. One timed restore drill proves that a backup comes back, and a runbook says how to rebuild a lost VPS. Source: Stage 2 row 20 (`docs/product/stage-2/05-execution-plan.md` §2.1), epic `docs/product/stage-2/epics/E08-operations.md`.

## Scope

- An app job that checks five service levels and sends operator alerts with stored open state.
- A backup status file and a Healthchecks.io ping from the nightly backup.
- Release and rollback scripts, version stamp, changelog, release checklist, migration check in CI.
- One restore path for a drill and for a new host; the drill on the VPS in a separate stack.

## Out of scope

- The log store and log conversion (E8a, F103).
- The operator console list of alerts (F081, E7).
- IMAP IDLE, CI security scans, load test (E8 Should tier, later tickets).

## Acceptance

- Each alert kind opens, repeats after 6 h and resolves in tests with fixed data (`plan.md` § Done when 1).
- `deploy/release.sh v0.1.0` and two `deploy/rollback.sh` runs pass on the VPS with no rebuild.
- CI fails a new migration with a contract statement that has no `-- contract:` line.
- The drill prints `restore ok target=drill`; its counts lie between the live counts before and after the backup; the live containers did not change.
- `deploy/README.md` § VPS lost holds the measured drill time.

## Slices

Nine stages, one worker job each; stage 09 is a coordinator run on the VPS. Order and parallel rules: `plan.md` § Stages and § How to run. Stage 01 holds the migration: no other migration in build next to it.

## Sequenced

- Plan after: F103 (E8a Logs: the logger, field kinds and the one-off `cli` service; it has `stages/`).
- Build after: F103 (E8a Logs) in `spec/features/done/` (`05-execution-plan.md` §2.1 row 20). E8 discovery notes §8 allow stages 01–07 after F103 stage 01 (landed); the coordinator decides.
- Gate: — (PD-055 dropped as a gate: Owner, 2026-11-15: "22 gigabytes ... enough ... when it has 5, 4 or 2 GB I will perform action." The VPS had 22 GB free on 2026-11-15.) Disk rule: stage 09 runs `df -h /` on the VPS first; under 5 GB free, stop and tell the owner.

## Notes

Defaults for the owner: `questions.md`. Scouts: `scouts.md`.
