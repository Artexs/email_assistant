# F102 stage 10 review (Sonnet, PASS) and follow-up

Review job `2026-11-15-f102-review-s10-sonnet-approvals-c5d5eba3`, candidate d17eb91d. Result: PASS, no blocking finding.

## Test gaps (closed in the follow-up commit)

- TG1: `web-approvals.test.ts` now sends a 9000-character mail through the detail route. The quote holds the first 8000 characters plus ` […]`, never 8001, and stays below `APPROVAL_QUOTE_MAX`. (Worst case by reading `quote.ts`: about 24 700 characters.)
- TG2: `apps/web/src/lib/account-card.test.tsx` now types its fake as `Me` (the `as unknown as Me` cast is gone) and sets `approvalsWaiting`. Typecheck proves the fake is complete.
- TG3: not changed. Reviewer mutations A (both `org_id` filters of `sendBase` removed) and B (A plus the mailbox guard removed) stay equivalent at route level: the org-scoped `getMailbox` and `getDraft` calls in `build` and RLS also stop a foreign send. T4 already covers a foreign org's waiting send in both directions (404 on the detail, absent from the list; the other organization sees only its own). The SQL filter is pinned by `actions-approval-reads.test.ts` (mutations M1b and M13 fail it).

## Notes

- N1: the 30 000 quote bound is a schema ceiling only. `quote.ts` cuts the mail at 8000 characters. Right call: 8000 would give a 500 on a long mail.
- N2: `held` with `heldBy` null means "approved, the committer takes it at its next run". Carry-over: stages 12 and 13 show it as "approved, sending soon", not as a block; stage 11 keeps the `approved` and `approved_held` answers apart.
- N3: a "send again" row is `approved` and can show briefly as `held`. Cosmetic.
- N4: `kind`, `version` and `expiresAt` are nullable in the detail. Carry-over: stage 12 types use the nullable forms.
- N5: schema move and the required `WebExtras.sendScope` are sound; nothing weaker in the 15 test files.
- N6: `approvalsWaiting` matches the stage text and T9. Mutation M1 is equivalent (the draft join carries the filter); M1b kills the pair.
- N7: `draftRemovable` closes the stage 08 review N5; T7 tests the false case.
- N8: the 100 limit applies in SQL before retention-cleared items drop out, so a list can hold fewer than 100 while more exist. No cursor, as `commands.md` says.
- N9: `docs/capabilities/tenancy-and-plans.md` line 32 says `approvals_page` has one reader (the panel link on the card). Now `approvalRoutes` and `approvalsWaiting` read it too. Carry-over: stage 19.
- N10: no migration, no `bun.lock` change, no ticket move, no log line. apiDocs `listApprovals`, `getApproval` hold.
- N11: the detail route checks the flag before the id: a bad id with the flag off is 404 (T1).
