# F115 stage 16: sample drafts and the reply draft outcome counts (2026-11-19)

Stage file: `spec/features/active/F115-e6a-reply-drafts/stages/stage-16-samples-outcomes.md`. Behaviour: `docs/capabilities/drafts-and-send.md` bullet "Sample drafts (F115 stage 16)", `docs/capabilities/measurement.md` rule 14, `docs/capabilities/digest-and-notices.md` item 3e.

## Where the code is

- Samples: `apps/server/src/modules/replies/samples.ts` (`sampleReplies`, `listSamples`), `repo/samples.ts` (day count, lock, run list), `repo/scan.ts` (`listSampleCandidates`), routes in `routes.ts`, docs in `api-docs.ts`, schemas in `packages/core/src/web/replies.ts` (`replySamples*`), wiring `ReplySampleScope` in `main.ts` and `web.ts`. The job step of a `sample` request is stage 07 (`draft-one.ts`); stage 16 added no job code.
- Style card: `apps/web/src/components/settings/ReplySamples.tsx`, `lib/reply-samples.ts`, texts `rs_samples*` (`i18n/texts/*-reply.ts`; fixed Polish table `i18n/reply-style.test.ts`).
- Outcomes: `packages/core/src/metrics/reply-drafts.ts` (pure function), `weekStatsSchema.replyDrafts`, `metrics/week-stats.ts`; readers `listReplyPairRows` (module `actions`, `repo/metrics.ts`) and `replyOutcomeRows` (module `replies`, `repo/outcomes.ts`); join in `reports/metrics.ts`; weekly line in `digest/weekly.ts` and `texts/notices.ts`; `stats:week` line in `scripts/stats-week-args.ts`.
- Tests: `web-reply-samples.test.ts`, `replies-outcomes.test.ts` (integration); `reply-drafts.test.ts`, `weekly.test.ts`, `stats.test.ts`, `week-stats.test.ts`; web `reply-samples.test.ts`, `reply-style-card.test.tsx`; e2e `reply-style.spec.ts` T9 and T10.
- Logs of the stage (untracked): `.f115s16-logs/` (`mutations.log`, `mutations-summary.log`, `mutate.py`, `e2e.sh`, chain logs).

## Decisions

1. **A GET route for the run.** The stage said "the panel polls the request ids". `GET /api/replies/requests/:id` reads taps and redrafts only (stage 14), and a sample text must reach the owner only. So `GET /api/mailboxes/:id/reply-samples` (owner only) gives the run of the quota day. It also lets a reload show the run again, since the run cannot be asked twice in a day.
2. **`count: 0` uses nothing.** When no mail qualifies, the answer is 202 `{ requestIds: [], count: 0 }`, no request is made and the day's run is not used up.
3. **The day is the quota day** (`quotaDayStart`, the day of `LLM_DAILY_CAP`), the same clock as the preview limit. A run is counted by its `sample` requests of any status (a failed run still uses the day).
4. **Scope.** `ReplySampleScope` carries the model scope of the drafter job: under `synthetic` only test mail is a candidate, so a real mail never gets a request that the job would cancel with `llm_scope`. With no model client the POST answers 409 `llm_off` (new code).
5. **Audit.** One `reply.requested` row per sample request (`trigger: "sample"`), ids and codes only. `listEndedRequestsVia` reads taps and redrafts only, so a sample never produces a chat notice.
6. **Outcome counts.** The reader takes a `WeekQuery` (range, mailbox, test-mail rule) like the other metric readers, not `{ since }` of the interface text (a week report needs a window). `draft_missing` counts as `draft_changed`. A waiting pair, `policy_changed` and `suspicious` closes are only in `made`. A pair is counted in the week of its first version; its end is the newest version at the time of the computation. `failed` counts failed sends and failed requests; `no_draft` counts requests.
7. **Stored views.** `replyDrafts` has a default (all 0), so a `weekly_report` row queued before the key still parses.
8. **`stats:week`** prints a `reply_drafts` line while any count is above 0.

## Terms

No legal text, registry or consent text changed: **no `TERMS_VERSION` bump.** `reply_drafts` stays OFF by default.

## Review fixes (Opus review of 1a45ec37, 2026-11-19)

- **Flag before role.** Both sample routes run `flagFirst` before `requireOwner`: every role gets 404 while `reply_drafts` is off, also for a bad id (`docs/code-patterns.md` § Add a user command, step 4). With the flag on, a member gets 403 before the id is read.
- **Inactive mailbox.** A mailbox with `status` other than `active` (paused, `auth_error`) answers 202 `{ requestIds: [], count: 0 }` and queues nothing: the drafter job and the timeout sweep run only for `listSyncTargets` (active mailboxes), so a request there stayed `pending` and used up the day. The panel shows `rs_samples_none` for it.
- **Panel states.** `SamplesState` has a `slow` state (button off, `role="status"`, no error colour); the refusal `sample_limit` loads the run of the day and shows it when it exists; `rs_samples_none` and `rs_samples_limit` are notes (`messageTone`), every other message is an alert. The state helpers are in `lib/reply-samples.ts` and unit tested; the three e2e-only mutants (`E1`..`E3` in `mutations-fix.log`) are killed by T10 to T12 (T12 uses `page.clock`).
- **Quota day.** `QUOTA_TIMEZONE` is `America/Los_Angeles`: the day turns at 09:00 Polish time (10:00 in summer). The texts say "today" and "later", never "tomorrow" or midnight. The old preview texts (`rs_preview_limit`, `rs_preview_cap`) still say "tomorrow"; they were out of scope here.
- **`listReplyPairRows` cost.** The anchor now reads reply sends created at or after the start of the week: a newest version is never older than the first one, so no pair of the week is lost (test 4 of `replies-outcomes.test.ts`, mutant `N06`). The `NOT EXISTS` on `supersedes_action_id` uses the unique index `actions_supersedes_key`. The anchor still reaches the sends of the organization through `actions_org_type_status_idx (org_id, type, status)`: the `created_at` bound filters rows, it is not an index range. An index `(org_id, type, created_at)` would need a migration, which this fix may not add; if the stats page (8 calls, 16 queries) is slow in the pilot, add that index in a later migration. The review's 183 ms plan came from stale statistics inside a rollback transaction and was not proven for production. The bound changes no result, so removing it survives all tests (`N06b`, an equivalent mutant: performance only).
- **Card test in CI.** `reply-style-card.test.tsx` moved from `components/settings/` to `lib/` (where the other component tests live), so `test:unit` runs it.
- **Polish and English texts** changed as the review gave them (list in the final message of the fix job).
