# F143 stage 06 — core approval cards and notice views

Needs: nothing. May run next to every other stage.
Part of [`../plan.md`](../plan.md).

## Goal

`packages/core/src/digest/approvals.ts` (585 lines) and `packages/core/src/notices/views.ts` (419 lines) split by aggregate, as moves of top-level declarations (D5, D7).

## Step 1 — approval cards

- `digest/approvals.ts` keeps the card request: the quote and link helpers, the recipient lines, `renderApprovalRequest`, `renderApprovalSetRequest`, and the constants they use.
- `digest/approval-results.ts`: `SendResultKind`, the reason lists and `renderSendResult`, `renderFollowUpResult`, `renderDelegationAnswered`.
- `digest/approval-edit.ts`: `ApprovalEditOutcome`, `HeldBy`, `approvalEdit`.
- A helper both files use stays in the file of its topic with an internal export (no `shared.ts`).
- `digest/approvals.ts` re-exports by name every export that moved, so `digest/index.ts` and the importers keep `./approvals` (D7).

## Step 2 — notice views

- `notices/views.ts` keeps the shared field schemas, the type checks against the core types (`approvalViewMatches` …) and the kind-to-schema record.
- Move the view schemas of one family into `notices/views-approvals.ts`: the approval notice, the approval set, the send result and the delegation answer, with `sendResultKindSchema`. If `views.ts` is still over 400, move the digest views (`digestMinimalSchema`, `digestView`) into `notices/views-digest.ts`.
- The view schemas do not change: a queued notice of the last 24 hours must still parse (styleguide, notices are facts).

## Method (each step)

D5: copy the F091 scripts to `/tmp/f143-s06/`; `history-copies.sh` with the target dir and the new names; trim right after the history merge. Adapt the `/tmp` copy of `same-bodies.ts` so it reads the old file and its new siblings. D6 if `master` changes the file first.

## Test

No new test: behaviour does not change. Move proofs in `/tmp/f143-s06/<file>/`:

1. Adapted `same-bodies.ts`: `SAME_BODIES <n>`, exit 0, for each step.
2. `exports-of.ts` of the base file equals that of the new file.
3. Each new file: `git log --follow` reaches the first commit of its old file.
4. `wc -l` of each changed or new file ≤ 400.
5. `git diff --name-only <base> HEAD` lists only `digest/approval*.ts`, `notices/views*.ts` and docs (no importer, no test).
6. Mutation check (once): change one schema bound in a copy; `same-bodies.ts` exits 1 naming it. Revert. Write it in the final message.

Existing guards, unchanged: the `notices/` and `digest/` tests, `core/triage/draft-kinds.test.ts`, and the server notice-sender tests in the integration suite.

## Done when

- Checks 1–6 passed; the logs are named in the final message.
- Proof: `mkdir -p /tmp/f143-s06 && bun run lint > /tmp/f143-s06/lint.log 2>&1 && bun run typecheck > /tmp/f143-s06/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f143-s06/unit.log 2>&1 && bun run test:int:ci > /tmp/f143-s06/int.log 2>&1 && echo PROOF_OK`

## Out of scope

`digest/digest.ts` (477 lines, warning only). A change of a view schema or a card text.
