---
opened: 2026-11-23
---

# F172 · No part of the old look is left, and production gets the Pebble panel in one release

## Outcome

Nothing of the old look is left in the repository, and production gets the Pebble panel in one release. Users see a "what is new" card that tells them about the new look.

## Scope

- A leftover sweep: unused tokens, primitives, variants, text keys, components and dependencies; emoji in panel texts; the mockup folder `design/` with its ESLint ignore line and its `.gitignore` lines; scratch files of the design study.
- The full contact sheet for the owner's last look.
- The changelog entry "For users" and the "what is new" card.
- The release and the check of the installed app.

## Out of scope

- New features or fixes that are not part of the redesign.

## Acceptance

- The guard tests of the design system pass, and their allow list holds only the entries that the design system ADR names.
- `design/` is not in the repository; the design system ADR and the pattern page are the reference.
- The owner said "go" on the full contact sheet, and the 20-draft check of the reply-draft pilot is recorded (programme decision PB-12).
- Production runs the release; the panel shows the "what is new" card once per user.
- `deploy/rollback.sh` is a valid way back: the release holds no migration.

## Slices

Stages come from the plan. The release stage is the coordinator's own run.

## Sequenced

- Plan after: F171.
- Build after: F166, F167, F168, F169, F170, F171. Gate: the owner's "go" (programme decision PB-12).

## Notes

Programme page: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md).
