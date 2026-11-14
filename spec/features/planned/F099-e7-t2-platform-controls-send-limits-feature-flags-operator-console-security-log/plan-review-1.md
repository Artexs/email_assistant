# F099 plan review 1

Job `2026-11-14-f099-plan-review-2-752167e8` (Opus 5.5, high; candidate a7e7049). The first review job (`2026-11-14-f099-plan-review-32d4c2da`) stopped on the quota limit and wrote no findings. Below: the final message of the job, whole, from its job log (the result file held only a short summary).

PASS a7e70498a63820cb7e979e3101878501a0ae1007

The F099 plan has no blocking finding. The pre-mortem found no stage that would let any of the five named bugs through as the stages are written. I found 16 notes; the three that matter most are N1, N2 and N3.

**Blocking findings:** none.

**Unverified checks:**
- **P1, the page-guard probe** (plan.md:108). The probe was deleted, so I did not run it again. Stage 06 test 1 (stage-06:55) tests every path form, so a bad probe would fail in the build, not in production.
- **P2, the reference values for the limit rule** (plan.md:109). I did not run them. I worked out stage-01 cases 1–14 (stage-01:60–73) by hand against D3, and all of them are correct.
- **The F091 file names** (`actions/repo/{lifecycle,sends,reads,notify}.ts`, `apply-shared.ts`). F091 is in `active/` and these files do not exist at HEAD. The names match F091 plan.md:36 and :41. The stages tell the worker to follow the function if the file differs (plan.md:123).
- **No JavaScript check ran.** I did not install `node_modules`, because a plan review has no code check that would show a fault.

**Pre-mortem: which stage could let each bug through**
- **A mail sent over a limit:** no stage lets it through. `applyAction` is the only caller of `applySend` (committer.ts:274, apply.ts:404). Every payload has exactly one recipient (payloads.ts:10). The limit check, the lock and `markApplying` run in one transaction (stage-03:46–53). A second committer reads the first one's row after the lock, because each statement takes a new snapshot. Stage-03 case 6 (stage-03:96) proves the lock. Only a small overshoot is possible (N4).
- **A send held forever:** cannot happen. `claimableWhere` skips a send approved more than 48 h ago (repo.ts:404–413), and the expiry job closes it as `held_timeout` (repo.ts:1566).
- **A send held with no visible reason, or the wrong one:** stage 04 can show the wrong reason (N1).
- **An operator answer that leaks a name, an address or another tenant:** stages 07 and 08 use strict schemas, and their tests parse the body and grep it for `@x.test` and for names (stage-07:98–99, stage-08:122). Notice keys hold only ids and sanitized codes (operator.ts:130,144,176,191; auth-mail.ts:56–60).
- **A non-operator reaches the console:** blocked. The API guard runs before the suspended-write allow entry (http.ts:361–362). The page guard covers every P1 path form. The only public part is the `/_astro/` JS chunk of the page, which holds no data (N13).
- **A security log that shows another organization:** blocked. `listAuditEvents` filters by `ctx` (stage-12:87), and stage-12 test 10 (stage-12:109) proves it. Names come only from members of the same organization.

**Notes**

N1. **The panel can show "waiting: send limit" for a send that waits for another reason.** Proven by reading the code.
- The committer handles only `active` mailboxes in organizations that are not suspended (mail/repo.ts:911).
- A send keeps `last_error = send_limit:*`, because `releaseAction` keeps `last_error` when no new one is passed (repo.ts:700).
- Stage 04 sets `waiting` when `next_attempt_at !== null`, not when it is later than now (stage-04:26).
- So a held send in a paused, `auth_error` or suspended mailbox reads "approved, waiting: send limit" until `held_timeout`. The same happens when `SEND_SCOPE` changes to `off` after the hold.
- Stage 05 has the same fault in Telegram: it queues `send_held` for a paused mailbox and promises a send time that the committer will not meet (stage-05:83).
- Fix: require `next_attempt_at > now` in `listActionsForEmails` (pass `now`), or skip mailboxes that are not active.

N2. **The operator notice for a limit hit can be lost.** Plausible.
- `notify` tries again only for `llm_cap` (operator.ts:91).
- The callback runs after the commit (D10, plan.md:59).
- If the process crashes between the commit and the callback, or the Telegram send fails, and no other hold comes that day, the operator gets nothing.
- This breaks the frame's "reaches the operator at least once" (operator.ts:50) and the PD-044 notice.
- Fix: add `send_limit` to the retry map, or let the hourly `run()` look for holds.

N3. **A pending `send_held` notice is never cancelled.** Plausible.
- A notice held back by the quiet hours can arrive after the sends went out. It then says "Sends … wait" when nothing waits.
- `sync_stale` cancels its pending rows when the problem ends (sync.ts:23,37,65). Stage 05 (stage-05:52–59) has no such cancel.

N4. **Every send in one batch gets the batch start time as `send_started_at`.** Plausible.
- The committer passes one `now` to the whole batch (committer.ts:250, D12 at plan.md:61).
- A send that really starts later in the batch counts from an earlier time, so it leaves the window early.
- Measured by the wall clock, the limit can be passed by the sends that started late in the previous batch. The excess is small and bounded by how long one batch takes.

N5. **Stage 05 test 4 conflicts with its own setup.** Proven by reading the stage.
- Case 3 sets `next_attempt_at` to +10 and +20 min after 10:00Z.
- Case 4 expects a second row at `2026-11-21T00:30:00Z` "with the sends still held" (stage-05:88).
- The detector needs `next_attempt_at > now` (stage-05:49), so the case 3 rows give no row at that time.
- The worker must guess that it has to move `next_attempt_at` forward. The stage should say this.

