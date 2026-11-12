---
opened: 2026-11-12
landed: 2026-11-12
---

# F080 · The `mailbox:backfill` CLI refuses a suspended organization

## Outcome

`bun run mailbox:backfill` stops with a clear message when the organization of the mailbox is `suspended`. Today it does not check the plan, so it stores mail and re-queues the backfill window for a paused customer.

## Scope

- Start at `apps/server/src/scripts/mailbox-backfill.ts`. Read the plan with `getOrgPlan` or `isOrgSuspended` from the `tenancy` index before the first IMAP call. Exit code 1, a message with the org id and the code `org_suspended`, no mail text.
- One test for the check (a script helper, as the other `*-args.ts` files), with a `suspended` organization and an `active` one.
- `deploy/README.md` "Customers (S6a)" gets one line.

## Out of scope

- Other CLIs that touch a mailbox (`mailbox:rescan`, `mailbox:settings`): decide in the ticket plan whether they need the same gate.

## Acceptance

- For a `suspended` organization the CLI exits 1 and changes no row (test).
- For an `active` organization it runs as before (existing tests stay green).

## Notes

Follow-up of F077 stage 17. The backfill re-queues only `too_old` mail with a body, so the S6a backlog rule is not affected.
