---
opened: 2026-11-13
---

# F103 · E8a Logs

## Outcome

The operator searches what the server did, one job run, one request or one event code, in a log store on the tailnet, kept 30 days. Every server log line is an event with ids, codes, counts and times only, so no mail text, address or server error text can reach a log or the store. CLI scripts keep their readable output in the operator's terminal, and that output never enters the store.

## Scope

- Starting seam: `apps/server/src/platform/log-fields.ts` and `log.ts` (the event writer that landed earlier, F089).
- Field names get kinds that the writer and the types check.
- CLI scripts print through their own output helper, not the logger.
- Every old free-text log call in the modules and roots becomes an event; Telegram updates get a run id; the lint fails on the old form.
- A canary test over the whole pipeline.
- Docker log drivers, a `cli` Compose service, and the log store (Compose profile `ops`) with its VPS rollout.

## Out of scope

- Alerts, release and rollback scripts, the restore drill: the next ticket of the epic, E8b Alerts and releases (F114).
- The E8 Should items (client-errors route, CI security, IMAP IDLE): questions.md Q5.

## Acceptance

- `bun run lint` shows no `no-restricted-syntax` message in `apps/server/src`, and an old-form log line anywhere in it fails the lint.
- The canary integration test passes: no planted address, subject, body, LLM reason or server error text appears in any log line, and every line is JSON with allow-listed keys only.
- On the VPS, a search for one `run_id` in the store UI on the tailnet shows every line of that run.
- A `$C run --rm cli …` command prints to the terminal, and its output is not in the store.
- `bash deploy/check-logging.sh` passes in CI and fails when a service has the wrong log driver.

## Slices

19 stages: 18 worker jobs and one VPS stage that the coordinator runs. Order, parallel rules and review jobs: [plan.md](plan.md) § "Stages" and § "How to run". No DB migration, no `bun.lock` change. No owner checkpoint.

## Sequenced

- Plan after: none (the event writer, F089, is in `done/` with its stages).
- Build after: F095, E1 Close the MVP (`05-execution-plan.md` §2.1 row 9).
- Gate: —.

## Notes

Design: [plan.md](plan.md). Defaults for the owner: [questions.md](questions.md).
