# F116 stage 20 — Loop routes and settings

Part of [`../plan.md`](../plan.md). Needs stages 15 and 16. Every route gets `apiDoc` in the same commit; schemas in `packages/core/src/web/loops.ts`.

## Step 1 — Loop routes

- **Goal:** the routes of `interfaces.md` § Routes, each a thin call of one stage 14 or 16 command with `via: "web"` (ADR 0023).
- **Decisions:**
  - Flag `open_loops` off → every `/loops*` route answers 404 `not_found` (the F102 rule); `POST /emails/:id/delegate` follows `delegate_button`.
  - `GET /loops`: member; `kind` required; `filter` `open` (default), `due` (open with `due_at` ≤ the end of the local day), `closed`; `limit` 1–100 (default 50), `before` = the `next` cursor. `LoopItem.reason` codes: `asked_no_answer`, `promised`, `forwarded_to_delegate`; `matchedBySubject` = `close_reason = replied_subject`; `autoReplyOnly` = `auto_reply_at` set and still open; `laterLeft` = 3 − `later_count`. Texts null after retention.
  - Command routes: roles of D11 (`requireOwner` where the command is owner-only, so a member gets 403 before any query); 200 bodies carry `status` = the command kind plus its fields (the F102 form: `{ status: "planned", sendId }`, `{ status: "ok", dueAt }`); every other kind maps to 409 with that code; `not_found` → 404.
  - A suspended org: write routes answer the existing suspended code.
- **Test (integration):** T1 `GET /loops?kind=waiting` lists two open loops by due, then the cursor page; a loop of org B is never listed; T2 the flag off → 404; T3 `POST /loops/:id/follow-up` as owner → 200 `{ status: "planned", sendId }`; again → 409 `waiting`; T4 as member → 403; T5 `POST /loops/:id/later` as member → 200; the fourth time → 409 `limit_reached`; T6 `POST /emails/:id/delegate` → 200 with ids; again → 409 `exists`; T7 the OpenAPI test lists every new route with its schemas.

## Step 2 — Mailbox settings

- **Goal:** the wait and the auto switch on the settings API (PD-119, PD-120).
- **Decisions:**
  - `loop_wait_days` 1–10 (400 `validation` outside); a change writes the settings version (so the chaser run of the day skips once, M13) and one `settings.changed` audit row; it changes the due of loops opened later only.
  - `auto_follow_up` is a tool switch with default off; it is offered in the switch list only while `open_loops` is on.
  - `GET /settings/:mailboxId` shows both, and `sentTracking` (`on` | `off` | `flag_off`: the F104 switch state) for the settings card.
- **Test (integration):** T8 PATCH 5 → `loopWaitDays` 5 and a new version; 0 and 11 → 400; T9 the switch on → the chaser plans a waiting follow-up (the stage 15 T6 case through the route); T10 a member PATCH → 403.

## Check

`bun test apps/server/test/integration/<the new route tests>`

## Done when

T1–T10 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s20`).

## Out of scope

The panel (21, 22).
