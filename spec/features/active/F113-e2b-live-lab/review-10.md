# F113 stage 10 review (Opus), result PASS with test gaps

Reviewed commit `ddccffbc`. No blocking finding. Source: `.limen/jobs/2026-11-15-f113-review-s10-opus-executive-d-ecd85658/result`.

## Test gaps and how they closed (commit after `ddccffbc`)

- **TG1** `tap_repeat` had no test (mutation o5 passed). Closed: test "TG1" (two digests, same moved urgent mail: one `fu:`, one `skip tap_repeat`). Mutation o5 now fails it.
- **TG2** no end-to-end `tap_gone`, stopped run, `as:`, `ag:`. Closed: tests "TG2" for each. `as:` and `ag:` run through the real runtime notices and the fake.
- **TG3** test 2 passed without `tap_intent` (mutation o1). Closed: test 2 asserts the event order planned, intent, done for `ar:` and `rw:p:`. Mutation o1 now fails it.

## Notes

1. At most once is correct by code and mutation. The intent is on disk before the press; `tap_gone` means "not delivered".
2. No lock in the driver. Two parallel ticks could double press. Stage 11 carry-over: the serve lock covers the executive.
3. Forbidden prefixes are guarded in core only; the driver has no allow-list. The core tests are enough (mutation o4 fails 7 tests).
4. `lookupCard` adds no org filter of its own; each callee filters by org. The direct `lookupCard` test checks all three branches against another org.
5. Tap time uses `deps.now()` at read time, not the card time. No double press follows.
6. A fake restart can lose cards, by design. The scorer counts expired approvals (stage 11 carry-over).
7. First-tick order versus injector (board drift): stage 11 carry-over.
8. A single reminder card (no `set_id`) maps to draft kind `other`, so the executive rejects it with "not needed". The chaser makes sets in the lab, so the effect is small. `ag:` after `outcome_unknown` may send a second copy in the sim (Q6 default).
9. Wiring and logs are clean: no logger calls, events hold ids and codes only.
10. Docs match the code. A merge with master conflicts only in `docs/capabilities/live-lab.md` (3 hunks). Master adds the injector as rule 8, so the driver becomes rule 11 at the land; Limits must drop "injector" and "executive driver"; the test list keeps both lab-injector and lab-executive. A later continue merges master.
