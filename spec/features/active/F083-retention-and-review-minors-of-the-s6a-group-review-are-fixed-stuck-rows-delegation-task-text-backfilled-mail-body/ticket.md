---
opened: 2026-11-12
---

# F083 · Retention and review minors of the S6a group review are fixed: stuck rows, delegation task text, backfilled mail body

## Outcome

Retention never clears text that a later step still needs, and no row stays forever when a mailbox is paused. The four minor findings of the S6a group review are fixed or closed with a reason.

## Scope

- Source: `spec/features/active/F077-s6a-customer-core/review-group.md` (minor-1 to minor-4). Start at `apps/server/src/retention.ts` and the clear functions of stages 12 and 13.
- minor-1: a mail body stuck in `processing` and an action payload stuck in `applying` stay without a time limit when the mailbox is paused, the organization is suspended or triage is `off`. Decide a limit or a take-back rule.
- minor-2: an open delegation with a due date more than 90 days ahead loses its task text, due date and language before its reminders. Keep open delegations until they close.
- minor-3: a pending backfilled mail can lose its body after 30 days and then go to the LLM without it. Skip such mail in triage, or keep its body until it is triaged.
- minor-4: the retention tests lack the paused, suspended and triage-`off` cases for each §7 row. Add them.

## Out of scope

- New retention periods or new cleared columns. `auth_verifications` cleanup (F078).

## Acceptance

- One test per minor finding, which fails before the fix and passes after.
- `bun run lint`, `bun run typecheck`, `bun run test:unit` and `bun run test:int` pass.

## Notes

Found by the Opus group review of F077 on 2026-11-12; none blocks the S6a deploy.
