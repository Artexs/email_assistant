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

- Stages 1–10 landed on 2026-11-12. Stage 11 runs as `2026-11-12-f077-s11b-cfcaf509` (the job `…-s11-01ff7305` was stopped: wrong base). Start each stage only after the previous one is landed.
- A coordinator continues like this: `limen status`. Land a done stage job with `limen land <job-id> --yes --keep-open`, then spawn the next stage with the standing route from `spec/build.md`, `--prepare 'bash scripts/limen-prepare.sh'`, `--label F077-sNN`, and this prompt: "Implement F077 slice NN (stage NN). Read ticket.md, plan.md and stages/stage-NN-*.md; build every step of that stage. Final proof: one bash call `mkdir -p /tmp/sNN && bun run lint > /tmp/sNN/lint.log 2>&1 && bun run typecheck > /tmp/sNN/typecheck.log 2>&1 && bun run test:unit > /tmp/sNN/unit.log 2>&1 && bun run test:int > /tmp/sNN/int.log 2>&1 && echo PROOF_OK` with nothing after it, run after the last commit; read the logs in a separate call."
- One stage at a time. Stage 18 (checkpoint and deploy) needs the owner.
