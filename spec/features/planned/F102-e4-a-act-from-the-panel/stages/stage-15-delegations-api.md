# F102 stage 15 — Delegations API

Part of [`../plan.md`](../plan.md). Read P6, D9, Q7, Q12 and [`../commands.md`](../commands.md). Needs stages 09 and 14 landed.

Two steps in module `delegation`. Remind now is stage 16.

## Step 1 — The list

- **Goal:** the panel lists delegations by state, page by page.
- **Files:** `packages/core/src/web/delegation.ts`, the `delegation` repository, a router file `delegationRoutes` in module `delegation`, the web wiring, tests.
- **Interfaces:** `GET /api/delegations?filter=open|overdue|answered|closed&before=<cursor>&limit=<1-100>` with `apiDoc` (`listDelegations`, tag `delegations`).
- **Decisions:**
  - Flag `delegation_pages` off → 404. Any member reads.
  - Filters as `commands.md`; order `created_at` desc, then `id`; an opaque cursor as `GET /api/activity`.
  - `DelegationItem.kind` is always `"delegation"`: E5b adds loop kinds to the same list (E05 notes §6).
  - `task` = `task_summary` (null after retention); `subject` = the mail subject. Both never go to a log.
  - `reminderWaiting` = a reminder send of this delegation is `awaiting_approval`, `approved` or `applying`. `sendId` = `send_action_id` while `drafted`, else null (the page links it to `/approvals?id=`).
- **Test** (integration; O1; delegations made in this order: D1 `drafted`, D2 `sent` due tomorrow, D3 `overdue` with a waiting reminder, D4 `answered`, D5 `done`, D6 `cancelled`):
  - T1: `filter=open` → D2, D1; `overdue` → D3 with `reminderWaiting` true; `answered` → D4; `closed` → D6, D5.
  - T2: `limit=1` on `open` → D2 and a `next` cursor; `before=<next>` → D1 and `next` null.
  - T3: D1 has `sendId` = its send; D2 has `sendId` null.
  - T4: a delegation of O2 never shows; `filter=late` → 400 `validation`; flag off → 404.
- **Done when:** T1–T4 pass.

## Step 2 — Done and Cancel

- **Goal:** a member marks a delegation done; an owner cancels an open one.
- **Files:** module `delegation` (`cancelByUser`; the guard of the cancelled mark), `reject` in `actions`, the router of Step 1, tests.
- **Interfaces:** `POST /api/delegations/:id/done` (`markDelegationDone`) and `/cancel` (`cancelDelegation`) with `apiDoc`; `cancelByUser(deps, ctx, id, { userId, via, now })` → `{ kind: "cancelled" | "not_open" | "sending" | "not_found" }`; `reject` input gains optional `delegationReason: "user_cancelled"` (default `rejected`).
- **Decisions:**
  - Done (P6, Q7): any member; `closeDelegation` as today (`answered` or `overdue` → `done`); `already` → 409, `not_closable` → 409. Audit data gets `via`.
  - Cancel (Q12), owner only:
    - `drafted`: its send `awaiting_approval` or held `approved` → `reject` with `via: "web"`, `delegationReason: "user_cancelled"` and the card hooks (the cards follow, stage 09). `superseded` (an edit came between): read the delegation again and try once more with its current send. Send `applying` → 409 `sending`; any other send state → 409 `not_open`.
    - `sent` or `overdue`: lock the delegation, mark `cancelled` / `user_cancelled`, expire the waiting reminders (the existing reminder close) and call `onDecided` with `expired` for each, so their cards lose the buttons; audit `delegation.cancelled` with `{ reason: "user_cancelled", via }`.
    - `answered`, `done`, `cancelled` → 409 `not_open`.
  - Status flow: new edges `drafted | sent | overdue → cancelled (user_cancelled)`. `user_cancelled` is final: "Send again" and "It went out" do not reopen it.
  - Lock orders stay as today: `drafted` = send, then delegation (`reject`); `sent` or `overdue` = delegation, then its reminder sends (as the chaser).
- **Test** (integration; the T1 data; U1 owner, M1 member):
  - T5: M1 `done` on D4 → 200; D4 `done`; audit with `via` `web`. Again → 409 `already`. On D2 → 409 `not_closable`.
  - T6: M1 `cancel` → 403 `owner_only`.
  - T7: U1 cancels D1 → 200; D1 `cancelled` / `user_cancelled`; its send `rejected`; one `approval_edit` row per sent card with outcome `rejected`.
  - T8: U1 cancels D3 → 200; its waiting reminder send `expired`, with one `approval_edit` row (`expired`) per sent card; a delegate reply in the thread leaves D3 `cancelled`.
  - T9: D1 with its send `applying` → 409 `sending`; D5 → 409 `not_open`; D1 whose send an edit supersedes just before the reject → 200, the new send `rejected`.
  - T10: two cancels of D2 at once → one 200, one 409 `not_open`.
  - T11: flag off → 404 on both; an id of O2 → 404.
- **Done when:** T5–T11 pass; the existing delegation and approval tests pass.

## Done when (stage)

- Steps 1 and 2 hold. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s15`).
