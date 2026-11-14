---
opened: 2026-11-13
---

# F096 · E8-LR Log rotation

## Outcome

Docker rotates the log of every Compose service: each container keeps at most 5 files of 10 MB, so a log flood cannot fill the VPS disk. A check script fails when a service in any Compose file has no rotation, and CI runs it. The VPS gets the change with its next normal deploy; the deploy runbook checks it.

## Scope

- One `logging:` block (`json-file`, `max-size: 10m`, `max-file: "5"`) for every service in `deploy/compose.yaml` and `deploy/compose.dev.yaml`.
- `deploy/check-logging.sh`, a step in the CI `image` job, and the `deploy/README.md` runbook lines (§ Update check, § Logs).
- Source: `docs/product/stage-2/epics/E08-operations.md` § Discovery, decision 11 (PD-054); settings from `E08-discovery-notes.md` §3.

## Out of scope

- `/etc/docker/daemon.json` on the VPS (no file there, 2026-11-13; the Compose block travels with the repo).
- The log store with search, its collector and the JSON log content: the E8a logs ticket (F103). The disk alert: the E8b alerts and releases ticket (F114).
- Host log files under `~/ea-logs/` (cron output): see `questions.md` Q2.
- A separate VPS deploy for this ticket (decision 11: it rides the next deploy).

## Acceptance

- `bash deploy/check-logging.sh` exits 0 on the repo and exits 1 on each broken copy of `plan.md` § Done when.
- The CI `image` job runs the check on `master` and stays green.
- `plan.md` § Done when, items 1–5.

## Slices

One stage, one worker job: [`stages/stage-01-compose-rotation.md`](stages/stage-01-compose-rotation.md). No migration, no `bun.lock` change: it may run next to any other build. No owner checkpoint. How to run: `plan.md` § How to run.

## Sequenced

- Plan after: none.
- Build after: none (row 2 of `docs/product/stage-2/05-execution-plan.md` §2.1 needs nothing landed).
- Gate: —

## Notes

Source row: §2.1 # 2 of `docs/product/stage-2/05-execution-plan.md`. Decisions, facts and the stage list: [`plan.md`](plan.md). Small defaults: [`questions.md`](questions.md).
