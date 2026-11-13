---
opened: 2026-11-07
---

# F031 · Remove the dependence of the `all` scope on `TEST_MAILBOX_ADDRESS`

## Outcome

Before the first external customer (S5/S6), the `ACTIONS_SCOPE=all` scope must not depend on `TEST_MAILBOX_ADDRESS`. A per-mailbox consent of the user replaces it. Then the committer changes only mailboxes whose owner agreed.

## Notes

Moved from `tasks/planned/actions-scope-removal.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
