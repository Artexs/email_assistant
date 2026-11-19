# F068 scouts

Three scouts ran at plan base b1003651 (claude-sonnet-5-5, medium). Each packet below is the scout's assistant text, copied whole from its session log. A packet is a lead, not a fact: plan.md § Facts checked lists what the planner read in the code.

## Scout 1

- Question: Every writer of actions.status at HEAD, its guard, its to-status and its WRITER_GUARDS row; writers without a row and rows without a writer.
- Job: `2026-11-19-f068-scout-1-c0a1b103`

### Packet

Writing the note update and answering.
Packet: every writer of `actions.status` at HEAD, with its guard, to-status and `transitions.ts` entry.
Base: b1003651
Verified: `rg -n -i "updateTable\(.actions|insertInto\(.actions" apps/server/src` -> 26 hits, all read; `git status --short | wc -l` -> 0
Unknowns: none. I read the guards in `repo/*.ts`. I did not run the transitions tests.

**Writers of `actions.status`.** All are in `apps/server/src/modules/actions/repo/`. Every update filters on `org_id`. `released`/`held` below mean the lock rules of the repo code.

| Function (file) | WHERE guard | To-status | Entry |
|---|---|---|---|
| `markApplying` (`lifecycle.ts`) | `locked_at = lockedAt` AND ((`type='send'` AND `status='approved'` AND `approved_at` not null) OR (`type<>'send'` AND `status IN (ready, approved)`)) | applying | WRITER_GUARDS `markApplying/default`; E2, E3 |
| `finishAction` (`lifecycle.ts`) | `status IN opts.from` (default `ready, applying`) AND `locked_at = lockedAt`. No type guard. | applied / failed / expired | `finishAction` default, `from ["applying"]`, `from ["approved"]`; E1, E4–E8, E21, E22 |
| `releaseAction` (`lifecycle.ts`) | `status IN (ready, approved, applying)` AND `locked_at = lockedAt`. No type guard. | `opts.toStatus` (ready / approved / applying) | `releaseAction` three variants; E9–E13 |
| `expireStaleReady` (`expiry.ts`) | `status='ready'`, `reverses_action_id` null, `type IN` mailbox types, `created_at < now-CLAIM_MAX_AGE`, `locked_at` null or `< staleBefore`, email in the mailbox | expired (`stale`) | `expireStaleReady`; E14a |
| `expireReadyOriginals` (`expiry.ts`) | `status='ready'`, `reverses_action_id` null, `type IN filter.types`, `locked_at` null or `< staleBefore`, mailbox, optional email and category | expired (`policy_changed`, `undo`, `manual`) | `expireReadyOriginals`; E14b |
| `expireReadyDraft` (`drafts.ts`) | `type='create_draft'`, `reverses_action_id` null, `status='ready'`. No lock check. | expired (`send_closed`) | `expireReadyDraft`; E14c |
| `setExpired` (`sends.ts`) | `type='send'`, `status = opts.from` (`awaiting_approval` or `approved`). For `approved` without `ignoreLock`: `locked_at` null or `< staleBefore`. | expired | `setExpired` two variants; E18, E19 |
| `setApproved` (`sends.ts`) | `type='send'`, `status='awaiting_approval'` | approved | `setApproved`; E15 |
| `setRejected` (`sends.ts`) | `type='send'` AND (`awaiting_approval` OR (`approved` AND `locked_at` null or `< staleBefore`)) | rejected | `setRejected` two variants; E16, E17 |
| `markUndone` (`undo.ts`) | `status='applied'`. No type guard. | undone | `markUndone`; E20 |
| `insertReverse` (`undo.ts`) | none (insert, `ON CONFLICT (org_id, idempotency_key) DO NOTHING`, sets `reverses_action_id`) | ready | ACTION_ENTRIES `insertReverse` (no edge) |
| `insertSendAgain` (`sends.ts`) | none (insert, key `<id>:again`, `approved_at` set) | approved | ACTION_ENTRIES `insertSendAgain` |
| `insertEditedPair` (`edit.ts`) | none (two inserts, keys `<old>:edit`, `supersedes_action_id` set) | ready (draft), awaiting_approval (send) | ACTION_ENTRIES `insertEditedPair` |
| `insertPlanned` (`planned.ts`), reached through `createPlanned` and `createPlannedForLoop` | none (insert, `ON CONFLICT DO NOTHING`; status = `item.status`: ready / awaiting_approval / logged) | ready / awaiting_approval / logged | ACTION_ENTRIES `createPlanned` |

