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
