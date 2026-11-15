# F110 stage 11 — Trust API and "Turn on recommended"

Part of [`../plan.md`](../plan.md).

## Step 1 — The trust view and its read route

- **Goal:** one read model feeds the card, the report page and M8 (PD-066).
- **Files:** `trust/view.ts` (`trustViewFor`); schema `trustViewSchema` in `packages/core/src/web/trust.ts`; route `GET /api/trust/:mailboxId` with `apiDoc`.
- **Interfaces:** `TrustView = { mailboxId, flag: boolean, key: EvidenceKey, mode, check: { status, reason, noResultReason, startedAt, finishedAt, checked, capped } | null, categories: Record<BarCategory, { auto, grantBy | null, global: GlobalEvidence, history: { outcome, acted, moved, upper, total, wouldMove } | null, trip: TripState, realLabels: { kept, precision, decision }, evidence: { eligible, recommended, blocks } }>, examples: Record<MovingCategory, { emailId, receivedAt, fromName, subject }[]> }`.
- **Decisions:**
  - `examples` = up to 3 acted-on items per moving category that the category would move, newest first. They show sender name and subject: the panel is behind login (Tailscale, ADR 0017); they never go to Telegram (D15). Texts cleared by retention → the item shows without subject.
  - Any member may read; a foreign or unknown mailbox → 404; `trust_ladder` off → 404 `not_found` (as `GET /api/stats`).
- **Test** (`apps/server/test/integration/web-trust.test.ts`):
  1. Owner and member read the view; a foreign mailbox → 404.
  2. Flag off → 404.
  3. A `done` check with a `fail` for `spam` → `spam.evidence.blocks` holds `history_fail`; `examples.spam` has the acted-on items (≤ 3).
  4. No check yet → `check: null`, history null, no history block.

## Step 2 — "Turn on recommended" and queue again

- **Goal:** one tap turns on every recommended category (P2, ADR 0028 point 4).
- **Files:** `trust/recommended.ts`; routes `POST /api/trust/:mailboxId/recommended` and `POST /api/trust/:mailboxId/history-check` (owner only, `apiDoc`).
- **Decisions:**
  - One transaction under the settings share-lock: mode `assist` when it is `shadow` (with `ASSIST_DEFAULT_SWITCHES`, as `setMode`), then for each category with `recommended` true and `auto` false: `auto` on, grant `by: "recommended"`, threshold from the gate file. A tripped category is never recommended (stage 01), so this path clears no trip. One audit row per change, `via: "web"`.
  - The evidence is computed inside the transaction (no stale read). Nothing recommended → 409 `nothing_recommended`, no change (the mode stays).
  - Answer: `{ turnedOn: BarCategory[], mode }` plus the new `TrustView`.
  - `history-check`: queues a check with reason `web`. Answers 202 with the check, or 409 `check_running` when one is open.
- **Test:**
  5. Shadow mailbox, `info` and `notification` recommended, `spam` blocked → mode `assist`, those two `auto` with grant `recommended`, `spam` unchanged; audit rows.
  6. Nothing recommended → 409, mode still `shadow`.
  7. A member → 403.
  8. Two taps at once → the second turns on nothing new and answers 409 or an empty `turnedOn` (no duplicate audit row).
  9. `history-check` while one is open → 409.
- **Check:** `bun test apps/server/test/integration/web-trust.test.ts && bun test apps/server/src/openapi-routes.test.ts`

## Done when

- The guard check of `spec/build.md` TRACK is in the final message.
- Proof (`s11`) prints `PROOF_OK`.

## Out of scope

Pages (stages 13, 14), M8 (stage 12).
