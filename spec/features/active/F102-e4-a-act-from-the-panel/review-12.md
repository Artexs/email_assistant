# F102 stage 12 review (Opus 5.5, PASS 27a6f2ff)

Model: Opus 5.5, because the stage has new Polish text and the page approves or rejects a send to people. No BLOCKING.

Fixed in one Sonnet continue (no re-review): TG1 (a `sending` send must not be labelled "Sent": pin the labels), TG2 (null `expiresAt` of a closed detail shows no "NaN min"), TG3 (Skip of the reject reason saves no reason), and two Polish wordings (`appr_dur_day` "{n} dni"; `appr_preparing` "Trwa przygotowywanie szkicu…").

Verified: the page reads `state` and `heldBy` from a fresh detail after approve (never trusts its own click); the six closed-state texts match `approvalClosedStates`; a member sees no Approve or Reject button and a direct POST gives 403 (e2e T8 both projects); the single-flight guard and `busy` disable the buttons; 409 `changed` loads `currentId`; the page calls only session-scoped approval routes; axe clean on the list and the open detail (desktop and mobile) and the phone menu; the `SEND_SCOPE=self` change is test-only (`apps/web/e2e/env.ts`, `SEND_TEST_ADDRESSES=anna@example.com`; no `.env.example`, compose or config change); csp page count 19 (baseline 18); approvals e2e 14 passed under the shared lock; unit 4141 pass.

Notes for stage 13:
- After Approve or Reject the focused button unmounts and focus falls to the body (the `role="status"` line still announces). Axe does not run on the page after an answer. Stage 13 keyboard test T7: move focus to the status line or the next item.
- The `held` text names `SEND_SCOPE` like the card; "Approve" does not name the recipient next to the button (the title does); the send note also shows for `held`.
- The e2e server logs `draft_reverse_missing` when the held seed send is rejected: expected (no Drafts copy in GreenMail).
