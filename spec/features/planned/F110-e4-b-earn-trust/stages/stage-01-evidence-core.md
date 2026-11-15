# F110 stage 01 — Evidence core

Part of [`../plan.md`](../plan.md). Pure code in `packages/core`; no DB, no server.

## Step 1 — Types and the history outcome

- **Goal:** the shared evidence types and the D4 rule as pure functions.
- **Files:** new `packages/core/src/trust/` (index exported from `@ea/core`).
- **Interfaces:** `EvidenceKey`, `sameKey`, `movingCategories`, `GlobalEvidence`, `HistoryOutcome`, `historyOutcome` ([interfaces.md](../interfaces.md) § Core). Reuse the Wilson function that the eval code already has (grep `wilson`); do not write a second one. If it lives in `apps/server`, move it to core and keep the old import working.
- **Decisions:** D3, D4.
- **Test** (`trust/history.test.ts`):
  1. `{acted: 49, moved: 0}` → `no_result`, `upper` null.
  2. `{acted: 50, moved: 0}` → `inconclusive` (upper ≈ 0.0713).
  3. `{acted: 189, moved: 0}` → `pass` (upper ≤ 0.02).
  4. `{acted: 188, moved: 0}` → `inconclusive`.
  5. `{acted: 100, moved: 3}` → `fail` (share 0.03).
  6. `{acted: 100, moved: 2}` → `inconclusive` (share 0.02 is not over 0.02).
  7. `sameKey` is false when only `endpoint` differs, and false when only `reasoningEffort` differs (`null` vs `"none"`).

## Step 2 — Eligibility and the tripwire rule

- **Goal:** one pure function that every reader (gate, card, report, M8, re-gate) calls.
- **Interfaces:** `autoEvidence`, `EvidenceBlock`, `TripState`, `tripwireDue` ([interfaces.md](../interfaces.md)). `realLabels` is `{ kept: number; decision: "go" | "no-go" | "too-few" }`; it blocks only when `kept >= 30` and `decision === "no-go"` (use the existing `EVIDENCE_MIN_LABELS` or `GATE_MIN_KEPT` constant).
- **Decisions:** D5, D9. `blocks` lists every block in the order of the `EvidenceBlock` union; `eligible` = `blocks` is empty; `recommended` = eligible and the category is in `movingCategories`. `history` may be null (no check yet) and then does not block.
- **Test** (`trust/evidence.test.ts`, `trust/tripwire.test.ts`):
  1. Global `go`, non-provisional, history `pass`, no trip, labels `kept 0` → eligible, recommended for `notification`.
  2. Same for `urgent` → eligible, not recommended.
  3. Global `go` provisional → blocks `["global_provisional"]`.
  4. Global `none` → `["no_global"]`; global `no-go` → `["global_no_go"]`.
  5. History `fail` and an active trip → `["history_fail", "tripped"]`.
  6. History `inconclusive` or `no_result` or null → no history block.
  7. Labels `kept 30`, `no-go` → `["real_labels_no_go"]`; `kept 29`, `no-go` → no block.
  8. `tripwireDue`: grant at 2026-11-01T10:00Z, now 2026-11-08T09:00Z, corrections at 11-02 and 11-07 (not important) → `corrections`.
  9. Same, corrections at 11-01T09:00 (before the grant) and 11-07 → null.
  10. Corrections at 10-31 and 11-07T10:00 with now 11-08T11:00 and grant 10-01 → null (more than 7 days apart: the window is the last 7 days before `now`).
  11. One correction with `important: true` after the grant → `important_hidden`.

## Check

`bun test packages/core/src/trust`

## Done when

- The cases above pass, and nothing outside `packages/core` changes except a moved Wilson import.
- Proof (`plan.md` § Proof, `sNN` = `s01`) prints `PROOF_OK`.

## Out of scope

Reading gate files (stage 02), any DB access, texts.