**Outside the actions module.** Only seed scripts write a status, and they are test data:
- `scripts/e2e-review-rows.ts:79` inserts `save_summary` as `applied`.
- `scripts/e2e-activity-rows.ts:105` (`insertAction`) inserts any status.
- `scripts/e2e-delegations-rows.ts:110` updates only `payload`.

**Code that touches `actions` and does not write status.**
- `claimActions` (`claims.ts:217`) writes `locked_at`.
- `releaseActions` (`lifecycle.ts:145`) clears `locked_at`.
- `updateProviderResult`, `markNotified`, `markResultNotified`, `setDelegationId`, `clearActionPayloads`, `clearLoopSentCopies` and `clearActionErrors` write other columns.

**Gaps (observed):**
1. No writer lacks an entry. The 14 `ActionWriter` names match the 14 functions above.
2. No `WRITER_GUARDS` entry lacks a writer. Every one of its 15 rows maps to a function above.
3. Two edges have no `WRITER_GUARDS` entry. `E1`–`E22` are `ACTION_EDGES` ids and `WRITER_GUARDS` has no ids. The edges E21 and E22 exist only in `ACTION_EDGES`, as `finishAction` edges. Their guard variants are `finishAction/default` (E22 `ready`→expired) and `finishAction from ["approved"]` (E21).
4. The `ACTION_ENTRIES` callers list for `createPlanned` is incomplete. It names `triage/service.ts` and `delegation/chaser.ts`. These also call `createPlanned` or `createPlannedForLoop`: `loops/delegate.ts:210`, `loops/follow-up-draft.ts:228` and `delegation/remind.ts:63`. Those three pass `ready` and `awaiting_approval`.
5. `releaseActions` (`lifecycle.ts:145`) guards on `status IN (ready, approved, applying)` but does not write status, so it correctly has no entry.
6. The `WRITER_GUARDS` `expireReadyOriginals` entry lists only the three mailbox types. The SQL filters on `filter.types`, which the caller supplies. I did not check whether that can include non-mailbox types.

Checks: `transitions.test.ts` and `test/integration/actions-transitions.test.ts` are the existing checks on this file. I read neither and ran neither.
Note check
- Writer list complete: not proven. The `rg` run was in a call that used `;` and `|`, so it does not count as proof. The list also hand-checked hits only through `sed` reads.
- Guard mapping to WRITER_GUARDS and edges (including entries without a writer, writers without an entry): not proven. The basis is a read of `apps/server/src/modules/actions/transitions.ts`, which is a file read and not a command. I did not run `transitions.test.ts` or `actions-transitions.test.ts`. Open item: whether `expireReadyOriginals` can receive non-mailbox types from `filter.types`.
- Answer for the code at HEAD: not proven. The worktree was at `b1003651`, but my `git rev-parse` ran in a `;` call. I did not verify that HEAD stayed unchanged.

Easy-to-miss rule ("Do not edit, create, or delete files"): not proven. The `git status --short | wc -l` check ran in a `;` call and the result was piped, so it proves nothing. Also, I wrote `note.md` in the job folder outside the worktree, as the Limen instruction required. The worktree itself should be clean, but I have no valid evidence.

The note I saved says `Not proven yet: none`. That is wrong under these rules. It should list the writer list, the guard mapping and the read-only rule as not proven.

## Scout 2

- Question: The latent edges L1-L8 and the extra latent edges of F067 stage 2: writer, dependency of real flows, close or keep.
- Job: `2026-11-19-f068-scout-2-a5f7a057`

### Packet

Packet: latent edges L1–L8 and the extra stage-2 latent edges in F067's plan and `transitions.ts`: what lets each through, what depends on it, close or keep.
Base: b1003651
Verified: `git status --short` (worktree clean) -> empty output. I ran no test. All findings come from reading `transitions.ts:382-620`, `repo/lifecycle.ts`, `repo/undo.ts` and a grep of every caller.

