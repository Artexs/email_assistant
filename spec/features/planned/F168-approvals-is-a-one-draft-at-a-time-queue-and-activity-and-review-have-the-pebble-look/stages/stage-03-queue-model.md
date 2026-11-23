# F168 stage 03 — The queue model

Needs nothing of this ticket; it reads only `@ea/core/web` approval types. May run next to 01, 02, 06, 07, 08.

Part of [`../plan.md`](../plan.md). A pure module that holds every queue rule, so stage 04 wires a page with no rule of its own (D2). The Opus review of stage 04 reads this module too.

## Step 1 — `lib/approvals-queue.ts`

- **Files:** `apps/web/src/lib/approvals-queue.ts` (new) and `approvals-queue.test.ts`. No other file.
- **Interface (stage 04 uses it):**
  - `SENT_HOLD_MS = 1500`, `ARM_MS = 500` (D3).
  - `queueIds(items: readonly ApprovalItem[], skipped: readonly string[]): string[]`: the `waiting` ids in list order, without the skipped ids (P1, P5).
  - `nextFocus(items, { leaving: string | null; skipped }): string | null`: the first of `queueIds` that is not `leaving`; `null` means the end card (P5) or the empty page.
  - `progress({ done: number; waiting: number }): { current: number; total: number }`: `current = done + 1`, `total = done + waiting`. `done` counts the decisions of this page load; "Later" does not change it.
  - `vanished(items, focusId: string, ownIds: ReadonlySet<string>): boolean`: the focus is no longer a `waiting` item of the list and is not in `ownIds` (the ids this page approved, rejected or replaced with a new version) (P7).
  - `armed(nowMs: number, cardShownAtMs: number): boolean`: `nowMs - cardShownAtMs >= ARM_MS` (D3).
  - `expiredNow(item: { expiresAt: string | null }, now: Date): boolean`: `expiresAt` is set and `now ≥ expiresAt` (D9).
- **Decisions:** no React, no `t()`, no clock: the caller passes `now`. Items are `ApprovalItem` of `@ea/core/web`.
- **Tests** (ids `a`…`e`, list order a, b, c, d, e, all `waiting` unless named):
  1. `nextFocus` with `leaving: "a"`, no skips → `"b"`.
  2. Skipped `["b"]`, `leaving: "a"` → `"c"`.
  3. Skipped `["b", "c", "d", "e"]`, `leaving: "a"` → `null`.
  4. `c` is `held` → `queueIds` is `["a", "b", "d", "e"]`.
  5. `progress({ done: 1, waiting: 4 })` → `{ current: 2, total: 5 }`; `progress({ done: 0, waiting: 0 })` → `{ current: 1, total: 0 }` (the page shows no progress then).
  6. `vanished` with `b` gone and `ownIds` empty → `true`; with `ownIds` `{ "b" }` → `false`; with `b` present as `held` → `true`.
  7. `armed(1499, 1000)` → `false`; `armed(1500, 1000)` → `true`.
  8. `expiredNow` with `expiresAt` `2026-11-24T10:00:00.000Z`: at `09:59:59.999Z` → `false`, at `10:00:00.000Z` → `true`; `expiresAt: null` → `false`.
- **Check:** `bun test apps/web/src/lib/approvals-queue.test.ts`; break `nextFocus` once (return the skipped id) and see test 2 fail.

## Out of scope

The page, the components, the texts (stages 01 and 04).

## Done when

Tests 1–8 pass; `mkdir -p /tmp/f168-03 && bun run check:job > /tmp/f168-03/check.log 2>&1 && echo PROOF_OK` prints `PROOF_OK` (no UI change, so no build and no e2e).
