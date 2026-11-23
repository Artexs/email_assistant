# F168 stage 03 — The queue model

Needs nothing of this ticket; it reads `@ea/core/web` approval types and `lib/approvals-view.ts`. May run next to 01, 02, 06, 07, 08.

Part of [`../plan.md`](../plan.md): D2, D3. Every queue rule and the outcome mapping, pure. The Opus review of stage 04 reads it too.

## Step 1 — `lib/approvals-queue.ts`

- **Files:** `apps/web/src/lib/approvals-queue.ts` (new) and its test. No other file.
- **Decisions:** no React, no `t()`, no clock (the caller passes `now`). Items are `ApprovalItem`. Reuse `approveMessage`, `closedTextKey`, `failureOutcome`, `stateLabelKey` and `endReasonKey`; copy none.
- **Interface (stage 04 uses it):**
  - `SENT_HOLD_MS = 1500`, `ARM_MS = 500` (D3).
  - `queueIds(items, skipped, ownIds): string[]`: the `waiting` ids in list order, without skipped ids and without `ownIds` (ids this page approved, rejected, replaced with a new version, or saw leave).
  - `nextFocus(items, { leaving, skipped, ownIds }): string | null`: the first of `queueIds` that is not `leaving`; `null` = the end card (skipped drafts left) or the empty page.
  - `progress({ done, waiting })`: `{ current: done + 1, total: done + waiting }`. `waiting` = the `waiting` items not in `ownIds`, skipped ones included. `done` = the approves and rejects of this page load; "Later" and a draft that left from another device do not count.
  - `vanished(items, focus: { id; openedAs: "waiting" | "held" }, ownIds): boolean`: the focus id is not in the list, or its state differs from `openedAs`, and the id is not in `ownIds`.
  - `armed(nowMs, cardShownAtMs): boolean`: `nowMs - cardShownAtMs >= ARM_MS`. A "card shown" is every change of the focused id, also an in-place version swap (409 `changed`, a `superseded` detail, edit, redraft, recipient change).
  - `expiredNow(item: { expiresAt: string | null }, now): boolean` (D9).
  - `outcomeOf(result): { text: Message; then: "hold" | "next-button" | "stay" | "reason"; openId?: string }`. `result` is the approve answer with the detail read after it, the reject answer with the `mistake_capture` flag, or the error. The table:

    | Result | `text` | `then` |
    | --- | --- | --- |
    | approve; detail `sent`, `sending`, `held` with no cause | `approveMessage` (the page adds "to {recipient}") | `hold` |
    | approve; detail `held` with a cause | `approveMessage` | `hold` |
    | approve; detail `rejected` or `expired` | `approveMessage` (closed text) | `hold` |
    | approve; detail `failed`, `waiting`, `superseded` or unreadable | `approveMessage` | `next-button` |
    | 409 `changed` with `currentId` | `appr_changed` | `stay`, `openId` |
    | 409 `closed` (also `sending` after a fresh lock), 404 | closed text / `appr_not_found` | `hold` |
    | 409 `draft_not_ready`, `has_gaps`, `feature_off`; other errors | `failureOutcome` | `stay` |
    | reject, flag on / off | `appr_done_rejected` | `reason` / `hold` |

  - `closedView(detail): { state: TextKey; reason?: TextKey; newest?: string }` for the closed card (P6): the state label, the end reason when the API gives one, `newest` = `currentId` of a `superseded` detail.
- **Tests** (ids `a`…`e`, list order a…e, all `waiting` unless named):
  1. `nextFocus` with `leaving: "a"` → `"b"`; with skipped `["b"]` → `"c"`; with skipped `["b","c","d","e"]` → `null`.
  2. `ownIds {"b"}`, `leaving: "a"` → `"c"` (a reload that lags still lists `b`).
  3. `c` is `held` → `queueIds` is `["a","b","d","e"]`.
  4. `progress({ done: 1, waiting: 4 })` → `{ current: 2, total: 5 }`; after "Later" on `a` with nothing decided: `{ current: 1, total: 5 }`.
  5. `vanished`: `b` gone, `ownIds` empty → `true`; `ownIds {"b"}` → `false`; `b` opened `waiting`, now `held` → `true`; `b` opened `held`, still `held` → `false`.
  6. `armed(1499, 1000)` → `false`; `armed(1500, 1000)` → `true`.
  7. `expiredNow` with `2026-11-24T10:00:00.000Z`: at `09:59:59.999Z` → `false`, at `10:00:00.000Z` → `true`; `null` → `false`.
  8. `outcomeOf`: one case per table row; the 409 `closed` `sending` case → `hold`.
  9. `closedView` for each of `sent`, `rejected`, `expired` with `endReason: "answered"`, `failed`, `superseded` with `currentId`: the state key, the reason only for `expired`, `newest` only for `superseded`.
- **Check:** `bun test apps/web/src/lib/approvals-queue.test.ts`; break `nextFocus` once (ignore `ownIds`) and see test 2 fail.

## Done when

Tests 1–9 pass; `mkdir -p /tmp/f168-03 && bun run check:job > /tmp/f168-03/check.log 2>&1 && echo PROOF_OK` prints `PROOF_OK` (no UI change).
