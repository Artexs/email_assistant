# E1 · Close the MVP

> Tier: Must. Status: ready to plan (no open product questions). Size: about 10 stages, 1k lines, mostly docs and runs.

## Outcome

The MVP (S0–S6a) is deployed, its open proofs have run, every document states the same goal, and the epic sessions have an exact baseline of what the system does today.

## Users

Owner (operator and pilot user); the next planning agents.

## In scope

- F077 stage 18: S6a checkpoint and VPS deploy with the owner's go.
- F037 and F047 part B on 2026-11-14 (one-week counts); F047 part A: one real delegation round trip on the phone (about 15 min).
- Docs agree on the boundary (PD-001): apply the `02` §7 text to `spec/vision.md` (owner-owned: propose, then apply with OK) and `docs/product-brief.md` Q1; `docs/roadmap.md` §1 and §5 updated.
- `spec/build.md` NEXT gets an order for the 34 planned tickets: keep, fold into an epic, or drop. Move `tasks/active/s6-pre-sale.md` and `tasks/planned/s6*` references into E7.
- Capability map (PD-009): one page per capability (sync, triage, actions and Undo, drafts and send, delegation, digest and notices, web panel, tenancy and plans, retention, backups): what it does now, rules, entry points, limits, ADR links. Built from `02` §2 and the code.
- Optional (PD-007): five conversations with target executives (mail provider, volume, what they fear to miss, who handles their inbox). Result as a note.

## Out of scope

Any new feature. S6b–S6f (E7). The simulator (E2).

## Dependencies

None. Blocks E2, E4, E7, E8.

## Open product questions

- PD-007: do the five conversations, and when. Owner's call.

## Risks

- F047 A on real mail sends a real delegation from the owner's address: pick a safe delegate (own Gmail, as today).
- The vision file is owner-owned: an agent proposes text, the owner applies or says "apply".

## Exit

- F077 landed and deployed; F037, F047 A and B results in their tickets.
- `grep -l "SaaS for sale\|first external customer" docs/*.md spec/vision.md` returns nothing stale.
- `docs/capabilities/` exists with one page per capability; `spec/build.md` NEXT lists every planned ticket with its epic or "dropped".