Unknowns:
- I did not run `actions-transitions.test.ts`, so I did not re-prove the "guard edges = design + latent" test at HEAD.
- Rows I have not checked in a database: whether any non-send row is ever `approved`, or any non-draft, non-send row ever `applying`. This rests on the plan's CHECK claim and the `setApproved` type guard. I did not read the CHECK or `setApproved`.
- Plan correction: plan L5 says the only `from: ["approved"]` caller passes `failed`. At HEAD it has two callers. `send-failure.ts:54` passes `failed` and `send-close.ts:62` passes `expired` (`loop_closed`, edge E21, a real flow). So `approved → expired` through `finishAction` is NOT latent. Only `approved → applied` is, and `transitions.ts` lists only that one.

**Writer guards at HEAD** (SQL has no type guard on any of them; all four are in `repo/lifecycle.ts` and `repo/undo.ts`)
- `markApplying`: `send` needs `approved` with `approved_at`. Every other type is admitted from `ready` or `approved`.
- `finishAction`: `from` defaults to `ready`, `applying`. The target is any of `applied`, `failed`, `expired`.
- `releaseAction`: from `ready`, `approved` or `applying`, to a `toStatus` parameter.
- `markUndone`: from `applied` only.

**Edge table**

| ID | Writer: from → to | Types admitted but unused | Production use of the nearby edge | Rec |
|---|---|---|---|---|
| L1 | `releaseAction`: `ready`/`approved` → `ready`/`approved`/`applying`, `applying` → `ready`/`approved`/`applying` | the latent combinations listed in `transitions.ts:561-590` | Real callers pass `ready` (soft-error retry `apply.ts:88,130`, `drafts.ts:176`), `approved` (send limit `send-limit.ts:64`, `send.ts:67`, `send-failure.ts` ×5) or `applying` (`drafts.ts:176`, `send-failure.ts:286`). `apply.ts:380` and `send.ts:52` use `toStatus: action.status`, so the row's own status is the target. | Close with a per-type allowed `from`/`to` table. Keep every real retry edge (soft retry, limit hold, no-provider hold, draft `applying` → `applying`). |
| L2 | `markApplying`: `ready` → `applying` (mailbox, `save_summary`); `approved` → `applying` (non-send) | move, mark_read, flag, save_summary; any non-send from `approved` | `drafts.ts:261` (draft, `ready` or `approved`) and `send-limit.ts:44` (send, `approved`) | Close: `create_draft` from `ready`/`approved`, `send` from `approved`. Tests at `actions-repo.test.ts:1619-1637` and `actions-send-started.test.ts:63-96` use only draft and send. |
| L3 | `finishAction` default: `ready` → `expired`, mailbox and `save_summary`; `ready` → `applied` for an original draft | | `drafts.ts:206` (`send_closed`, draft, from `applying`/`ready` after `expireSend`), `apply.ts:52` (`save_summary` `ready` → `applied`) | Close the `expired` edge for non-drafts. KEEP `ready → applied` for `save_summary`: `applySummary` writes it. The list only blocks `ready → expired` and `ready → failed` for `save_summary`, so it is correct. |
| L4 | `markUndone`: `applied` → `undone` for `send` | send | `apply.ts:218,308` (reverse rows), `drafts.ts:465` (draft), `triage/returned.ts:43` (move) | Close: allow mailbox types and `create_draft` only. |
| L5 | `finishAction` with `from: ["approved"]`: `approved` → `applied` for `send` | send | `approved → failed` (`send-failure.ts`) and `approved → expired` (`send-close.ts:62`) are real | Close `approved → applied` only. KEEP `approved → expired` (`loop_closed`, E21) and `approved → failed`. |
| L6 | `finishAction`: `applying` → `expired` for a send | send, and non-draft types | `drafts.ts:206` is the only `send_closed` writer, and it writes a draft. | Close for non-draft types. |
| L7 | `markUndone`: `applied` → `undone` for `save_summary` | save_summary | `apply.ts` does not undo a summary. | Close, together with L4. |
| L8 | `finishAction` default `from`: `ready` → `applied`/`failed`/`expired` for an original draft | original `create_draft` | Real: reverse draft rows only (`drafts.ts:302` E1, `drafts.ts:74` E5). An original draft is `applying` first, via `markApplying`. | Needs a per-row condition (reverse vs original), which the guard does not have today. See the `reverses_action_id` risk below. |

