# F091 · Repository split and table-driven apply: plan input

> Written 2026-11-13 from the architecture review §3.3 and §3.8. Input of the `plan-task` session. Ticket: [ticket.md](ticket.md). Runs after F088 and F090. No migration. It touches many files of `actions` and `mail`: no other job in those modules at the same time.

## Facts (2026-11-13)

- `actions/repo.ts` exports (by area): claims (`claimActions`, `countClaimable`, `countHeldSends`, `releaseAction(s)`, `markApplying`, `finishAction`, `updateProviderResult`, `expireStaleReady`), originals and undo (`lockActionsForUndo`, `insertReverse`, `lockLatestOriginalMove`, `markUndone`, `countReadyOriginals`, `expireReadyOriginals`), notify (`listFailedUnnotified`, `markNotified`, `listSendsToNotify`, `listSetsToNotify`, `listSendResultsToNotify`, `markResultNotified`), sends and drafts (`sendBase`, `lockSend`, `getSend`, `lockDraft`, `getDraft`, `draftHasReverse`, `listSendsOfDraft`, `setExpired`, `expireReadyDraft`, `listOpenReminderSends`, `setApproved`, `setRejected`, `listSetSends`, `findSendByKey`, `insertSendAgain`, `listExpiredApprovals`, `listUnseenApprovalSends`, `listAwaitingSendIds`, `countApprovals`), reads (`isOwnActionId`, `createPlanned`, `setDelegationId`, `listActionsForEmail(s)`, `listSummaries`, `listDraftTasks`, `countActionsSince`), retention (`clearActionPayloads`, `clearActionErrors`).
- `mail/repo.ts` exports: mailboxes, folders and cursors, credentials, emails (insert, uid, returned, relocated, location), claims (`claimEmails`, `releaseEmail`, `finishEmail`), targets (`listSyncTargets`, `listMailboxTargets`, `countSyncTargets`, `listAuthErrorMailboxesBefore`), thread and lookup, retention (`clearMailBodies`, `clearMailHeaders`).
- `apply.ts:383` `applyAction` branches on `action.type` with four `if`s; `drafts.ts` and `send.ts` hold the other two handlers; `apply.ts` ↔ `drafts.ts` and `apply.ts` ↔ `send.ts` are import cycles (madge).
- `transitions.ts` is data; `actions-transitions.test.ts` compares it with the guards and the Postgres CHECK lists.
- The places a new action type or draft kind touches today: `core/triage/planners.ts` (`actionTypes`, `PlannedAction`), `core/triage/payloads.ts`, `core/outgoing/templates.ts`, `apply.ts`, `transitions.ts`, the `actions.type` CHECK, `core/digest/approvals.ts`, `channels/notices.ts`, `web/lib/activity-text.ts`, `docs/architecture.md` §4.6.

## Design decisions

- **D1 Move, do not rewrite.** Each function moves whole with `git mv`-friendly diffs (create the new file from a slice of the old one), so blame survives. Shared private helpers (`DbOrTrx`, `sendBase`, `toSendRow`) go to `repo/shared.ts`. `repo/index.ts` re-exports everything the module index exported, so `actions/index.ts` changes one import path.
- **D2 Aggregates.** `actions/repo/`: `claims.ts`, `sends.ts`, `drafts.ts`, `undo.ts`, `notify.ts`, `expiry.ts`, `reads.ts`, `retention.ts`, `shared.ts`. `mail/repo/`: `mailboxes.ts`, `folders.ts`, `credentials.ts`, `emails.ts`, `claims.ts`, `targets.ts`, `lookup.ts`, `retention.ts`, `shared.ts`. The plan-task session adjusts the names from the list above; the rule is one aggregate per file and under 400 lines.
- **D3 Handler table.** `apply.ts`: `const handlers: Record<ActionType, ApplyHandler> = { move: applyMove, flag: applyFlag, mark_read: applyFlag, save_summary: applySummary, create_draft: applyDraft, send: applySend }`; `applyAction` resolves the provider and sender needs from a `needs` field of the handler (`{ provider: boolean, sender: boolean }`) and calls it. `drafts.ts` and `send.ts` import shared helpers from `apply-shared.ts`, not from `apply.ts`, which ends the two cycles.
- **D4 Completeness test.** Unit: `actionTypes` = keys of `handlers` = the types in `ACTION_ENTRIES` = the union of `PlannedAction["type"]`; draft kinds of `draftPayloadSchema` = keys of `renderTemplate` branches (make `renderTemplate` a record too). Integration: `actionTypes` = the `actions_type_check` list from `pg_constraint`.
- **D5 Checklist.** `docs/code-patterns.md` § "Add an action type or a draft kind": the nine places of the facts list, in order, each with the test that fails when it is missed.

## Stages

1. **Split `actions/repo.ts`.** Files: `actions/repo/*.ts`, `actions/index.ts`, the imports inside `actions/*.ts`. Check: typecheck, unit, int (`actions-*` tests) unchanged.
2. **Split `mail/repo.ts`.** Files: `mail/repo/*.ts`, `mail/index.ts`, the imports inside `mail/*.ts`. Check: as stage 1 (`mail-*`, `imap-*` tests).
3. **Handler table and completeness test.** Files: `actions/apply.ts`, `actions/apply-shared.ts`, `actions/drafts.ts`, `actions/send.ts`, `actions/apply.test.ts` (new unit test), `apps/server/test/integration/actions-schema.test.ts` (the CHECK comparison), `core/outgoing/templates.ts` (record form) and its test. Check: `madge --circular` shows no `apply` cycle; `actions-*` integration tests unchanged.
4. **Docs.** Files: `docs/code-patterns.md` (checklist, file-size rule), `docs/modules.md` §3.2 and §3.5, `.agents/limen/styleguide.md`.

Parallel: stages 1 and 2 at once (different modules). Stage 3 after 1. Stage 4 last.

## Done when

- The four acceptance lines hold.
- `wc -l` of every file under both `repo/` folders is under 400; the two old files are gone.
