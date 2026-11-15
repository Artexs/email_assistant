# F102 · Commands and interfaces

Part of [plan.md](plan.md) (D7). The names here are the contract between stages and for later tickets (E5b, E6a, E9b, the E2 scripted executive). A stage that must change one asks first.

## Routes (all under `/api`, all with `apiDoc`, all 404 `not_found` while their flag is off)

Schemas live in `packages/core/src/web/approvals.ts` and `packages/core/src/web/delegation.ts`. Ids are UUIDs (a bad id: 400 `validation`; an unknown or foreign id: 404 `not_found`).

| Route | Role | Body | 200 answer | Other answers |
| --- | --- | --- | --- | --- |
| `GET /approvals` | member | — | `ApprovalList { items: ApprovalItem[] }`: `waiting` and `held` items, newest first, at most 100 | — |
| `GET /approvals/:id` | member | — | `ApprovalDetail` (any state; `currentId` when `superseded`) | — |
| `POST /approvals/:id/approve` | owner | `{}` | `{ status: "approved" \| "approved_held", heldBy? }` | 409 `changed` + `currentId`; 409 `draft_not_ready`; 409 `closed` + `state` |
| `POST /approvals/:id/reject` | owner | `{}` | `{ status: "rejected" }` | 409 `changed` + `currentId`; 409 `closed` + `state` |
| `POST /approvals/:id/edit` | owner | `{ subject, body, delegateId? }` | `{ id, version }` (the new send) | 409 `changed` + `currentId`; 409 `closed`, `drafts_off`; 400 `not_editable`, `unchanged`, `delegate_inactive`; 400 `validation` (also a `delegateId` on a kind other than `delegation`) |
| `GET /delegates` | member | — | `{ items: Delegate[] }` (active and not) | — |
| `POST /delegates` | owner | `{ name, email, tags }` | 201 `Delegate` | 409 `exists`; 400 `mailbox_address` |
| `PATCH /delegates/:id` | owner | `{ name?, tags?, active? }` (at least one) | `Delegate` | — |
| `GET /delegations?filter=&before=&limit=` | member | — | `{ items: DelegationItem[], next: string \| null }` | — |
| `POST /delegations/:id/remind` | owner | `{}` | `{ status: "planned", sendId }` | 409 `not_open`, `limit_reached`, `reminder_waiting`, `drafts_off`, `delegate_inactive` |
| `POST /delegations/:id/done` | member | `{}` | `{ status: "done" }` | 409 `already`, `not_closable` |
| `POST /delegations/:id/cancel` | owner | `{}` | `{ status: "cancelled" }` | 409 `not_open`, `sending` |

Flags: `/approvals*` → `approvals_page`; `/delegates*`, `/delegations*` → `delegation_pages`. `GET /api/me` gains `approvalsWaiting: number`.

## Shapes

- `ApprovalItem`: `id` (send), `version`, `state` (`waiting` \| `held`), `draftReady`, `kind`, `mailboxAddress`, `createdAt`, `expiresAt`, `heldBy` (null or `HeldBy`), `delegationId` (null), `setId` (null), `view: ApprovalView` (the card view of `@ea/core`).
- `expiresAt`: `waiting` = `notified_at` + 48 h, else `created_at` + 7 days; `held` = `approved_at` + 48 h.
- `ApprovalDetail`: `ApprovalItem` fields (`view` null when retention cleared the payload), `draftRemovable` (the mailbox has UIDPLUS: an edit or reject removes the old Drafts copy), plus `state` also `sending` \| `sent` \| `rejected` \| `expired` \| `failed` \| `superseded`, `currentId` (null), `quote` (full text or null), `delegates` (active `{ id, name, email }` for the picker; empty unless kind `delegation`).
- `Delegate`: `id`, `name`, `email`, `tags`, `active`, `createdAt`.
- `DelegationItem`: `kind: "delegation"` (E5b adds kinds), `id`, `status`, `delegate { id, name, email, active }`, `task` (null after retention), `subject`, `dueAt`, `sentAt`, `answeredAt`, `remindersSent`, `reminderWaiting`, `sendId` (null).
- Filters: `open` (`drafted`, `sent`), `overdue`, `answered`, `closed` (`done`, `cancelled`); default `open`; `limit` 1–100, default 50; `before` = the `next` cursor.

## Server functions

- `editApproval(deps, ctx, sendId, input: { userId, via, now, subject, body, delegateId? })` → `{ kind: "edited", sendId, version } | { kind: "changed", currentId } | { kind: "closed", state } | { kind: "not_editable" | "unchanged" | "delegate_inactive" | "drafts_off" | "not_found" }` (module `actions`).
- `ApproveResult` and `RejectResult` gain `{ kind: "superseded", currentId }`.
- `ApprovalHooks.onDecided(trx, ctx, { sendId, decision: "approved" | "rejected" | "changed" | "expired", exceptUserId?, at })` (defined in `actions` with `noApprovalHooks`, stage 08; the real one is `cardEditHooks(deps)` in `channels`, stage 09). The hook, not the caller, turns `approved` into `approved_held` + `heldBy` (shared `heldReason` in `channels`).
- `queueCardEdits(trx, ctx, { sendId, outcome, heldBy?, exceptUserId?, at })` in `channels` (stage 06): one `approval_edit` row per sent `approval:<sendId>` card.
- `DelegationHooks.onSuperseded(trx, ctx, { delegationId, draftActionId, sendActionId, delegateId })` → `boolean`; `DelegationHooks.activeDelegate(trx, ctx, delegateId)` → `{ id, name, email } | undefined` (`actions` must not import `delegation`).
- `cleanUserText(text, { oneLine })` in `packages/core/src/outgoing/`.
- `remindNow`, `cancelByUser`, `updateDelegate` in module `delegation`, each with `via`.

## Data

- `actions.supersedes_action_id` (uuid, null), FK `(supersedes_action_id, org_id)` → `actions (id, org_id)`, unique where not null.
- `outbox.edit_of_outbox_id` (uuid, null; an `approval_edit` row also has the target's `email_id`), FK → `outbox (id)` `ON DELETE CASCADE` (`outbox` has no `(id, org_id)` key; the sender checks that both rows have one `org_id`); kind `approval_edit` in `outbox_kind_check`; CHECK `kind <> 'approval_edit' OR edit_of_outbox_id IS NOT NULL`.
- Draft payload: `version` (int ≥ 1), `subject_text`, `body_text` (all optional).
- Status reasons: send `superseded`; delegation `user_cancelled`. `approved_via` value `web`.
