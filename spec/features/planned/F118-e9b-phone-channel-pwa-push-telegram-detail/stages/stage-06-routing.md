# F118 stage 06 — Route rule and setting

Part of [`../plan.md`](../plan.md). Needs checkpoint A (a real push worked). No migration (the column came in 02).

Carry-over reads: `plan.md` D6, D7; `interfaces.md` (`noticeGroups`, `effectiveRoute`); `channels/notify-settings.ts`, `packages/core/src/web/notify.ts`, `channels/routes.ts`.

## Step 1 — Groups and the route rule (core)

- **Goal:** one pure rule that says which channels a notice of a kind goes to.
- **Files:** `packages/core/src/notices/routes.ts` (+ test).
- **Interfaces:** `noticeGroups`, `pushKinds`, `noticeGroupOf`, `effectiveRoute({ stored, hasChat, hasDevice, group })`, `noticeRoutesSchema` (strict `{ urgent?, approvals?, updates? }` of `telegram | push | both`).
- **Decisions:** D6, D7. A kind with no group → `{ telegram: hasChat, push: false }`.
- **Test (unit), `effectiveRoute`:**
  1. group `urgent`, stored none, chat yes, device yes → telegram and push.
  2. `updates`, stored none, chat yes, device yes → telegram only.
  3. `urgent`, stored none, chat yes, device no → telegram only.
  4. `urgent`, stored `push`, chat yes, device no → telegram only (fallback).
  5. `approvals`, stored `telegram`, chat no, device yes → push only (fallback).
  6. `updates`, stored `push`, chat yes, device yes → push only.
  7. chat no, device no → nothing.
  8. Every kind of `noticeKinds` is in at most one group; every group kind is in `pushKinds`; `digest`, `approval_edit`, `reply_prompt`, `loop_consent` are in no group.

## Step 2 — Route setting API

- **Goal:** `PATCH /api/me/notify` accepts `routes` (`noticeRoutesSchema`); `GET` returns `routes` (stored) and `routeDefaults` (from `effectiveRoute` with the current chat and devices). Audit `member.notify_changed` with the key `notice_routes`. Flag `web_push` off → `routes` is refused the way `reportChannel` is refused with `report_mail` off.
- **Test (integration):** set `{ urgent: "push" }` → stored, other keys keep; `{ urgent: "fax" }` → 400; flag off → refused; a member of org B cannot change org A's row (own row by session).
- **Mutation guard:** remove the flag check of `routes`; see test 3 fail; restore.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** writing push rows (07), sending them (08), the route UI (12).
