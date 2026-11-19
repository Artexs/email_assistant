# F102 stage 11 — Approvals write API [risky]

Part of [`../plan.md`](../plan.md). Read P2, P6, D2, D3, D15, F4 and [`../commands.md`](../commands.md) § Routes. Needs stages 09 and 10 landed.

`[risky]`: auth, tenant isolation and sending to people. One step: three routes over the service functions of stage 08, with the card hooks of stage 09.

## Step 1 — Approve, reject, edit [risky]

- **Goal:** an owner approves, rejects or edits a waiting draft from the panel, with the same rules as the Telegram taps.
- **Files:** the `approvalRoutes` file of stage 10, the schemas in `packages/core/src/web/approvals.ts`, the server web wiring (deps: the card hooks, the send scope, `uidplus`), tests.
- **Interfaces:** `POST /api/approvals/:id/approve`, `/reject`, `/edit` (bodies and answers in `commands.md`), each with `apiDoc` (`approveApproval`, `rejectApproval`, `editApproval`) and `requireOwner`.
- **Decisions:**
  - P6: owner only (`403 owner_only` for a member, from `requireOwner`). The shared guards stay: Origin, suspended organization, body limit.
  - Flag `approvals_page` off → 404 `not_found`.
  - `via: "web"` for every call (D15). The hooks are `cardEditHooks` (stage 09), so the Telegram cards follow.
  - Approve answer map: `approved` → 200 `approved`, or `approved_held` with `heldBy` when `heldReason` (stage 09) names a cause, read after the commit; `already_approved` → 200 `approved` (a double click is not an error); `superseded` → 409 `changed` + `currentId`; `draft_not_ready` → 409; `sending`, `sent`, `rejected`, `expired`, `failed` → 409 `closed` + `state`; `not_found` → 404.
  - Reject answer map: `rejected` → 200; `superseded` → 409 `changed`; `already` → 409 `closed` + `state`; `not_found` → 404. The optional reason is the existing `POST /api/actions/:id/reject-reason` (P5): no new route.
  - Edit: body schema `{ subject: string, body: string, delegateId?: uuid }` with the raw limits (subject up to 400, body up to 6000 characters before cleaning; the service enforces D3 after cleaning). Answers: `edited` → 200 `{ id, version }`; `changed` → 409 + `currentId`; `closed` → 409 + `state`; `drafts_off` → 409; `not_editable`, `unchanged`, `delegate_inactive` → 400 with that code; `not_found` → 404.
  - The id in the path is the version the page showed (D2). The route never looks for a newer version on its own.
  - Error texts and logs hold codes and ids only.
- **Test** (integration; O1 with owner U1, member M1, delegate Anna; send S1 `awaiting_approval` with draft `applied`; U1 and U2 hold sent Telegram cards of S1):
  - T1: M1 → 403 `owner_only` on all three routes; the send is unchanged.
  - T2: U1 approves S1 → 200 `{ status: "approved" }`; S1 `approved`, `approved_by` U1, `approved_via` `web`; audit `action.approved` with `via` `web`; two `approval_edit` rows (U1 and U2: a web call excepts no user).
  - T3: the same call again → 200 `{ status: "approved" }`; no new audit row.
  - T4: with `SEND_SCOPE` `off` → 200 `{ status: "approved_held", heldBy: "scope" }`.
  - T5: S1 with a `ready` draft → 409 `draft_not_ready`.
  - T6: S1 with `notified_at` 49 h ago → 409 `closed`, `state` `expired`; S1 `expired` / `timeout`.
  - T7: U1 rejects S1 → 200; S1 `rejected`; the delegation `cancelled` / `rejected`; the edit rows carry `rejected`.
  - T8: U1 edits S1 with subject `Budget 2027` and body `Hello Anna,\r\nplease send the report.\n\nAdam` → 200 `{ id: <S2>, version: 2 }`; then approve S1 → 409 `changed`, `currentId` S2.
  - T9: an edit with a 3001-character body after cleaning → 400 `validation`; a reminder → 400 `not_editable`; mode `shadow` → 409 `drafts_off`.
  - T10: S1 of organization O2 → 404 on all three; a malformed id → 400 `validation`.
  - T11: flag off → 404 on all three.
  - T12: a write with a foreign `Origin` → 403 `bad_origin`; in a `suspended` organization → 403 `org_suspended`.
  - T13: the route test of stage 01 lists the three routes as described.
- **Done when:** T1–T13 pass.
- **Out of scope:** the page (stages 12, 13); approval sets in the panel.

## Done when (stage)

- Step 1 holds. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s11`).

## Carry-over from stage 08 review

- `editApproval` and `approve` do not validate ids. A `sendId` or `delegateId` that is not a UUID reaches Postgres and gives a 500. The route must validate both (400 `validation`) before it calls the function. Add route tests with a bad `sendId` and a bad `delegateId`.

## Carry-over from stage 09 review

- A panel approve of a send that timed out (`approve` answers `expired` with `byThisTap` true) expires the send but queues no card edit: every Telegram card stays live (a tap on it answers `expired`). The route must map that answer, and the stage must accept this gap in writing (Q18: the hourly expiry job edits no card; stage 15 owns that work).

## Carry-over from stage 10 review

- A send in `approved` with no fresh lock reads as `held` with `heldBy` null when nothing holds it (the committer takes it next). Keep the answers `approved` and `approved_held` apart, and name closed states as `stateOf` in `channels/approvals-read.ts` does.
