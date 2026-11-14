# F102 · Defaults for the owner to confirm

Each item is a default that the planner took. The stages do not change with the answer unless the item says so.

## Important

- **Q2 [important: user-visible]** Reminder drafts are not editable in the panel: approve or reject only (400 `not_editable`). Reason: a reminder is a fixed template, and it can belong to a reminder set whose card counts its items. Other option: edit reminders too (stage 08 and the set card change). Decision D3.
- **Q3 [important: user-visible]** A decision in Telegram also edits the cards of the other owners, not only the tapped card. Reason: one rule for every channel (D4); two owners see the same state. Other option: only panel actions edit cards.
- **Q4 [important: scope]** The epic's "send all" is not a panel button. The panel has "Remind now" per delegation; Telegram keeps the reminder set (📤 Send all). Reason: the discovery list names only remind now, done and cancel. Other option: a "Remind all overdue" button that makes one set.
- **Q5 [important: user-visible]** The panel approves also when no owner has linked Telegram. The 7-day `not_notified` expiry stays. Reason: the panel is a full approval channel (PD-031). Other option: the panel needs a Telegram link.
- **Q7 [important: user-visible]** Done works for any member (as the Telegram ✅ Done button); remind, cancel, delegate changes and every approval write are owner only. Decision P6.
- **Q8 [important: user-visible]** The phone tab bar keeps at most 5 tabs: Activity, Approvals, Delegations, Mailboxes, Settings while both new flags are on; Rules and Stats then move to the user menu on the phone. The desktop sidebar shows all. Reason: the bar has 4 or 5 columns. Other option: a sixth column.
- **Q10 [important: production]** Stage 20 turns `approvals_page` and `delegation_pages` on for the pilot organization after the deploy. Reason: the phone test U1 needs them. Other option: the owner turns them on with `org:flag`.
- **Q12 [important: user-visible]** Cancel a delegation from the panel is a new user action: status `cancelled`, reason `user_cancelled`, no Undo. A `drafted` delegation rejects its waiting send. Decision D9.

## Minor

- **Q1 [minor]** The deep link is `/approvals?id=<send id>`, not `/approvals/<id>`: the static build has no dynamic route, and a query needs no server rewrite. E9b uses this form.
- **Q6 [minor]** Remind now needs the mailbox in `assist` mode with the `create_draft` switch on (as the chaser); else 409 `drafts_off`.
- **Q9 [minor]** Edit limits: subject 1–200 characters, body 1–3000 (the Telegram card must fit 4096 characters).
- **Q11 [minor]** An edit restarts the 48 h approval time: the new version is a new request with its own card.
- **Q13 [minor]** An approved send that waits (held by `SEND_SCOPE`, a paused mailbox, a login error or a refused host) shows on the approvals page with Reject only, as the Telegram card.
- **Q15 [minor]** A panel decision on a reminder that belongs to a set does not edit the set card (`approval_set:`). The set tap answers with its counts. Stage 09.
- **Q14 [minor]** The OpenAPI file hides the operator routes and `/api/auth/*` (Better Auth). Reason: the E10 docs site publishes the file.
