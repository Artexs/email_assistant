# F100 stage 13 — Reject reasons and the mistake mark: core and service

Part of [`../plan.md`](../plan.md). Review job before the land (a service that writes labels of mistakes; owner rules). Needs stages 04 and 09 on `master`. Not next to stage 15 (both edit `packages/core/src/digest/callback.ts`); runs after F097 stages 03–04 when they build (same file): merge `master` before the proof.

After this stage the pure parts exist (the flag `mistake_capture`, two callback kinds, the card edit lines, the "⚠️ This was a mistake" button on a sent result) and two service functions in `actions` write one `action_feedback` row each (D21). Stage 14 wires them to Telegram, the notices and the web.

## Step 1 — Core: flag, callbacks, card edits, send-result button

**Goal.** The pure parts: the flag, two callback kinds, the edit lines, the button on the send result (D21, D26).

**Files.** `packages/core/src/features.ts` (+ test) and the three tests that list every flag (plan § Rules for every stage), `packages/core/src/digest/callback.ts` (+ test), `packages/core/src/digest/action-feedback.ts` (new: `REJECT_REASON_TEXTS`, the button texts, `reasonButtons(actionId)` and `mistakeButton(actionId)`; `approvals.ts` is 439 lines, plan F13) + test, `packages/core/src/digest/approvals.ts` (`approvalEdit`, `renderSendResult`: only the new outcome cases and the button call) (+ test), `packages/core/src/notices/views.ts` (`send_result` view), `packages/core/src/notices/renderers.ts` (pass the field), `packages/core/src/metrics/m3.ts` (reuse `rejectReasons`; do not define them twice).

**Interfaces.**

```ts
// features.ts
mistake_capture: {
  default: false,
  description: "Reason buttons after a reject and a 'this was a mistake' button on a sent mail.",
  epic: "E3a",
  removeBy: "2027-03-01",
},

// callback.ts — two more approval-style kinds (the owner check of approval taps applies).
| { kind: "reject_reason"; reason: RejectReason; actionId: string } // rw:<p|c|n>:<uuid>  p = wrong_person, c = wrong_content, n = not_needed
| { kind: "mistake"; actionId: string }                             // mk:<uuid>

// approvals.ts — approvalEdit input gains `reason?: RejectReason` and `reasonButtons?: boolean`; outcomes gain:
//   "rejected" with reasonButtons (needs `actionId`) → the same line and one row of three buttons
//     [✖️ Wrong person | ✖️ Wrong content | Not needed] with rw: callbacks
//   "rejected_reason" → `✖️ Rejected. Reason: ${REJECT_REASON_TEXTS[reason]}.` and no buttons (no clock: the tap time is not the reject time)
//   "marked_mistake"  → `⚠️ Marked as a mistake ${time}.` and no buttons
export const REJECT_REASON_TEXTS: Record<RejectReason, string> = {
  wrong_person: "wrong person",
  wrong_content: "wrong content",
  not_needed: "not needed",
};
// Button texts: "✖️ Wrong person", "✖️ Wrong content", "Not needed".

// renderSendResult input gains `mistakeButton?: boolean`; result kind "sent" with it → buttons
//   [[{ text: "⚠️ This was a mistake", data: encodeCallback({ kind: "mistake", actionId }) }]]
// views.ts: sendResultView gains `mistakeButton: z.boolean().optional()` (optional: rows queued in the last 24 h stay valid).
```

`approvalEdit` is the shared edit renderer (`renderNoticeEdit`); it keeps the stored card text and adds one status line (code patterns § Notices are facts). The texts follow plan D31: when `packages/core/src/texts/approvals.ts` exists (F098 stage 09), `REJECT_REASON_TEXTS`, the button texts and the new edit lines are entries of that section (en and pl), and `approvalEdit` takes `texts` as F098 left it; else they stay English in `digest/action-feedback.ts`.

**Decisions.** D21, D26.

**Test** (unit; `id = "11111111-2222-4333-8444-555555555555"`):

