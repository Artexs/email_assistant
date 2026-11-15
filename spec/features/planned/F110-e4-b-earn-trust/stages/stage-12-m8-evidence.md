# F110 stage 12 — M8 evidence: holdout, history check, tripwire

Part of [`../plan.md`](../plan.md). Closes the M8 limit of `docs/capabilities/measurement.md` ("The holdout result, the history check and the tripwire are not in M8: F110").

## Step 1 — Stats route and CLI

- **Goal:** the M8 rows of `GET /api/stats` and `bun run stats:week` carry the three ADR 0028 sources (PD-066).
- **Files:** `reports` week service (M8 builder), the stats schema in `packages/core/src/web/`, `stats-week.ts` output; `reports` imports `trust` through the `sameLayerEdges` entry of stage 03.
- **Decisions:**
  - Each M8 row gains `global` (`decision`, `provisional`, `wilsonLower`, `cases`), `history` (`outcome`, `acted`, `moved`) or null, and `trip` (`tripped`, `reason`). The values come from `trustViewFor` (one reader). The row stays "evidence at the time of the call" (rule 9).
  - With `trust_ladder` off for the org, the new keys are null (the schema allows null), so the page and CLI look as today.
  - The CLI prints one extra line per category: `global <decision>[ provisional] · history <outcome> (<moved>/<acted>) · trip <reason|none>`.
- **Test** (extend `reports-metrics.test.ts` and `stats-week-cli.test.ts`):
  1. Flag on, a fixture gate index with `info` `go` provisional, a `done` check with `spam` `fail` (3/100), a `notification` trip `corrections` → the M8 rows show exactly those values.
  2. Flag off → the three keys are null; the existing assertions pass unchanged.
  3. The CLI line for `spam` reads `global no-go · history fail (3/100) · trip none`.

## Step 2 — Weekly report lines

- **Goal:** the Monday report shows per category its `auto` evidence (PD-066).
- **Files:** `packages/core/src/digest/weekly.ts` and its texts (en, pl).
- **Decisions:** one short line per bar category with `auto` on or a block: `<category>: auto on · proof <go|no-go|none> · check <outcome>` or `· paused (<reason phrase>)`. Fixed phrases only (D15). The message still fits 4096 characters with 5 categories and 3 mailboxes (cut the lines of the 3rd mailbox first, as the existing rule does; read it).
- **Test:**
  4. Render with all keys set, en and pl → one line per category; length ≤ 4096 with 3 mailboxes.
  5. Keys null → the report text is unchanged (snapshot of today's output).
- **Check:** `bun test packages/core/src/digest/weekly.test.ts apps/server/test/integration/reports-metrics.test.ts`

## Done when

- `docs/capabilities/measurement.md` rule 9 names the new keys (one sentence; stage 24 removes the limit line).
- Proof (`s12`) prints `PROOF_OK`.

## Out of scope

The stats page UI (it shows the keys only after a later ticket; the autonomy card in stage 13 is the user-facing place).