**Extra stage-2 latent edges** (the `LATENT_EDGES` entries not tagged L1–L8, `transitions.ts:509-620`)
- `releaseAction`: `ready → ready` for `save_summary`. Close; `apply.ts` skips `save_summary` before the release.
- `finishAction`: `applying → applied`, `applying → failed`, `applying → expired` for mailbox types and `save_summary`. Close: only a draft or send is `applying`. Tests at `actions-repo.test.ts:440-457` finish mailbox rows from `ready`, not `applying`.
- `finishAction`: `ready → failed` for `save_summary`. Close.
- `releaseAction`: `approved → applying` for all types, `applying → applying` for mailbox and `save_summary`. Close for non-send, non-draft. KEEP for send (`send-failure.ts:286`) and draft (`drafts.ts:176`).

**Retry, undo, expiry, reply-pass check**
- Retry: all real edges are `ready → ready`, `approved → approved`, `applying → applying` and `applying → approved`, written by `releaseAction`. A closure that blocks same-status or `applying → approved` for sends would break retry.
- Undo: `applied → undone` for mailbox types and drafts through `markUndone`. The reverse row finishes `ready → applied` (E1) without `markApplying`. A closure must keep that path.
- Expiry: `expireStaleReady`, `expireReadyOriginals`, `expireReadyDraft` and `setExpired` are separate writers with their own type guards. No latent-edge change touches them. The finishAction `send_closed` and `loop_closed` edges stay (E21, E22).
- Reply-pass: `reply-pass.ts` has no status writer (grep found no `finishAction`, `release` or `markUndone`). It does not depend on any latent edge.

1. `apps/server/src/modules/actions/transitions.ts:382` — `WRITER_GUARDS` lists the per-type admitted `from` sets; `:509` — `LATENT_EDGES` lists what the guards admit beyond the design edges; the runtime step must tighten the SQL to match. — observed
2. `apps/server/src/modules/actions/repo/lifecycle.ts:10,56,104` — `markApplying` has a type guard, but `finishAction` and `releaseAction` filter only by status. A runtime closure must add type or `reverses_action_id` conditions there. — observed
3. `apps/server/src/modules/actions/repo/undo.ts:8` — `markUndone` has no type filter, which is the source of L4 and L7. — observed
4. `apps/server/src/modules/actions/send-close.ts:62` — the call passes `from: ["approved"]` with `expired`, which makes `approved → expired` real and contradicts the plan's L5 wording. — observed
5. `apps/server/src/modules/actions/apply.ts:380` and `send.ts:52` — `toStatus: action.status` makes the release target dynamic; a per-target closure must still admit same-status releases. — observed

Checks: `apps/server/test/integration/actions-transitions.test.ts` (the F067 test A) covers guard edges = design + latent edges, per the plan; misses a closed edge, since the plan says no test exercises the latent targets of `releaseAction` and `markApplying` — guessed (I did not run it). `actions-repo.test.ts:1619-1684` covers `markApplying`/`finishAction` `from: ["approved"]` on a send and a draft; misses any non-send/non-draft row on these writers.
Note check
- Edge table (L1–L8 plus extra edges, with from, to, type, writer, dependency, rec): not proven. I read `transitions.ts:382-620`, `repo/lifecycle.ts` and `repo/undo.ts`, but I made those reads and greps in calls that used `;` or `|`. No qualifying command or saved log backs this line.
- Dependency evidence (retry, undo, expiry, reply-pass): not proven. The caller and test greps came from reads and piped or `;` calls, so none qualifies. I did not run `actions-transitions.test.ts`. I did not read the CHECK constraint or `setApproved`, so I did not confirm that no non-send row is `approved`.
- Packet format and clean worktree: proven. `git status --short && git rev-parse --short HEAD` exited 0 with empty status and printed `b1003651`.
- Obligation missing from the earlier note: changed. The packet corrects plan L5, because `send-close.ts:62` makes `approved → expired` a real edge. No check covered that.

Easy-to-miss rule ("Read, search, and run existing checks. Do not edit, create, or delete files."): followed. `git status --short && git rev-parse --short HEAD` exited 0 with empty status output. I wrote only the note under `.limen/jobs/`, which is outside the worktree.

