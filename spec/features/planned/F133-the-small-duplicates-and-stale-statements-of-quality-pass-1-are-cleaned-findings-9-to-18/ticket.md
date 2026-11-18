---
opened: 2026-11-15
---

# F133 · the small duplicates and stale statements of quality pass 1 are cleaned (findings 9 to 18)

## Outcome

the small duplicates and stale statements of quality pass 1 are cleaned (findings 9 to 18).

<!-- Two to four sentences: what becomes true for a user or operator. -->

## Scope

- <!-- Boundary and starting seam, not an edit list. -->

## Out of scope

- <!-- Nearby work that is not part of this ticket. -->

## Acceptance

- <!-- One observable result or check per line. -->

## Notes

<!-- Optional decisions or open questions; no progress log. -->

## Source

Quality pass 1, `spec/quality/2026-11-15-pass-1.md`, finding(s) 9-18: read each finding there (file, line, broken rule, proposed fix). Built only when the owner restarts the work. A fix that drops or changes a user feature waits for the owner.

- `apps/server/src/scripts/stats-week.ts` still writes with `process.stdout.write`, not `createCliOutput` (its bare line format is pinned by `stats-week-cli.test.ts`; found in F116 stage 23). Move it and update the test together.

- Polish decimal: `formatPercent` in `apps/web/src/lib/gate-text.ts` prints "99.1"; Polish needs "99,1" (found by Polish review 1, `notes/2026-11-18-polish-review-1.md`). A locale change in logic.
