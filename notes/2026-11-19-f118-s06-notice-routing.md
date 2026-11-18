# F118 stage 06 — route rule and setting: notes for the next worker

Ticket: `spec/features/active/F118-e9b-phone-channel-pwa-push-telegram-detail/` (stage 06). No migration.

## Gate G-A moved

Checkpoint A (the real phone test) has NOT run: the VPS is unreachable. Stages 06 and later build on code that is tested with fakes. The flag `web_push` stays OFF by default. The gate G-A moves from "before stage 06" to **"before any deploy of F118 code to the VPS, and before any use of `web_push` in production"**. Source: `docs/owner-decisions.md`, entry 2026-11-19. If checkpoint A fails, F118 stops as plan Q1 says.

## What stage 06 built

- `packages/core/src/notices/routes.ts` (exported from `@ea/core`): `noticeRouteValues`, `noticeRoutesSchema` (strict `{ urgent?, approvals?, updates? }` of `telegram | push | both`; the same shape as the CHECK `memberships_notice_routes_check`), `noticeRoutesPatchSchema` (the same, each value also `null` = remove the key; at least one key), `effectiveRoute({ stored, hasChat, hasDevice, group })`, and `routeOfKind({ routes, kind, hasChat, hasDevice })` (the helper stage 07 calls for one notice).
- Rule: a kind with no group → `{ telegram: hasChat, push: false }`. No stored choice → `both` for `urgent` and `approvals`, `telegram` for `updates`. The chosen channels that exist; if none exists, the other channel that exists. **The caller passes `hasDevice = false` while `web_push` is off for the organization** (the rule knows no flag; `notifyViewOf` does this, stage 07 must do it too).
- `PATCH /api/me/notify` takes `routes` (one group of keys per body: quiet hours, channel or routes). A group not in `routes` keeps its value; `null` removes it. Flag `web_push` off → 404 `not_found` (as `reportChannel` with `report_mail` off). Audit `member.notify_changed` with `keys: "notice_routes"` (no value); a repeat writes none. The row is locked, so two changes of two groups at once both stay.
- `GET /api/me/notify` returns `routes` (stored) and `routeDefaults` (per group `{ telegram, push }` from `effectiveRoute` with no stored choice, for the chat and the live devices; flag off → no device counts). The web `NotifyView` type gained both keys (the card UI is stage 12; only a test fixture changed in `apps/web`).
- `getMemberNotify` returns `notice_routes`; new `setMemberNoticeRoutes` (the whole object, parsed by `noticeRoutesSchema` before the write).

## Carry-over handled

- The `rebindOnly` panel-load audit noise: `upsertPushSubscription` now returns `sessionChanged` (true when the device is new or was bound to another session or none). `PUT /api/me/push/subscription` with `rebindOnly` writes **no** `push.subscribed` audit row and no `push_subscribed` log line when the session did not change. A click, a new device and a re-bind to a new session are still audited. The row update (keys, label) still runs on every load.
- `memberships.notice_routes` accepts only the planned groups and values: the API schema and the CHECK agree (integration test 2 stores all 9 group and value pairs; test 3 refuses the rest at the API).

## Decisions the worker took (small)

- `noticeRoutesPatchSchema` allows `null` to go back to the default. Reason: the default of `urgent` and `approvals` depends on a device (`both`), so an explicit `both` is not the same as no choice. Null is never stored.
- `routeDefaults` has the `{ telegram, push }` shape of `effectiveRoute`, not a `telegram | push | both` word: the panel can show "no channel" (no chat, no device).

## Not done / left to later stages

- Writing push rows (07), sending (08), the route UI and its Polish texts (12): no text changed in this stage (no new Polish text).
- `TERMS_VERSION`: NOT bumped. This stage changes no legal text and no registry.
- Docs capability pages: stage 13.
- Mutation logs: `.f118s06-logs/mutation-*.log` in the job worktree (untracked). M15 (default `both` without a device check) is an equivalent mutant: `both` with no device gives the same result as `telegram`, because the rule keeps only the channels that exist.