Remaining gaps: the edge table and the dependency evidence rest on reads that Limen cannot count as proof. The scout rules forbid editing or creating files, so I saved no log. I did not run the transitions test. The job is not complete on those two checks.

## Scout 3

- Question: The actions.status writers on the send path: guards, transactions, use of the update result, covering tests; how tests A, B and C check WRITER_GUARDS.
- Job: `2026-11-19-f068-scout-3-33990558`

### Packet

Now the writer code.
Now test names for the key files.
Packet: Which `actions.status` writers sit on the send path, with guard, transaction, result use and tests; and how tests A, B and C check `WRITER_GUARDS`.
Base: b1003651
Verified: `cd apps/server && bun test src/modules/actions/transitions.test.ts` -> `error: Cannot find module '@ea/core'` (the worktree has no node_modules; the check did not reach the code). Everything below comes from reads.
Unknowns:
- I did not run any test. Test names below are from `grep` of the `test(` lines, not from a run.
- Test A/B/C labels: only Test C is named in a file comment (`actions-transitions.test.ts:56`). Test B is named at lines 98 and 320. Test A is named in the `transitions.ts:9` header only. The mapping to the files is my reading of those comments.

**Writers that write status (observed)**

All guards use `locked_at = <claim token>` plus `org_id`. Each function returns `numUpdatedRows > 0n`.

1. `repo/lifecycle.ts:10` `markApplying`.
   - Guard: `send` needs `approved` and `approved_at` not null. Other types need `ready` or `approved`.
   - Runs in a transaction: `send-limit.ts:22` `startSendWithinLimits`, called from the `inTransaction` in `send.ts:118`. It takes `lockMailboxSends` first, then the limit check, then `markApplying`, then the audit row.
   - On `false` the send returns `{kind:"lost"}` (`send-limit.ts:44-49`, `send.ts:132`). No SMTP call. This is the at-most-once point: after it commits, nothing resends.
   - Tests: `actions-send.test.ts` "(11) a wrong locked_at is lost before markApplying and sends nothing", "the row is committed as applying with the outgoing id before the SMTP call". `actions-send-limit.test.ts` "(6) the second send waits for the lock, sees the 20th send and is held". `actions-repo.test.ts` "7: markApplying needs the token and the status approved or ready". `actions-send-started.test.ts` "(3) a released and marked-again send gets the time of the second try".

2. `repo/lifecycle.ts:56` `finishAction`.
   - Guard: `status IN (opts.from ?? ["ready","applying"])`, with the claim token.
   - `send-finish.ts:18` `finishApplied`: own transaction (`inTransaction`), `from:["applying"]`. Then the audit row, delegation and loop hooks, and the reverse draft row in the same transaction.
   - `false` returns `lost` (`send.ts:165`, `:207`). The mail already went out, so the row stays `applying` and a later recovery run ends it as `outcome_unknown` (`send.ts:164` comment).
   - Tests: `actions-send.test.ts` "(1) the happy path…", "(1b) a crash before the Sent copy leaves the row applied…", "(15) a crash after the 250 never sends again: the recovery ends outcome_unknown", "(16) a copy in Sent proves the send: the recovery ends applied". `actions-follow-up-concurrency.test.ts` "each send ends applied with one mail, or expired / loop_closed with none; no deadlock".
   - `send-failure.ts:30` `failSend`: own transaction. `finishAction` with `status:"failed"` and `from:[failure.from]` (`approved` or `applying`). Then audit, then the delegation `onCancelled` hook. `false` returns `lost`.
   - Tests: `actions-send.test.ts` "(5) a permanent envelope error fails the send as smtp_rejected…", "(6) a 4xx after the content fails at once as smtp_error, no retry", "(7) an unknown stage fails as outcome_unknown at once with one send and no second claim", "(11b) a bad send payload fails as bad_payload from approved with no send", "(6d) a compose error three times fails with stage compose and sends nothing". `actions-copy-check.test.ts` "7c. a hard error counts: the third one fails copy_check_error (not smtp_error), no SMTP call".
   - `send-close.ts:30` `closeSendOfClosedLoop`: runs in the caller's transaction (`send.ts:118`, after `isOpen` took the loop lock). `finishAction` with `expired` / `loop_closed` and `from:["approved"]`. `false` returns `lost`.
   - Tests: `actions-follow-up-concurrency.test.ts` (above) and `actions-copy-check.test.ts` "8b. the loop lock comes first…".

