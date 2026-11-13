# F086 · Open defaults (owner to confirm)

None of these blocks the build. Each is a numbered decision in [plan.md](plan.md) § Input. Change one before stage 03 starts (D10–D12 shape `layers.json`) or stage 05 (D19).

1. **D10 Three more same-layer edges.** The code has `tenancy → audit`, `mail → config` and `channels → reports` inside one layer of the review's layer list. Default: name them in `sameLayerEdges` with their reason (no code change). Option: one layer per module (changes the review's layer list).
2. **D11 Test files are outside the borders.** `mail/views.test.ts` imports `../actions`; `apps/server/test/` imports module internals 138 times. Default: the lint and the graph skip `*.test.ts`. Option: lint tests too (a large test refactor, not in scope).
3. **D12 Two e2e seed scripts keep a deep import.** `scripts/e2e-seed.ts` and `scripts/e2e-activity-rows.ts` import credential and folder inserts from `mail/repo`. Default: an exception list in `layers.json` with a reason. Option: export these inserts from the `mail` index (a wider public API for a test seed).
4. **D19 New-table rule names what exists.** The organization delete and the DSR map do not exist yet (E7-T3). Default: the rule asks for tenant-filter tests and retention now, and a note for E7-T3. Option: wait with the rule until E7-T3.
5. **D9 No `import/no-cycle`.** It ignores type-only imports and reports the 9 in-module cycles. Default: the zones plus the cycle checks in `layers.test.ts` cover cycles between modules. Option: add it with `maxDepth` and accept the in-module noise.
