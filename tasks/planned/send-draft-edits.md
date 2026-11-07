> **Status 2026-11-07 — planned.** Idea from S4 (Phase 2 idea). Not started. Needs a product decision.

# Send the draft as the user edited it

Scope: `docs/architecture.md` §4.5. Needs: S4 and the user's decision on the product.

## Goal

In S4 the system sends the text that the user approved in the database. An edit of the draft in the mail client does not count, and the approval message says so. Phase 2: the user edits the draft in the mail client and the system sends the edited draft. The committer would read the draft back from Drafts before the send (`locateByActionId` finds it by the header).

## Done when

- The user decides if this is wanted, and how the approval message shows an edited draft.
- The committer reads the draft from Drafts before the send and builds the raw message from it. A draft that lost the header or the recipient is refused.
- The recipient still comes only from the `delegates` row or the sender address, never from the edited text.
- Tests: an edited body is sent; a changed recipient is refused; a deleted draft ends as `draft_missing`.
- `docs/architecture.md` §4.5 and ADR 0003 describe the new rule.

## Plan

Open question: the injection rules (`docs/architecture.md` §7) assume the template text. An edited draft is the user's own text, but the quote below it is not. Ask the user before you plan.

- [ ] Get the product decision; then write the plan.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-07: Created from the S4 follow-ups (stage 21, step 21.3).
