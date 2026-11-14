# F106 plan review 1 — the planner's response

Review: [plan-review-1.md](plan-review-1.md) (FAIL, candidate 33a6f706, 11 stages). The plan now has 12 stages. Each finding and its answer:

| Finding | Answer | Where |
| --- | --- | --- |
| B1 Digest and approval-set rows keep the erased mail (no `email_id`, sender cut to 40 characters) | Fixed. A registry `NOTICE_MAIL_CONTENT` per notice kind (typecheck covers new kinds); `many_mails` rows since the earliest erased mail: sent or failed → `[removed]`, pending digests dropped, as `delete_mailbox`. Test with a 55-character address. | D19, new stage 09 |
| N1 `AuditData` is flat; nested `counts` fails typecheck | Fixed. Flat keys for every new audit event, named once. | stage 02, `dsrAuditData` in stage 07, stage 08 step 8 |
| N2 Rule conflict: no address in stdout vs `org:delete` address lines | Fixed. The test rule names the exception. | plan § Rules |
| N3 `users` columns: excluded with a reason vs "only secrets" | Fixed. `users` is an allow-list; the "only secrets" rule is for `org_id` tables. | stage 05 |
| N4 Contact-form mail (person only in Reply-To) is kept | Fixed. A mail whose only Reply-To is the person goes (Q14). | D9, stage 06 test 2 |
| N5 Per-organization tombstone vs per-mailbox mail rule | Fixed. The mail rule uses all mailbox addresses of the organization, so one mail gets one answer in every mailbox. | D9, stage 06 test 2 |
| N6 A chunk planned before the erase can insert `#2` | Fixed. Tombstones hash the base key without `#n`, in the trigger and in `tombstoneKeyHash`. | D3, stage 01, stage 08 test 4 |
| N7 F104 `sent_emails` escapes the tombstone | Fixed. Stage 01 test 9 fails for any mail table without the trigger; D18 names F104. | D18, stage 01 |
| N8 A backup restore brings deletes and erases back | Fixed in the runbook: keep each CLI record line off the server, repeat after a restore (Q15). | D20, stage 10 |
| N9 `blocked` is certain for chain references, with no next step | Fixed. Kept-mail actions that point at an action of a mail that goes are deleted with it (counted `chain_actions`); `blocked` stays only for an unknown FK, and the runbook says to report it. | D10, stages 06, 08 |
| N10 "Reuse the sign-in failure path" needs guessing | Fixed. `recordPasswordFailure` in `platform/auth-lockout.ts`, with its deps, shared by the hook and the route. | stage 03 |
| N11 `rename` can replace a file that appears late | Fixed. `wx` open of the part file, `link` + `unlink` at the end. | stage 05 |
| N12 An `approval_set` row cascades with its first mail | Answered. Erase refuses while a send or draft of a mail that goes is open, so only sent history rows go; sent sets of kept mails are blanked. | D10, stage 09 tests 5–6 |
| N13 The runbook omits Telegram | Fixed. Delivered messages stay in the chat; the owner deletes them there. | stage 10 |
| N14 A 401 poll can win against the 200 handler | Fixed. The login page shows the list whenever the session key exists. | stage 04 |
| N15 2FA attempt rows stay; `OPERATOR_USER_IDS` can dangle | Attempt rows: accepted (no user link, value `"0"`). `OPERATOR_USER_IDS`: runbook line. | stage 10 |
| Unverified F3, F5 (no network or DB in the review job) | The planner ran both probes (age 1.3.2 decrypt; Postgres 18.6 regex) before the commit; plan § Facts. | plan F3, F5 |
| Backfill lock (checked true by the review) | Recorded as F8; the "stop and ask" line of stage 08 is gone. | plan F8, stage 08 |
