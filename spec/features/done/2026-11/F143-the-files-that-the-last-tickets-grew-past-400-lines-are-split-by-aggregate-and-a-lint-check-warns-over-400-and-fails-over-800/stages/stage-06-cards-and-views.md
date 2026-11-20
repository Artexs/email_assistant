# F143 stage 06 — core approval cards and notice views

Needs: nothing. May run next to every other stage.
Part of [`../plan.md`](../plan.md).

## Goal

`packages/core/src/digest/approvals.ts` (585 lines) and `packages/core/src/notices/views.ts` (419 lines) split by aggregate, as moves of top-level declarations (D5, D7).

## Step 1 — approval cards

- `digest/approvals.ts` keeps the card request: the quote and link helpers, the recipient lines, `renderApprovalRequest`, `renderApprovalSetRequest`, and the constants they use.
- `digest/approval-results.ts`: `SendResultKind`, the reason lists and `renderSendResult`, `renderFollowUpResult`, `renderDelegationAnswered`.
- `digest/approval-edit.ts`: `ApprovalEditOutcome`, `HeldBy`, `approvalEdit`.
- A helper that `approvals.ts` and `approval-results.ts` both use goes to a leaf file `digest/approval-text.ts` that imports neither (D16: `approvals.ts` re-exports the results file, so a helper import back into it is a value cycle).
- `digest/approvals.ts` re-exports by name every export that moved, so `digest/index.ts` and the importers keep `./approvals` (D7).

## Step 2 — notice views

- The shared field schemas (`isoDate`, `id`, `draftKind`, `text`, `nullableText`, `timeZone` and the like) go to a leaf file `notices/view-fields.ts` that imports no other view file (D16; a review repro showed `Cannot access 'id' before initialization` for the cycle).
- `notices/views.ts` keeps the type checks against the core types (`approvalViewMatches` …) and the kind-to-schema record.
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
- Proof: `plan.md` § Proof with `NN=06`.

## Out of scope

`digest/digest.ts` (477 lines, warning only). A change of a view schema or a card text.
