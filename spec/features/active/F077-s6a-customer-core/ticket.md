---
opened: 2026-11-12
---

# F077 · S6a Customer core: a second organization runs next to the pilot

## Outcome

Every mailbox is processed without `TEST_MAILBOX_ADDRESS`, and the existing modes are the consent for changes. The operator can pause a customer (`suspended`), the number of mailboxes is limited, and stored texts expire after the documented periods. A second organization can then run next to the pilot.

## Scope

- Scopes `all` for triage, actions and sends (D1); consent by mode (D2); plan state and `org:plan` / `org:status` CLIs (D3); `suspended` in every job, Telegram tap and web write, and resume (D4); retention job (D5); mailbox limit (D6); operator notices frame (D31); panel texts; docs.
- Replaces the planned tickets F027 (retention job) and F031 (actions scope removal); the last stage closes them.

## Out of scope

- S6b public login, S6c account data, S6e papers, S6f hosted production, F076 Vertex AI EU.

## Acceptance

- Every point of "Done when" in [plan.md](plan.md) holds, each with a test or a recorded check.

## Slices

One worker job per stage, in order, each landed with `limen land --keep-open`. The stage files are in `stages/`: `stage-01` to `stage-18`. A stage file holds goal, files, interfaces, decisions, tests, check and done-when. Stage 1 first. Stages 4 (migration) must not run in parallel with any other migration or `bun.lock` change.

## Notes

Moved from the old `tasks/` flow to Limen on 2026-11-12 (user decision). Plan, decisions A1–A30 and the cold-review result: [plan.md](plan.md). Master plan: `tasks/active/s6-pre-sale.md`. The old "run-task" pipeline and its Opus reviewer are not used: Limen worker and reviewer jobs replace them (standing models in `spec/build.md`).

## Progress and how to continue

State on 2026-11-12, at the handover from the first coordinator:

- Stages 1–10 are landed on `master` (last merge `de51a18`).
- Stage 11 (operator notices) runs as job `2026-11-12-f077-s11b-cfcaf509`. The job `…-s11-01ff7305` was stopped before it did work (wrong base); ignore it.
- The job DBs of the landed stages are dropped. The stage 11 job DB (`2026-11-12-cfcaf509`) is not.

How a coordinator continues:

1. Run `limen watch 2026-11-12-f077-s11b-cfcaf509`, so its finish wakes you. You did not spawn it.
2. When a stage job finishes, read its final message and its `/tmp/sNN/*.log` proof logs. Land it with `limen land <job-id> --yes --keep-open`. If the only proof needs a job with no commits (a `limen continue` run), land the parent job id, not the continue id.
3. Drop the landed job DB from the main checkout: `bun run db:worktree 2026-11-12-<hash> --drop`, where `<hash>` is the last part of the job id.
4. Only after the land, spawn the next stage. Never spawn stage N+1 before stage N is on `master`. Command:

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label F077-sNN \
     "Implement F077 slice NN (stage NN). Read spec/features/active/F077-s6a-customer-core/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: one bash call 'mkdir -p /tmp/sNN && bun run lint > /tmp/sNN/lint.log 2>&1 && bun run typecheck > /tmp/sNN/typecheck.log 2>&1 && bun run test:unit > /tmp/sNN/unit.log 2>&1 && bun run test:int > /tmp/sNN/int.log 2>&1 && echo PROOF_OK' with nothing after it, run after the last commit; read the logs in a separate call. In the note, list as proven only what a saved log shows."
   ```

5. Open checks: workers often break the "one `&&` call" form. Accept a check when its saved log shows the pass. When a check has no proof at all (for example a repeated race test), send the worker back with `limen continue <job-id> "…"` and the same engine flags. Use the full job id: a label can match more than one job.
6. Stages 12–17 remain after stage 11: 12 and 13 retention clear functions, 14 retention job, 15 panel server, 16 panel web, 17 docs. Stage 17 also closes the old planned tickets F027 and F031.
7. Stage 18 (checkpoint and deploy to the home VPS) needs the owner. Stop there and ask. The owner also must run `bun run db:migrate` on the shared dev DB (the stage 4 migration and any later one).
