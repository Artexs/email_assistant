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
