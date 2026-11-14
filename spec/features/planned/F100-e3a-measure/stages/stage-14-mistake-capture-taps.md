# F100 stage 14 — Reject reasons and the mistake mark: Telegram and web

Part of [`../plan.md`](../plan.md). Review job before the land (taps that write data; owner checks). Needs stage 13 on `master`. Not next to stage 15 (both edit `channels/callbacks.ts`); runs after F097 stages 03–04 when they build (same file): merge `master` before the proof.

After this stage, with the flag `mistake_capture` on, a reject in Telegram offers three optional reason buttons, a "sent" result offers "⚠️ This was a mistake" for 7 days, and two owner-only web routes do the same for the E4-A approvals page (D21). Each tap or call writes through the stage 13 service.

## Step 1 — Telegram taps, send-result flag, web routes

**Goal.** The taps and routes call the service behind the flag (D21).

**Files.** `apps/server/src/modules/channels/action-feedback-taps.ts` (new: the two tap handlers and their answer texts; `callbacks.ts` is 393 lines, so it only dispatches the two kinds to this file and adds the reason buttons to the reject edit), `apps/server/src/modules/channels/callbacks.ts`, `apps/server/src/modules/channels/notices/send-result.ts` (set `mistakeButton`), `apps/server/src/modules/actions/routes.ts` (new: `actionRoutes`), `packages/core/src/web/actions.ts` (new: `rejectReasonBodySchema = z.object({ reason: z.enum(rejectReasons) })`) + `web/index.ts`, `apps/server/src/web.ts` (mount), `apps/server/test/integration/channels-callbacks.test.ts`, `channels-notices.test.ts`, `apps/server/test/integration/web-actions.test.ts` (new).

**Interfaces and rules.**

- Reject tap: when `reject` returns `rejected` and `isFeatureOn(db, ctx, "mistake_capture")`, the edit uses `reasonButtons: true`.
- `reject_reason` tap (owner check as other approval taps): `recordRejectReason(… via: "telegram")`; `saved` → answer `Noted: ${REJECT_REASON_TEXTS[reason]}.` and edit `approval:<id>` with outcome `rejected_reason`; `not_rejected` → `This send is not rejected.`; `not_found` → `NOT_FOUND_TEXT`. The flag is not checked on the tap (a button only exists when it was on).
- `mistake` tap (owner check): `markSentMistake(… via: "telegram")`; `saved` → answer `⚠️ Noted as a mistake.` and edit `send_result:<id>` with `marked_mistake`; `already` → `Already marked.`; `too_late` → `Too late: a mistake can be marked within 7 days of the send.`; `not_sent` → `This mail was not sent.`; `not_found` → `NOT_FOUND_TEXT`.
- `send-result.ts`: read `isFeatureOn(db, ctx, "mistake_capture")` once per detector run of the organization; the view gets `mistakeButton: true` only for result kind `sent` when on.
- Routes (`actionRoutes({ db, now })`, mounted at `/`; `requireOwner` on both): `POST /actions/:id/reject-reason` (body `rejectReasonBodySchema`) and `POST /actions/:id/mistake`. Flag off → 404 `{ error: "not_found" }`. A bad id (not a UUID) or body → 400. `not_found` → 404; `not_rejected` → 409 `{ error: "not_rejected" }`; `too_late` → 409 `{ error: "too_late" }`; `not_sent` → 409 `{ error: "not_sent" }`; `already` → 200 `{ status: "already" }`; `saved` → 200 `{ status: "saved" }`. `via: "web"`, `userId` from the session.

**Decisions.** D21, D26.

**Test.**

1. Callbacks: flag on, a reject tap → edit buttons `rw:…`; then `rw:p:<id>` → one `action_feedback` row and the edited card ends with `Reason: wrong person.`; flag off → the reject edit has no buttons (old behaviour).
2. Callbacks: an assistant taps `rw:p:<id>` or `mk:<id>` → the owner-only answer, no row.
3. Callbacks: `mk:<id>` on an applied send of yesterday → one row and the card ends with `⚠️ Marked as a mistake`; a second tap → `Already marked.`
4. Notices: flag on → a `sent` result row's view has `mistakeButton: true`; flag off → no field; a `failed` result → no field.
5. Routes: 401 without a session; 403 for an assistant; 404 with the flag off; 400 for `reason: "bad"` and for a non-UUID id; 404 for org B's action; 200 `saved` then 200 `saved` (replace) for reject reasons; 409 `not_rejected` for an applied send; mistake 200 `saved`, 200 `already`, 409 `too_late`.

**Check.** `bun test apps/server/test/integration/channels-callbacks.test.ts apps/server/test/integration/channels-notices.test.ts apps/server/test/integration/web-actions.test.ts`

**Done when.** Cases 1–5 pass; `bun run graph:modules` ran if a new import edge appeared.

**Out of scope.** Reasons for a set reject (`reject_set`); the approvals page (E4-A).

## Done when (stage)

Step 1 done; the Proof command of `plan.md` passes (`/tmp/f100-s14`).