1. `encodeCallback({ kind: "reject_reason", reason: "wrong_content", actionId: id })` → `rw:c:${id}`; `parseCallback` gives it back; `rw:x:${id}` → null; `mk:${id}` ↔ `{ kind: "mistake", actionId: id }`; every old prefix still parses (existing cases green); byte length ≤ 64.
2. `approvalEdit({ outcome: "rejected", reasonButtons: true, … })` → line `✖️ Rejected HH:MM.` and 3 buttons with data `rw:p:…`, `rw:c:…`, `rw:n:…`; without `reasonButtons` → no buttons (old behaviour).
3. `approvalEdit({ outcome: "rejected_reason", reason: "wrong_person", … })` → last line `✖️ Rejected. Reason: wrong person.`, no buttons.
4. `renderSendResult({ result: { kind: "sent", … }, mistakeButton: true, … })` → one button `mk:<id>`; `mistakeButton` absent → no button; result `failed` with `mistakeButton: true` → only its old buttons.
5. `noticeViewSchemas.send_result` accepts a view without `mistakeButton` (an old row) and with it.
6. `featureFlags.mistake_capture.default === false`, epic `E3a`.

**Check.** `bun test packages/core/src/digest/ packages/core/src/notices/ packages/core/src/features.test.ts apps/server/test/integration/tenancy-features.test.ts apps/server/test/integration/web-operator.test.ts apps/server/test/integration/org-flag-cli.test.ts`

**Done when.** Cases 1–6 pass.

**Out of scope.** Server handling (steps 2–3).

## Step 2 — Service and repository

**Goal.** Two service functions in `actions`, each one transaction with an audit row (D21).

**Files.** `apps/server/src/modules/actions/repo/feedback.ts` (new) + `repo/index.ts`, `apps/server/src/modules/actions/feedback.ts` (new), `actions/index.ts`, `apps/server/src/modules/audit/repo.ts` (`auditEvents` gains `actionRejectReason: "action.reject_reason"` and `actionMistake: "action.mistake"`), `apps/server/test/integration/actions-feedback.test.ts` (new).

**Interfaces.**

```ts
export const MISTAKE_WINDOW_MS = 7 * 24 * 3_600_000;

export type RejectReasonResult = { kind: "saved" } | { kind: "not_rejected" } | { kind: "not_found" };
export type MistakeResult = { kind: "saved" } | { kind: "already" } | { kind: "too_late" } | { kind: "not_sent" } | { kind: "not_found" };

/** The caller checks the owner role. Only a `send` with status `rejected`; a later reason replaces the earlier one. */
export async function recordRejectReason(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { actionId: string; reason: RejectReason; userId: string; via: "telegram" | "web" | "cli"; now: Date }
): Promise<RejectReasonResult>;

/** The caller checks the owner role. Only a `send` with status `applied` and `applied_at` ≥ now − 7 days; once. */
export async function markSentMistake(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { actionId: string; userId: string; via: "telegram" | "web" | "cli"; now: Date }
): Promise<MistakeResult>;
```

Repository: `upsertActionFeedback(trx, ctx, { actionId, kind, reason, userId, via, at })` — `INSERT … ON CONFLICT (org_id, action_id, kind) DO UPDATE SET reason = excluded.reason, user_id = excluded.user_id, via = excluded.via, updated_at = excluded.updated_at` for `reject_reason`; `insertMistakeOnce(...)` — `ON CONFLICT DO NOTHING`, returns whether it inserted. `getActionFeedback(db, ctx, actionId, kind)`. Each filters `org_id`; the action is read with `org_id` too (`getSend`/`lockSend` exist in `actions/repo`). Audit row in the same transaction: `{ actionId, emailId, actor: userId, event, reasonCode: reason (or null), data: { via } }`.

**Decisions.** D13, D21.

**Test** (integration, two orgs, a `send` in each status as the existing `actions-approvals.test.ts` builds them):

1. `recordRejectReason` on a `rejected` send → `saved`, one row `reject_reason`/`wrong_person`, one `action.reject_reason` audit row; again with `wrong_content` → `saved`, still one row, reason `wrong_content`.
2. On an `awaiting_approval`, `applied` or `expired` send → `not_rejected`, no row; on a `move` action id → `not_found`; org B's context with org A's id → `not_found`.
3. `markSentMistake` on an `applied` send with `applied_at = now − 2 days` → `saved`; again → `already` (one row); `applied_at = now − 8 days` → `too_late`; a `failed` send → `not_sent`; org B → `not_found`.

**Check.** `bun test apps/server/test/integration/actions-feedback.test.ts`

**Done when.** Cases 1–3 pass.

**Out of scope.** The M3 reader (stage 11 reads these rows); the taps and routes (stage 14).

## Done when (stage)

Steps 1–2 done; the Proof command of `plan.md` passes (`/tmp/f100-s13`).
