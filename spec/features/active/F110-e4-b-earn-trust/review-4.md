# F110 stage 04 review (Opus 5.5, FAIL 3bb60d92)

Model: Opus 5.5, because the stage is [risky] (it decides when mail moves without the user).

BLOCKING (repair, then a narrow Opus re-review):
- B1 (proven by probe on the real reader): with `trust_ladder` on, a non-provisional global `too-few` category passes the evidence gate: `autoEvidence` (`packages/core/src/trust/evidence.ts`) blocks only `none`, `no-go` and `provisional`; stage 01 test `evidence.test.ts:44` says "a too-few global does not block by itself". The gate file value `"no-go: too few"` maps to `too-few` (`triage/evidence.ts:35`). Result: `auto` turns on with grant `evidence`, no force, `recommended: true` (D5 and ADR 0028 §1 say eligible = non-provisional global go). Coordinator decision: a `too-few` global BLOCKS: map it to the block code `global_no_go` (no interface change). Change the stage 01 test, add a flag-on case to `trust-gate.test.ts` (non-provisional `too-few` gives `refused`), and add `recommended: false` for it.

TEST GAPS (fix in the repair, each with a mutation): TG1 (trip clear when nothing changed: `auto` already on under the running key, an active trip, the user turns it on again: the `!changed` branch of `applyChange` must still clear the trip: test; mutation MA), TG2 (the trip read is scoped to the category: a trip on another category must not block: mutation MW), TG3 (flag off, `auto: false`, an active trip: no trip clear: mutation MN), TG4 (a grant that is not forced has no `blocks` in the audit row: mutation MQ).

Carry-over:
- N1 (stage 09): a trip can race with a grant: `clearTrips` runs under the settings lock at READ COMMITTED, a trip insert committing after that UPDATE stays active for the new grant; insert the trip under the settings lock, or ignore trips whose `granted_at` is not the current `grant.at`.
- N2 (stage 08): a model or prompt change does not expire `ready` move or `mark_read` rows written under the old key: the re-gate stage must decide.
- N3/N4 (stage 13): the settings view and CLI `show` print the stored `auto` (a category on under another key does not move mail); a refused 409 can show the `gate` "passed" text next to `blocks`: the new card must show the blocks.
- N5: audit `grant_*` omits `promptParts` and `host` (the policy row keeps the full key). N6: the running key comes from `productionClassifierChoice()`, not from the triage job's prompt: a caller that injects `prompt` could drift. N7: `CategoryGrant.at` is any string, not a checked ISO instant (stage 09 uses it as the trip's `granted_at`). TG5: the lab demo export has no delete test of its own (no personal data; an import under another key is `auto` off by design).
