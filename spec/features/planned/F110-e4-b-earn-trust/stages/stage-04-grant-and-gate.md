# F110 stage 04 — Grant and evidence gate `[risky]`

Part of [`../plan.md`](../plan.md). Risk: it decides when mail moves without the user. Flag `trust_ladder` added here.

## Step 1 — The grant in the category policy and in triage

- **Goal:** every `auto` on records the key it was granted on; triage moves only under that key (D7).
- **Files:** `categoryPolicySchema` in `packages/core/src/triage/settings.ts` (optional `grant`); `config` service (`setCategoryAuto` writes or clears the grant; audit data of `mailboxPolicyChanged` gains `grant.by` and the key fields); the `autoFor` call that feeds `decidePolicy` in `triage/service.ts`.
- **Interfaces:** `CategoryGrant`, `effectiveAutoFor(policy, category, runningKey)` ([interfaces.md](../interfaces.md)). `auto: false` removes the grant. Old rows without `grant` still parse.
- **Decisions:** D7. The triage service gets the running key from its deps (stage 02 wiring), never from env at call time.
- **Test:**
  1. Unit: `effectiveAutoFor` true when `auto` and the grant key equal the running key; false when only `endpoint` differs; true for `auto` with no grant.
  2. Integration (`triage-job` pattern): a mailbox in `assist`, `notification` on `auto` granted on key A, the worker runs on key B → the `move` action is `logged`, not `ready`.
  3. Same with key A → `ready`.

## Step 2 — The evidence gate behind `trust_ladder`

- **Goal:** with the flag on, turning `auto` on follows D5, not the real-label gate alone.
- **Files:** new `trust/gate.ts` with `setCategoryAutoWithEvidence(deps, ctx, mailboxId, input)`; the route that serves `PATCH .../auto/:category` calls it when `trust_ladder` is on for the org, else the old `setCategoryAutoWithGate`. Inject the function into the route deps from the composition root (`web.ts`); the lower module does not import `trust`.
- **Interfaces:** input as `setCategoryAutoWithGate` (`category`, `auto`, `force`, `threshold?`, `actor`). Result `{ kind: "changed", change, evidence } | { kind: "refused", evidence }`, where `evidence` is the `autoEvidence` result plus the global row. The refused answer body keeps the `no_go` code the web dialog already handles and adds `blocks: EvidenceBlock[]` (update the schema in `packages/core/src/web/settings.ts` and its `apiDoc`).
- **Decisions:**
  - D5. Inputs: `globalEvidenceFor(index, runningKey)`, `historyResultFor`, `activeTripsOf`, `realGoNoGoRows`.
  - `force: true` on a refused category → `auto` on with `grant.by = "forced"`; the audit row keeps `forced: true` and the block list.
  - An eligible on → `grant.by = "evidence"`; the threshold = the gate file's category threshold when set, else the current one.
  - Turning `auto` on clears the active trips of that category in the same transaction as the policy write (give `setCategoryAuto` an optional in-transaction callback; do not open a second transaction). An active trip alone does not refuse a manual switch (stage 01: `eligible` ignores `tripped`).
  - Flag off (review 1 N5): the old `setCategoryAutoWithGate` also writes a grant with the running key (`by: "evidence"` on a real-label `go`, `"forced"` with force) and clears trips through the same callback. The composition root injects the clear, so `triage` does not import `trust`.
  - `auto: false` never reads evidence.
- **Test** (`apps/server/test/integration/trust-gate.test.ts`, a fixture gate index in the deps):
  1. Flag on, global `go` non-provisional for `notification`, no history, no labels → `changed`, grant `evidence`, threshold from the file.
  2. Flag on, global provisional `go` → `refused`, blocks `["global_provisional"]`; same with `force` → `changed`, grant `forced`, audit `forced: true`.
  3. Flag on, history `fail` for `spam` → `refused` `["history_fail"]`.
  4. Flag on, global `go`, an active trip `corrections` → `auto` on without force, grant `evidence`, the trip has `cleared_at` set; one transaction (a forced error after the policy write leaves both unchanged).
  5. Flag off → the old real-label behaviour (the existing `triage-gate.test.ts` cases pass); the stored grant has `by: "evidence"` or `"forced"` and the running key; an active trip is cleared.
  6. A member (not owner) → 403, as today.
- **Check:** `bun test apps/server/test/integration/trust-gate.test.ts apps/server/test/integration/triage-gate.test.ts`

## Done when

- The flag `trust_ladder` exists in `features.ts` (epic `E4-B`, remove-by 2027-03-01).
- The guard check of `spec/build.md` TRACK (remove each guard, see its test fail) is in the final message.
- Proof (`s04`) prints `PROOF_OK`.

## Out of scope

"Turn on recommended" (stage 11), the re-gate job (stage 08), the web card (stage 13).