3. `repo/lifecycle.ts:104` `releaseAction`.
   - Guard: `status IN (ready, approved, applying)` plus token. Writes `toStatus`, clears the lock, and optionally adds one attempt.
   - Called with `deps.db`, so each call is its own statement and not in a transaction. Called from `send.ts:52, :67` and `send-failure.ts:129, :158, :172, :216, :238, :286`. The return value is discarded in those calls.
   - Exception: `send-limit.ts:64` (`held` path) is inside the limit transaction, and it checks the result (`!(await releaseAction…)` -> `lost`).
   - Tests: `actions-send.test.ts` "(4) a soft connect error retries after 5 min with no count…", "(8) an auth error gives the row back as approved and unlocked", "without a sender an approved row is released unchanged with no count", "a claimed send whose draft is no longer applied is released as approved with no count (P1 re-check)", "(23) an error inside the recovery keeps the row applying and never resends". `actions-send-limit.test.ts` "(1) a send over the hour limit is held…". `actions-repo.test.ts` "9: releaseAction sets toStatus; releaseActions keeps the statuses".

4. `repo/sends.ts:211` `setExpired`.
   - Guard: `type='send'`, `status = opts.from` (`awaiting_approval` or `approved`). For `approved` without `ignoreLock`, also `locked_at` null or older than `staleBefore`.
   - Caller `expiry.ts` `closeLockedSend` (line ~60-90): locks the row first with `lockAnySend` (`FOR UPDATE`), reads the status, and branches on it. `applying` returns `busy`. Then `setExpired`; `false` returns `lost`. Then audit, draft close and delegation hook, all in the caller's transaction.
   - `send-close.ts:21` `closeForReason` runs this in `inTransaction` with `claimed:true`, which sets `ignoreLock`. Non-closed returns `lost`.
   - Tests: `actions-expiry.test.ts` "(9) a tap that wins the race: expireSend returns false and writes nothing", "(9b) held_timeout on an approved send with a fresh lock: false, nothing changes". `actions-close.test.ts` "an approved send". `actions-copy-check.test.ts` "2/3. … changed → draft_changed, zero SMTP calls, the copy stays".

5. `repo/sends.ts:267` `setApproved` (approval tap, same function family; `approvals.ts:168`).
   - Guard: `type='send'`, `status='awaiting_approval'`. A `false` result throws `HardError("a locked awaiting_approval send did not change")`. The row was locked before (`lockSend`).
   - `repo/sends.ts:291` `setRejected`: `awaiting_approval`, or `approved` when unlocked or stale. A `false` result returns `already` or `superseded` (`approvals.ts:215`).
   - Tests: `actions-approvals.test.ts` "awaiting_approval → approved with the approval fields and an audit row; a second tap → already_approved", "an approved send: rejected when unlocked or stale, already when a run holds it". `web-approvals-races.test.ts` "two approves at once: both 200 approved, one audit row", "approve and reject at once: the send ends rejected, never approved after the reject". `actions-send.test.ts` "(18) two approval taps and one committer run send once", "(19) an expired or rejected send is never claimed".

**Files in the list that write no status (observed)**

