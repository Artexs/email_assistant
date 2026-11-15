# F102 stage 10: approvals read API (notes for stages 11–13)

Code: `packages/core/src/web/approvals.ts` (schemas), `apps/server/src/modules/channels/approvals-read.ts` (read model),
`approval-routes.ts`, `approval-api-docs.ts`; `actions/repo/approval-reads.ts` (`listApprovalSends`, `countWaitingApprovals`);
`web.ts` (`approvalsWaiting`, `WebExtras.sendScope`). Tests: `web-approvals.test.ts`, `actions-approval-reads.test.ts`,
`packages/core/src/web/approvals.test.ts`.

## Choices where the stage text was silent (the coordinator may overrule)

- Detail schema: `kind`, `version`, `view` and `expiresAt` are nullable (the stage said only `view`). Reason: a send whose
  payload retention cleared has no kind and no version; `expiresAt` has a meaning only for `waiting` and `held`.
- `quote` bound: 30 000 characters, not 8000. The quote is the mail text cut at 8000 characters plus a header and `> ` before
  each line, so the answer can pass 8000. A 500 on a long mail would be worse than a loose bound.
- List: an `approved` send with no fresh lock is `held` also when `heldReason` finds nothing (`heldBy` null): the committer
  takes it at its next run. `sending` (a fresh lock, or `applying`) is never in the list.
- `approvalViewFor` returns the full `quote` too and accepts a `draftRow` the caller already read. The card path is unchanged.
- `approvalViewSchema` and `panelUrlSchema` moved to `packages/core/src/outgoing/view-schema.ts` (the notice views and the
  web schemas both use them; `@ea/core` still exports `panelUrlSchema`).
- `WebExtras.sendScope` is new and required (the held reason needs it). `main.ts` passes the one `scopeOfSends`.
- The list reads about 12 queries per item (the card builder), at most 100 items.

## For stage 11 (write API)

- `stateOf` in `approvals-read.ts` is the one map from `actions.status` to the panel state; the write routes should answer
  `closed` with the same names.
- Carry-over from review 8 N5 is closed here: the detail carries `draftRemovable`.
