---
opened: 2026-11-23
---

# F172 · No part of the old look is left, and production gets the Pebble panel in one release

## Outcome

Nothing of the old look is left in the repository, and production gets the Pebble panel in one release. Where the docs links flag is on, members see a "what is new" card that tells them about the new look; the flag itself stays as it is.

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
- The release ran either before the owner's 24-hour standing rule expired (2026-11-25 evening), with CI green on the release commit, or after the owner said "go" on the full contact sheet (programme decision PB-12).
- The 20-draft check of the reply-draft pilot is recorded, or the owner accepted its record as enough.
- Production runs the release, and the deploy note records per organization whether the docs links flag is on; where it is on, a member sees the "what is new" card once per browser.
- `deploy/rollback.sh` is a valid way back: the release holds no migration.

## Slices

Seven stages: [`plan.md`](plan.md) § Stages and § How to run. The two sweep stages, the visual review, the visual fixes, the mockup removal and the release run in order. The release and the local cleanup are the coordinator's own runs. After the standing rule expires, the release waits for the owner's "go" (`questions.md` 1).

## Sequenced

- Plan after: F171.
- Build after: F166, F167, F168, F169, F170, F171. Gate: the owner's "go" (programme decision PB-12). Before the standing rule of 2026-11-24 expires (2026-11-25 evening), it is taken as given once CI is green on the release commit; after that, the release asks for it.

## Notes

Programme page: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md).