N6. **Stage 09 test 4 starts from the wrong state.** Proven by reading the stage.
- `afterEach` puts B back to `active` (stage-09:80).
- "Resumes B (`{ plan: "active" }`) → `resumedAt` = NOW" (stage-09:84) then returns `unchanged`, because B was never suspended (service.ts:203–207).
- The case must suspend B first. The same problem exists between the sub-steps of case 5 ("on an active B" after B became a trial).

N7. **The lock key differs between the plan and the stage.** Proven by reading both. D6 uses `'send_limit:' || <mailboxId>` (plan.md:55); stage 03 uses `send_limit:${ctx.orgId}:${mailboxId}` (stage-03:30). Both work; make D6 match the stage.

N8. **The `E12` row of `transitions.ts` needs a new caller.** Proven. Its callers list is `["apply.ts", "send.ts"]` (transitions.ts:234). Stage 03 adds only a reason (stage-03:84), but `releaseAction` will also be called from `send-limit.ts`, which should join the list.

N9. **A wrong fact in D17, and false failures in the console.** Proven.
- D17 says an outbox row "lives at most 24 h" (plan.md:74). In fact retention only empties the text of old rows; the rows stay (channels/repo.ts:559–575).
- `countFailedOutboxSince` (stage-07:24) counts every `failed` row. That includes normal cancellations with `error_code` `outdated` or `expired` (channels/repo.ts:459–468, 476–485, 586).
- So `failures24h.outbox` counts cancelled notices as failures. Exclude those codes, or name the count "cancelled or failed".

N10. **D30 understates the files that lanes A and B share.** Proven.
- D30 says the lanes share only export lines (plan.md:93).
- In fact both lanes edit `audit/repo.ts` (stages 03, 07, 08, 12), `actions/repo/sends.ts` and `actions/index.ts` (02, 03, 07, 08), and `composition.ts` (04, 09).
- If stage 08 and stage 12 run at the same time, both add `listAuditEvents` (stage-08:12, stage-12:3).
- The rule in `spec/build.md` (resume the worker to merge on a land conflict) covers this. The coordinator can avoid it by not running 08 and 12 at once.

N11. **Stage 04 promises more than urgent notices can show.** Proven.
- Step 4.1 says "wherever the system describes a send (panel activity, digest, notices)" (stage-04:8).
- The urgent notice copies only six fields (urgent.ts:59–67), and its view is strict (views.ts:18–25).
- A held send still reads "approved, sending" there, and adding the field would be a view change, which the notice rules forbid. Change the goal line to say so.

N12. **`/api/me.operator` and the API guard read the operator ids from two sources.** Plausible, tests only.
- `/api/me.operator` reads the config in `apiRouters` (stage-06:88). `requireOperator` reads `WebDeps.operatorUserIds` (web.ts:355, 370).
- They are the same set in production. A test can give them different values, so `/api/me` and the guard could disagree there. Passing one set would remove that risk.

N13. **The page JS is public.** Plausible. The page guard hides only the HTML. The island chunk is under `/_astro/`, which is a public path (http.ts:145). It holds no data; this is a fact for the docs only.

N14. **Rollback after a hold.** Unverified. If a `send_held` row is pending when the stage 15 rollback runs, the old code has no renderer for that kind (stage-15:52 says only that the old code accepts the wider CHECK). Stage 15 should say what happens to such a row, for example cancel pending `send_held` rows before the rollback.

N15. **The board does not match the ticket.** Proven. `spec/build.md:35` says "sequenced after F082; … needs plan". The ticket also adds F091 as build-after (ticket.md:38), and the plan is now written. The §2.1 row in `05-execution-plan.md:38` says "≈ 12" against 15 stages. The coordinator owns these files.

N16. **The plan's cold-review line is wrong.** Proven. plan.md:27 expects `plan-review-1.md`. The earlier review job (`…f099-plan-review-32d4c2da`) failed on a quota limit and wrote no findings. So this review is the first one with results.

**What I ran**
- `git rev-parse HEAD` printed `a7e70498a63820cb7e979e3101878501a0ae1007`, which matches the candidate. `git status --short` was empty at the end; I changed nothing in the worktree.
- I read the ticket, the plan, `questions.md` and all 15 stage files.
- I checked each cited interface against HEAD and found them as described:
  - `markApplying`, `releaseAction`, `finishAction`, `claimableWhere`, `listExpiredApprovals` (actions/repo.ts)
  - `applySend` and its steps (send.ts), the batch and wiring in `committer.ts`, `ApplyDeps` (apply.ts)
  - `lockMailboxLimit` (mail/repo.ts:171–173), `createOperatorNotices` (channels/operator.ts)
  - `createApp`, `requireOperator`, `SUSPENDED_WRITE_ALLOW`, `PUBLIC_PAGE_PATHS` (http.ts)
  - `setOrgPlan`, `setOrgFeature` and their results (tenancy/service.ts), `featureStates`, `isFeatureOn`, `configureFeatures`
  - `recordLlmCall`, `costPerMail` (gpt-6-luna 0.1/0.5 per 1M gives 0.06), `quotaDayStart`, `formatClock` (11:10 Warsaw is right)
  - `auditWebEvent` and the event codes, the outbox CHECK history and its cascade on mailbox delete, the log-field allow list
  - `webOrg`, `webTestApp`, `withRollback`, `insertDraftAndSend`, `useResource({ pollMs })`, `ApiError.code`, the shadcn components, and every test file and script named in the stage Check lines
- I worked out the test values by hand: stage-01 cases 1–14, stage-03 cases 1–3, stage-07 case 5 (`since` 08:00Z, cost 0.06), stage-09 case 5 (trial end 2026-12-04T10:00Z), stage-10 case 4, and stage-13 case 4. All are correct except stage-05 case 4 (N5) and the start state of stage-09 case 4 (N6).

VERDICT: PASS
