> **Status 2026-11-11 — planned — idea from `state-machine-transitions` (decision D3).** Left: the user decides if and when; then a plan with stages. `[risky]`.

# `actions.status` writers read the transitions map at runtime

Scope: follow-up of `tasks/done/state-machine-transitions.md` (D3: the runtime step is a separate `[risky]` task). Needs: `tasks/done/state-machine-transitions.md` (merged 2026-11-11).

## Goal

The writer functions in `apps/server/src/modules/actions/repo.ts` take their guard (the `from` statuses per type) from `actions/transitions.ts`, or check `canTransition` before each write. Optionally close the latent edges L1–L8 and the extra latent edges of stage 2 (see the task above).

## Why

- Today the map is data plus tests (test A unit, test B and C integration). The guards in SQL and the map are two copies; the tests catch drift, but only for writers that the tests know.
- A brand-new writer function that writes `actions.status` fails no test (the "no source parsing" rule forbids a scan). Only the rule in `docs/code-patterns.md` § Data access covers it. A runtime check closes this gap.
- `actions` sends mail to real people (exactly-once drafts, at-most-once send, `docs/architecture.md` §4.1 rule 6): every guard change is `[risky]`.

## Done when

- Each status writer in `actions/repo.ts` builds its `WHERE status IN (…)` list from `WRITER_GUARDS` (or calls a shared helper), with no behavior change for the edges E1–E20.
- Each closed latent edge has a test that proves the guard now rejects it.
- `bun run lint && bun run typecheck && bun run test:unit && bun run test:int` passes.

## Open points from the build (2026-11-11)

- `PAIR_RULES.test` holds `<file> › <title>` text; test A checks only the format. A renamed test breaks the link without a failure.
- The `reverses_action_id IS NULL` guard of `expireReadyDraft` and `expireStaleReady` has no field in the map and no reverse-row test case.
- Optional small test gaps: `status_reason` per `expireReadyOriginals` reason; a boundary row `locked_at = staleBefore`.
- Other machines of the inventory (`notes/2026-11-11-implicit-state-machines.md`): `emails` location flags, `mailboxes.status`, `delegations.status`. Each gets its own task only when the user asks.

## Plan

<written when the task starts>

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture §4.6, code-patterns); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-11: idea written at the end of `state-machine-transitions` (D3, and the group review findings).
