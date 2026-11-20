---
opened: 2026-11-19
---

# F150 · Stale state statements and bare codes outside comments are cleaned and the lint rule covers them

## Outcome

An agent or a developer who reads the repository finds no statement that contradicts the code: the project guide names the real layout, no "planned" task file describes landed work, and the docs flag guard lists the default-off features that really show text. Ticket and decision codes no longer hide in strings, the module layer file, the docs site's own pages or the module map; the bare-code scan that today reads only comments also reads those places, and every job's final check runs it, so they stay clean.

## Scope

- The stale statements of quality pass 2 finding 14: the layout line of `CLAUDE.md`, the two task files for landed work, the one-off migration script.
- The "no visible text" list of the docs flag guard (`apps/docs/src/flagged-text.ts`): every reason true, every flag with visible text in the flagged lists.
- Bare codes in non-test source strings, in `layers.json` and in `docs/modules.md`, replaced by names.
- The existing bare-code scan (`apps/server/src/comment-codes.test.ts`, a Bun test, not an ESLint rule) extended to those places.

## Out of scope

- Bare codes in `docs/capabilities/`, ADRs, `docs/owner-decisions.md`, tool READMEs, `spec/` and test files (test names belong to the test audit ticket).
- The operator runbooks that the docs site shows in place (`deploy/README.md`, `docs/release-checklist.md`): their release markers need their own clean-up.
- The other findings of quality pass 2.
- New visible text or a changed flag default.

## Acceptance

- `CLAUDE.md` names the real workspaces, and its layout line names no folder that is gone.
- `tasks/planned/` holds only `s6f-hosted-production.md`, and `scripts/one-off/` is gone.
- `NO_VISIBLE_TEXT` holds only flags whose code shows no user text; the docs page scan checks the texts of the others.
- The bare-code scan reports a ticket code in a non-test source string, a JSON value, a docs site page or `docs/modules.md`.
- The same scan finds nothing on the branch at the end of the ticket.
- `bun run check:job` runs the scan on every job and fails on a hit.

## Sequenced

Plan after: none.
Build after: none. Gate: none (quality pass 2 ticket line 9; not a Stage 2 row of `docs/product/stage-2/05-execution-plan.md` § 2).

## Notes

Source: `spec/quality/2026-11-20-pass-2.md` finding 14. Detail: `plan.md`.
