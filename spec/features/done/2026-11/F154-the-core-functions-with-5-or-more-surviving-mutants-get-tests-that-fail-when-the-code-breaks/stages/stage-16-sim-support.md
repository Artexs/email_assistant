# F154 stage 16 — sim fixtures, manifests, language detect, eval cases

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–15, 17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Through (exported) | Count |
| --- | --- | --- | --- |
| `sim/fixtures.ts` | `sentFixtureText` | itself | 11 |
| `sim/lang.ts` | `detectLang` | itself | 10 |
| `sim/manifest.ts` | `byId` (private) | `partHash` (input order must not change the hash) | 9 |
| `sim/manifest.ts` | `freezeIssues` | itself | 5 |
| `sim/to-eval-case.ts` | `threadOf` (private) | `toEvalCase` (its `thread` field) | 8 |
| `sim/plan-bank.ts` | `buildSlot` | itself | 7 |
| `sim/sent-manifest.ts` | `byId` (private) | `sentPartHash` | 6 |
| `metrics/fixtures.ts` | `hiddenMoveRow` | itself | 5 |

Mutate globs: one per file above.

Note: some `sim` tests read `evals/sim/lab-01/scenario.json` and `sent-plan-spec.json`; `mutation.sh` copies only those two. A new case that needs another lab file fails inside the mutation run: build its input inline.

## Cases (fixed values)

1. `sentFixtureText`: a slot with `style.signature: true` and an executive signature → the text ends with the signature; `signature: false` → no signature; `signature: true` with an empty executive signature → none (kills `||` vs `&&`).
2. `detectLang`: `"Dzień dobry, proszę o fakturę"` → `"pl"`; `"Hello, please send the invoice"` → `"en"`; `"12345"` → `"unknown"`; a tie text → the code's result at `HEAD`.
3. `byId` through `partHash` and `sentPartHash`: slots in order `b`, `a` give the same hash as `a`, `b`; a changed text gives another hash; equal ids are `equivalent` (plan D5) when ids are unique by schema.
4. `freezeIssues`: one row per issue the function emits, with the exact message.
5. `threadOf` through `toEvalCase` (the `thread` field): a case with no parents → `[]`; one parent → that thread (kills `parents.length >= 0`).
6. `buildSlot`: a fixed RNG seed → the exact slot fields the mutants hit.
7. `hiddenMoveRow`: the exact row object.

## Done when

- `results/stage-16.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- Lab data files under `evals/`. `sim/live` (stage 17).
