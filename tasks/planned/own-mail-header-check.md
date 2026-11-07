> **Status 2026-11-07 — planned.** Idea from S3 (stage 18). Not started.

# Wire `isOwnActionId` into the sync job (own-mail header check)

Scope: `docs/roadmap.md` (S4). Needs: S4. Put this item in the S4 plan input.

## Goal

`apps/server/src/main.ts` stubs `isOwnActionId` to `false`. S4 creates drafts and sent mail with the header `X-EA-Action-Id`. S4 must wire `actions.isOwnActionId` into the sync job. Then the sync recognizes mail that the system made and does not triage it again.

## Done when

- `main.ts` passes `actions.isOwnActionId` to the sync job, not the `false` stub.
- A test shows that a mail with an own `X-EA-Action-Id` is not triaged.
- A mail with a foreign or missing header is triaged as before.

## Plan

Write the file-level plan when the task starts (part of the S4 plan).

- [ ] Write the plan (wiring, header parse, tests).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-07: Created from the S3 follow-ups (stage 18, step 18.3).
