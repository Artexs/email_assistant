> **Status 2026-11-07 — planned.** Idea from S4 (decision D7). Not started.

# Match a delegate's reply from another address

Scope: `docs/architecture.md` §4.1 (the reply rule). Needs: S4.

## Goal

The reply rule matches a mail only when it comes from the delegate's address, in the thread of the sent mail (D7). A reply from another address of the same person is not detected, so the delegation stays `sent` and gets reminders. Allow a per-delegate list of alias addresses.

## Done when

- `delegates` has an alias list (a column or a table), and a CLI command sets it.
- `detectReply` accepts the delegate address and its aliases, and no other address.
- Tests: a reply from an alias closes the delegation; a reply from an unknown address does not; an alias never equals a mailbox address of the organization.
- `docs/modules.md` §3.9 and `deploy/README.md` (section Delegates) describe the aliases.

## Plan

`findOpenDelegationByMessageIds` in `delegation/repo.ts` compares the sender address with the delegate's address. A migration adds the alias storage. Keep the rule that a delegate address is never a mailbox address.

- [ ] Write the plan (storage, CLI, the match query, tests).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-07: Created from the S4 follow-ups (stage 21, step 21.3).
