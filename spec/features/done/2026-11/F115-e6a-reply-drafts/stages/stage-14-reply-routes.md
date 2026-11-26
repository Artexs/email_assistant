# F115 stage 14 — Reply routes

Part of [`../plan.md`](../plan.md). Needs 13.

Typed `/api` routes for the panel, on top of the F102 approvals API. Every route has `apiDoc` and answers 404 `not_found` while `approvals_page` or `reply_drafts` is off.

## Step 1 — Write routes

- **Goal:** `POST /api/replies`, `POST /api/approvals/:id/redraft`, `POST /api/approvals/:id/recipients` and `GET /api/replies/requests/:id` as `interfaces.md` § Routes. Each calls the stage 13 service function with `via: "web"`.
- **Decisions:** owner for the three writes, member for the read. Body schemas in `packages/core/src/web/replies.ts`. A bad id → 400 `validation`; an unknown or foreign id → 404. The answers map one to one from the service results (`interfaces.md`). The panel polls `GET /api/replies/requests/:id` every 2 s for at most 60 s; the route reads only the request row.
- **Test (integration):**
  1. `POST /api/replies` for a clean mail → 202 with a `requestId`; `GET` → `pending`, then (job run) `done` with `sendId`. Again for the same mail → 200 `{ sendId }`.
  2. For a flagged mail → 409 `blocked` + `reason: "suspicious"`.
  3. A member → 403 on each write.
  4. Redraft with 301 characters → 400 `validation`.
  5. Redraft on a superseded send → 409 `changed` + `currentId`.
  6. Recipients `all` → 200 `{ id, version: 2 }`.
  7. Org B's ids → 404.
  8. `openapi-routes.test.ts` covers the new routes.

## Step 2 — The read model

- **Goal:** `ApprovalItem` and `ApprovalDetail` (F102) carry for kind `reply`: `gaps` (= `gapsOf(body_text ?? body)`, so an edit updates them), `cc`, `replyTo` (stored Reply-To when it differs from `From`, else null), `instruction` (of the request that made the version, or null), `redraftsLeft` (5 minus the redraft count), `sentVisible`. Other kinds: the fields are absent.
- **Decisions:** the fields come from the payload and the request row, not from the mailbox. `expiresAt` already uses `approvalExpiresAt` (stage 05).
- **Test (integration):**
  1. `GET /api/approvals/:id` for a reply with a gap → `gaps: ["…"]`, `redraftsLeft: 5`.
  2. After one redraft → the new item has `instruction` and `redraftsLeft: 4`.
  3. A delegation item has no `gaps` key.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the web page (15).

## Carry-over from the stage 13 review (2026-11-18)
See `../review-13.md` (N2 residuals): decide Reply-To versus From for Reply all, the plus variant and alias of the own mailbox, and the display-name recipient with a visible button; write the decisions down.

**Decided in stage 14 (2026-11-19; detail in `notes/2026-11-19-f115-s14-reply-routes.md`, capability page `docs/capabilities/drafts-and-send.md`):**
- Reply all goes to the stored From and never to the Reply-To; Use Reply-To is the explicit tap; the panel shows `to`, `cc`, `replyTo` and `recipientsMode` before Send.
- A `+tag` variant of an own mailbox is an own mailbox (`ownAddressKey`): left out of Reply all and Use Reply-To, refused in Cc.
- A stored address with a display name counts as its bare address (`bareAddress`); an entry with no valid address is no recipient and shows no button; the rule and the service are one function.
