> **Status 2026-11-07 — planned.** Idea from S4 (stage 14). Not started.

# Count delegations in the handled share

Scope: `docs/architecture.md` §4.4 (success metric). Needs: the S3 follow-up `handled-share-metric.md`.

## Goal

The weekly handled share counts mail in `spam`, `notification`, `info`, or `delegation` sent after one tap. S4 stores the `applied` sends and the `delegations` rows that the count needs. The line itself is the S3 follow-up `handled-share-metric.md`. Add the delegation part when that line exists.

## Done when

- The handled share counts a `delegation` mail whose send is `applied` and whose delegation is not `cancelled`.
- A test covers a sent delegation, a rejected one, an expired one and a failed send.
- `docs/architecture.md` §4.4 and `docs/modules.md` describe the count.

## Plan

S4 data: `actions` with `type = 'send'`, `status = 'applied'` and `payload->>'kind' = 'delegation'`; `delegations.status`. Build the S3 line first (`tasks/planned/handled-share-metric.md`).

- [ ] Write the plan after `handled-share-metric.md` is built.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-07: Created from the S4 follow-ups (stage 21, step 21.3).
