# F112 stage 14 — Flag and card logic

Part of [`../plan.md`](../plan.md). Read P4, P9, D12. Needs stage 13.

One step. Stage 15 builds the UI on this interface.

## Step 1 — Flag, `whatsNew`, storage

- **Goal:** the card rules of P9 as one pure function, the flag, and the storage helpers.
- **Files:** `packages/core/src/features.ts` (flag), `apps/web/src/lib/whats-new.ts` (new) and test.
- **Interfaces:**
  - Flag `docs_links`: `{ default: false, description: "The Help link and the What is new card in the panel.", epic: "E10a", removeBy: "2027-06-01" }`.
  - `whatsNew(releases: ChangelogRelease[], stored: string | null): { show: ChangelogRelease[]; newest: string | null }`: `Unreleased` is ignored; `newest` = the highest released version or `null`; `show` follows P9.
  - `whatsNewKey(userId: string): string` = `ea.whatsNewSeen:<userId>` (per member, so two members in one browser each see the card).
  - `readSeen(storage: Storage, userId): string | null | "unavailable"` and `writeSeen(storage, userId, version): boolean`: any throw → `"unavailable"` / `false`. The UI shows no card on `"unavailable"`.
- **Test** (releases as versions with one "For users" item each unless named):
  - T1: `[0.2.0, 0.1.0]`, stored `null` → show `[0.2.0]`, newest `0.2.0`.
  - T2: same, stored `0.1.0` → `[0.2.0]`.
  - T3: `[0.3.0, 0.2.0, 0.1.0]`, stored `0.1.0` → `[0.3.0, 0.2.0]`.
  - T4: stored `0.2.0` → `[]`; stored `0.9.0` → `[]` (downgrade).
  - T5: stored `garbage` → `[0.2.0]` (as no stored version).
  - T6: only `Unreleased` → `[]`, newest `null`.
  - T7: `[0.2.0 (no items), 0.1.0]`, stored `0.1.0` → `[]`, newest `0.2.0`.
  - T8: seven releases newer than stored → 5 shown, newest first.
  - T9: `whatsNewKey("u1")` = `ea.whatsNewSeen:u1`; a storage whose `getItem` throws → `readSeen` = `"unavailable"`; `setItem` throws → `writeSeen` = `false`.
  - T10: the flag registry test passes with `docs_links` (default off, epic, date).
- **Done when:** T1–T10 pass.
- **Out of scope:** any UI (stage 15).

## Proof

The plan's chain with `NN` = `14`.
