# F102 stage 10 — Approvals read API

Part of [`../plan.md`](../plan.md). Read P4, P6, D8, D11, Q5, Q13 and [`../commands.md`](../commands.md) § Routes and § Shapes. Needs stages 01 and 08 landed.

Two steps. Read only: no write route, no state change.

## Step 1 — Schemas and the two GET routes

- **Goal:** the panel can list the waiting drafts and read one, with the text that the committer would send.
- **Files:** a new `packages/core/src/web/approvals.ts` (schemas, exported from `@ea/core/web`), a new router file in module `channels` (`approvalRoutes`), a read query in module `actions` if none fits, the router mount in the server web wiring, tests.
- **Interfaces:** `approvalListSchema`, `approvalDetailSchema`, `approvalItemSchema` (shapes in `commands.md`); `approvalRoutes(deps)`; both routes with `apiDoc` (tag `approvals`, `operationId` `listApprovals`, `getApproval`).
- **Decisions:**
  - D8: the router lives in `channels` (it needs `delegation` and `config`; `docs/code-patterns.md` § Layers). The `view` comes from `approvalViewFor` (one builder with the committer and the card); the detail adds the full quote (`buildOutgoingMessage` `parts.quote`, up to 8000 characters) and, for kind `delegation`, the active delegates for the picker.
  - List: sends of the organization in `awaiting_approval` (state `waiting`), and `approved` sends that are not in flight (state `held`, with `heldBy` from the same check as the Telegram toast; move that check to one shared function in `channels`). Newest first by `created_at`, at most 100. `draftReady` = the draft is `applied`.
  - Detail: any send of the organization. State map: `awaiting_approval` → `waiting`; `approved` → `held` or `sending`; `applying` → `sending`; `applied` → `sent`; `rejected`; `expired` with reason `superseded` → `superseded` (with `currentId`, the newest version); other `expired` → `expired`; `failed`. A `create_draft` id or any other action type → 404.
  - `expiresAt` = `notified_at` + 48 h; with no `notified_at`, `created_at` + 7 days (Q5).
  - Flag `approvals_page` off → 404 `not_found` for both. Any member reads (P6).
  - A send whose payload retention cleared (`sendPayloadSchema` fails) is left out of the list and answers detail with state only and a null `view` (make `view` nullable in the detail schema only).
  - The answer passes its strict schema before it leaves (no payload field leaks).
- **Test** (integration; O1 with owner U1 and member M1; flag on unless named):
  - T1: flag off → 404 on `GET /api/approvals` and `GET /api/approvals/<id>`.
  - T2: sends made in this order: A (`awaiting_approval`, draft `applied`), B (`awaiting_approval`, draft `ready`), C (`approved`, held by `SEND_SCOPE` `off`), D (`applied`) → items C, B, A; B `draftReady` false; C `state` `held`, `heldBy` `scope`; D absent.
  - T3: M1 gets the same list (200).
  - T4: a send id of O2 → 404; a malformed id → 400 `validation`.
  - T5: the detail of A has `view.body` equal to the body of the card view of the same send, and `quote` with 5000 characters for a 5000-character original body (the card's quote is cut at 1500).
  - T6: after a stage 08 edit of A → the detail of A has `state` `superseded` and `currentId` = the new send; the list holds the new send, not A.
  - T7: `expiresAt` of A with `notified_at` `2026-11-20T10:00:00Z` = `2026-11-22T10:00:00Z`; of B with no `notified_at` and `created_at` `2026-11-20T09:00:00Z` = `2026-11-27T09:00:00Z`.
  - T8: the detail of a delegation send lists active delegates only; of a clarification, `delegates` = `[]`.
- **Done when:** T1–T8 pass; the route test of stage 01 passes.

## Step 2 — The badge count in `/api/me`

- **Goal:** the nav can show the number of waiting approvals without another request.
- **Files:** `packages/core/src/web/me.ts`, the tenancy routes deps (a count function passed in, as `countMailboxes`), the server web wiring, tests; the web `Me` users compile unchanged.
- **Interfaces:** `Me.approvalsWaiting: number`.
- **Decisions:** D11. Count = sends in `awaiting_approval` whose draft is `applied`; 0 while the flag is off. The tenancy module gets the count as a function (layers: `tenancy` must not import `actions`).
- **Test:**
  - T9: with T2 data, `GET /api/me` has `approvalsWaiting` 1 for U1 and for M1; 0 with the flag off.
- **Done when:** T9 passes; the existing `/api/me` tests pass.

## Done when (stage)

- Steps 1 and 2 hold. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s10`).
