---
opened: 2026-11-13
---

# F095 · E1 Close the MVP (capability map, docs boundary, NEXT sweep of the old planned tickets)

## Outcome

The MVP (S0–S6a) is closed: its open pilot proofs have numbers, every document states one goal (sell-ready, not sold), and later planners get an exact baseline of what the system does today, one page per capability. The board lists every open ticket with its epic or verdict, so the Stage 2 build has one order.

## Scope

- Boundary text of PD-001 in the vision, the product brief, the roadmap and the architecture doc.
- `docs/capabilities/`: ten pages, an index, a unit test that keeps paths, scripts and ADR numbers true; the behaviour detail of `docs/architecture.md` moves into the pages (review `06` §3.14).
- The NEXT block for `spec/build.md`, pointers from the old S6 task files to the E7 tickets, the ADR index, the stale code map.
- The pilot results on the home VPS (read-only): the S6a deploy day check, the S3 assist week (F037), the S4 pilot week counts (F047 part B), and one real delegation round trip with the owner (F047 part A).

## Out of scope

- Any new feature (epic page). S6b–S6f work (F082, E7 tickets). The five target-executive conversations (PD-007, the owner's call).
- Editing `spec/build.md` directly: the coordinator applies `next.md`.

## Acceptance

- `docs/capabilities/` holds ten pages and an index; `bun run test:unit:ci` passes with `apps/server/src/capability-map.test.ts`.
- `docs/architecture.md` §4.4–§4.6 and the detail of §4.1 rules 6–8 and §8 are link lines to the pages.
- The boundary greps of stage 01 step 3 hold.
- `spec/build.md` NEXT names every folder of `planned/` and `active/` once, with its epic or verdict.
- F037 and F047 `plan.md` § Results hold the week tables and the part A facts; `docs/roadmap.md` S3 and S4 lines hold the results.
- Full list: `plan.md` § Done when (8 items).

## Slices

One worker job per stage, `stages/stage-01` to `stage-10`, each landed with `limen land --keep-open`. Stages 01–07 run in order (all edit `docs/architecture.md`). Stage 08 may run after stage 02; stage 09 after stage 01 and not before 2026-11-14T22:40Z. Stage 10 needs the owner (U1). No migration, no `bun.lock` change. Details: `plan.md` § How to run.

## Sequenced

- Plan after: none.
- Build after: none (F077, the S6a customer core, is in `done/`).
- Gate: Owner U1 (F047 part A phone session) before stage 10 only; stage 09 waits for 2026-11-14T22:40Z. The vision text is applied by default (PD-001; `questions.md` Q2).

## Notes

Source: `docs/product/stage-2/05-execution-plan.md` §2.1 row 1; epic page `docs/product/stage-2/epics/E01-close-the-mvp.md` (no discovery notes file exists for E1). Every other Stage 2 ticket builds after this one. Open defaults: `questions.md`.