- `send-prepare.ts`: pure payload check and message build. Reads only (`prepare`, `replyHasGaps`).
- `send-outcome.ts`: pure map from error to outcome (`sendOutcomeOf`). Test: `actions-send.test.ts` "(12) sendOutcomeOf maps every error".
- `repo/claims.ts:196` `claimActions`: one CTE. A `SELECT … FOR UPDATE SKIP LOCKED … LIMIT` picks rows, and `UPDATE actions SET locked_at, updated_at … RETURNING` takes them. It does not change `status`. It writes `locked_at = now`, which is the token for the three writers above. Eligible: `ready`, `approved`, `applying` (`claimableWhere`, lines 100-137). The rows it returns are the exactly-once claim. Tests: `actions-repo.test.ts` "orders by received_at, email id and type rank; locked_at = now; a second claim returns nothing", "SKIP LOCKED: the second connection gets the other rows", "14: two connections: a send claimed in an open transaction is skipped by the other".
- `committer.ts`: no direct status write on a send. `claimActions` at line 380, `releaseActions` at line 175 (`repo/lifecycle.ts:136`: status unchanged, clears the lock, returns a count). Its only status writer is `expireStale` (line 160), in one transaction (`expireStaleReady`). That writer handles mailbox types only. Tests: `actions-committer.test.ts` "when applyAction throws, the throwing row stays locked and the untried rows are released", "a stale locked action is taken back and applied", "(21) a soft error on an earlier row releases a later send as approved", "a ready move older than 24 h expires with an audit row; an old summary is applied".
- `repo/sends.ts` also has `insertSendAgain` (line 351, insert with `approved`, uses `.returning("id")`, `approvals.ts`). The other functions there are reads.

**How the tests check `WRITER_GUARDS` (observed)**

- Test A: `transitions.test.ts` "(f) the edges that the guards admit equal the edges plus the latent edges, per writer and type". It builds the key `writer type: from -> to` from `WRITER_GUARDS` and from `ACTION_EDGES + LATENT_EDGES`, and requires both set differences to be empty. This is a static comparison; it runs no SQL. Other static checks: (a) all statuses known, (b) no edge or guard leaves a terminal status, (g) no send guard goes to `ready`, (h) all types known, and "no latent edge repeats an edge that callers use".
- Test B: `test/integration/actions-transitions.test.ts` `checkWriter` (around lines 135-240). For each guard row it inserts one row per (type × status) and calls the real writer in a rolled-back transaction. It expects `changed` to equal "admitted by the guard", the new status to equal `next` or the old status, and a not-admitted row to keep its lock. Lock passes: a wrong token changes nothing; a fresh and a stale lock for `free` variants (`held:"blocks"`). Writers covered: `markApplying`, `finishAction` (3 variants × applied/failed/expired), `releaseAction` (3 `toStatus`), `setExpired`, `setApproved`, `setRejected`, `expireReadyDraft`, `expireStaleReady`, `expireReadyOriginals`, `markUndone`, and the entry writers `createPlanned`, `insertReverse`, `insertSendAgain`, `insertEditedPair`. The skipped combinations must all be `send x ready` (CHECK-forbidden).
- Test C: same file, `describe("transitions map: schema")`: "the status list equals the status CHECK, the type list equals the type CHECK" (reads `pg_constraint`), and "an unknown status fails the CHECK".
- No repo code reads `WRITER_GUARDS`. It appears in three files only: `transitions.ts`, `transitions.test.ts`, and `actions-transitions.test.ts`. The writers keep their own SQL guards.

Checks: `actions-send.test.ts`, `actions-send-limit.test.ts`, `actions-repo.test.ts`, `actions-committer.test.ts`, `actions-transitions.test.ts` (integration) cover the writer behaviors above against Postgres; `transitions.test.ts` covers the static map. Both miss a check that a writer's SQL guard reads from the map at runtime, and no listed test checks that `releaseAction`'s discarded result on `send.ts` and `send-failure.ts` is safe.
## Note check

- Packet lists every send-path writer with guard, transaction, result use and tests: not proven. I read the code and the test names, but I ran no command that proves it. No test ran, because the worktree has no `node_modules` (`Cannot find module '@ea/core'`). The packet already says test names come from `grep` only.
- Packet explains how tests A, B and C check `WRITER_GUARDS`: not proven. I read `transitions.test.ts` and `actions-transitions.test.ts`, but did not run them. The A/B/C labels are my reading of file comments, and the packet states that.
- Packet follows the scout format and the worktree stays clean: proven. `test -z "$(git status --short)" && echo clean` printed `clean` and exited 0. The earlier `git status --short | wc -l` used a pipe, so it does not count as proof.

Easy-to-miss rule ("Read, search, and run existing checks. Do not edit, create, or delete files."): followed. The worktree is clean per the command above. I wrote the job note at `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-19-f068-scout-3-33990558/note.md`, outside the worktree, because the Limen instruction required it.

Not proven yet: the writer-table check and the A/B/C check. Neither can be proven without installing dependencies, which the read-only rule forbids.

