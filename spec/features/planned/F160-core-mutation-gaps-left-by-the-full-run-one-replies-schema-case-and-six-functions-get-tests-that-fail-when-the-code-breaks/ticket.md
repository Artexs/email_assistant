---
opened: 2026-11-20
---

# F160 · Core mutation gaps left by the full run (one replies schema case and six functions) get tests that fail when the code breaks

## Outcome

Core mutation gaps left by the full run (one replies schema case and six functions) get tests that fail when the code breaks.

<!-- Two to four sentences: what becomes true for a user or operator. -->

## Scope

- <!-- Boundary and starting seam, not an edit list. -->

## Out of scope

- <!-- Nearby work that is not part of this ticket. -->

## Acceptance

- <!-- One observable result or check per line. -->

## Notes

<!-- Optional decisions or open questions; no progress log. -->

## Outcome

The full core mutation run (score 94.25 %) left gaps. This ticket closes them with tests that fail when the code breaks.

## Scope

- Add a positive case that parses `language: "en"` in the replies schema; it kills the one survivor (`"en"` to `""`).
- Tests for six functions with new gaps: `slo_urgent_latency` (21), `slo_llm_errors` (18), `slo_backup_age` (5) in `texts/operator.ts`; `renderToolTable` (12) in `cli/render.ts`; `operatorEventSample` (12) in `ops/alert-text.ts`; module level of `cli/description.ts` (11).
- Source: `results/final.md` in the done folder of the core-gap ticket (F154).

## Out of scope

- Product code changes. Functions already classed equivalent or unreachable.

## Acceptance

- `mutation-gaps.ts --before --after` exits 0 for each changed file.
- Each of the six functions has fewer than 5 counted mutants, or each rest is classed with a reason.
- `bun run check:job` ends with PASS.
