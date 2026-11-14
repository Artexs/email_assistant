# Measurement

> Checked against the code at `e063d6b`, 2026-11-14.

## What it does now

`weekStats` computes the numbers of one week of one organization: missed important mail (M1), open loops on time (M2), serious mistakes (M3), handled share (M4), urgent notice time (M5), cost per mailbox (M7) and the evidence of each category (M8). It can take one mailbox or all mailboxes of the organization. `recentWeekStats` gives the last finished weeks, newest first, and only the newest week carries M8. The route `GET /api/stats` (flag `stats_page`) and the operator CLI `bun run stats:week` call these functions. With the flag `weekly_report` on, the notice job sends the numbers of the last finished week to every linked member on Monday (rule 12). The panel page `/stats` reads the route and shows the last 8 finished weeks as one read-only table: the metrics are the rows, the weeks are the columns, each rate has its count, and a mailbox select picks one mailbox or all. An evidence row shows its precision only from 30 labels (`EVIDENCE_MIN_LABELS`); below that it shows the label count. `apps/web/src/lib/stats-view.ts` builds the cells. Every metric reads real mail only, and a call recomputes from the database and writes nothing. The pure metric code is in `packages/core/src/metrics`; each module that owns a table has the row reader for its tables.

## Rules

1. **The week.** A week starts on Monday 00:00 and ends on the next Monday 00:00 in the organization time zone (`weekRange`), so a week with a clock change has 167 or 169 hours. `recentWeekStats` starts with the last finished week (`lastFinishedWeek`) and goes back one week at a time. The current week is not in the list.
2. **Real mail only.** Every metric except M7 reads real mail: not a synthetic Message-ID and not a sender of the test-mail rule (`mailKindFilter("real", testMail)`). M5 also leaves out backfilled mail. M7 counts every `llm.call` row, also of test mail, because a test call costs money.
3. **M1, missed important mail.** The truth of a mail is the `true_category` of its latest feedback row, else its latest triage category when the feedback has no "wrong" verdict. Important means `urgent` or `needs_reply`. A miss is a truth `urgent` without an `urgent` category, or a truth `needs_reply` in `info`, `notification` or `spam`. The result splits the misses by source (`correction`, `review`, `moved_back`, `answered_check`) and holds the random sample (labels with source `review`) with the Wilson 95 % upper bound of its miss rate. The number is a lower bound.
4. **M2, open loops on time.** A sent delegation that is not `cancelled` counts in the week of its due time (`due_at`, else `sent_at` plus 3 days). `closedOnTime` means answered, or done, by the due time plus one working day. `surfacedOnTime` means closed on time, or raised as overdue by the chaser by then. A deadline that is still in the future counts as `pending` and stays out of both rates.
5. **M3, serious mistakes.** Four events count, each in the week of its own time: an original automatic move (not a reverse move, status `applied` or `undone`) that took the mail out of the inbox when the truth is `urgent`, `needs_reply` or `delegation`, or when VIP mail or a whitelisted sender went to `ai_spam` (one event per mail); a send rejected as `wrong_person`; a send rejected as `wrong_content`; and a sent mail marked as a mistake (in the week of the send). A reject with the reason `not_needed` and a reject without a reason show as `notNeeded` and `noReason` and are not counted. The labels come from `action_feedback` rows (flag `mistake_capture`, default off; `drafts-and-send.md` rule 11): the reason buttons after a reject (`rw:<p|c|n>:<action id>`, wrong person, wrong content, not needed), the mistake mark on the send result (`mk:<action id>`, within 7 days of the send), and their two web twins, owner only: `POST /api/actions/:id/reject-reason` (body `{ reason }`) and `POST /api/actions/:id/mistake` (`apps/server/src/modules/actions/routes.ts`). A reject that nobody tagged has no row and counts as `noReason`.
6. **M4, handled share.** The base is real mail of the week with a triage result. Handled is a `spam`, `notification` or `info` mail with an applied original `move`, `mark_read` or `flag`, none undone and no "wrong" feedback within 7 days of the triage, or a `delegation` mail with an applied delegation send whose delegation is not cancelled. `wouldHandle` is the same for status `logged`. A summary never counts.
7. **M5, urgent notice time.** For each real, non-backfilled `urgent` mail the notice time is the earliest `sent_at` of its `urgent` outbox rows. Mail that arrived in quiet hours is counted as `quietHours` and left out. The result holds `urgent`, `noticed`, `withoutNotice` and the 90th percentile in minutes (nearest rank). The reader of `channels` is a dependency of the service (`UrgentNoticeReader`), because `reports` may not import `channels`.
8. **M7, cost.** `perMailboxMonthUsd` is the LLM cost of the week times 30/7 divided by the active mailboxes (at least 1), plus the hosting share and the backup share of `packages/core/src/metrics/cost-model.ts`. A call of a model without a price counts in `unpricedCalls`. The target is $5 per mailbox per month.
9. **M8, evidence.** For each mailbox in scope and each bar category: `auto` from the category policy, and `kept`, `precision`, `recall` and `decision` of the real-label gate report (`realGoNoGoRows`), with the Wilson 95 % lower bound of the precision. It is the evidence at the time of the call, not of the week. The CLI prints the precision only from 30 labels.
10. **The route.** `GET /api/stats?weeks=<1–12, default 8>&mailboxId=<uuid>` answers any member. With the flag `stats_page` off, a foreign mailbox or an unknown mailbox it answers `404 not_found`; a bad query answers `400`. The answer is `{ weeks }`.
11. **The CLI.** `bun run stats:week --org-id <uuid> [--mailbox-id <uuid>] [--week YYYY-MM-DD]` prints one week (a Monday; default the last finished week) as one `key value …` line per metric. It ignores the flag, writes nothing and prints no address, subject or mail id. A bad argument, an unknown organization or a foreign mailbox prints the usage line and exits 1.
12. **The Monday message.** Flag `weekly_report` (default off) and the detector `weeklyReportDetector` (`channels/notices/weekly-report.ts`). On a Monday in the organization time zone, each linked member gets one `weekly_report` notice (dedup `weekly_report:<week start>`, the last finished week, all mailboxes, no buttons) from their slot: the first digest time from 07:00, else 08:00. The slot is per member; the week is one `weekStats` snapshot per organization and run, so all members of an organization get the same numbers (one message per member, not per mailbox). A member who links later on that Monday gets the message at the next tick; a Monday that passes with no row skips the week. The message holds M1–M3 first, then the other lines, and the count of replied mails that wait for an answered check (last 14 days). A run that fails is not tried again for 15 minutes (per organization and week), so a failing run does not read the week every 15 s. With the flag off, nothing is queued.
13. **Counts with rates.** A rate in the CLI output has its count next to it (`1 of 5`). A denominator of 0 prints `-`. M1 says "lower bound".

## Entry points

| Kind     | Name                                                                                                                                                      | Where                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| function | `weekStats`, `recentWeekStats`                                                                                                                            | `apps/server/src/modules/reports/metrics.ts`         |
| route    | `GET /api/stats`                                                                                                                                          | `apps/server/src/modules/reports/routes.ts`          |
| page     | `/stats` (the weekly numbers, read-only)                                                                                                                  | `apps/web/src/islands/StatsPage.tsx`                 |
| CLI      | `bun run stats:week`                                                                                                                                      | `apps/server/src/scripts/stats-week.ts`              |
| CLI      | `bun run mailbox:signals`                                                                                                                                 | `apps/server/src/scripts/mailbox-signals.ts`         |
| function | the pure metrics (`missedImportant`, `openLoopsOnTime`, `seriousMistakes`, `handledShare`, `urgentLatency`, `unitCost`, `autoEvidence`, `buildWeekStats`) | `packages/core/src/metrics/index.ts`                 |
| function | `realGoNoGoRows`                                                                                                                                          | `apps/server/src/modules/triage/gate.ts`             |
| function | `listTruthRows`, `listHandledRows`                                                                                                                        | `apps/server/src/modules/triage/metrics-repo.ts`     |
| function | `listHiddenMoveRows`, `listRejectRows`, `listMistakeRows`                                                                                                 | `apps/server/src/modules/actions/repo/metrics.ts`    |
| function | `listDelegationDueRows`                                                                                                                                   | `apps/server/src/modules/delegation/metrics-repo.ts` |
| function | `listLlmCallRows`                                                                                                                                         | `apps/server/src/modules/audit/metrics-repo.ts`      |
| function | `listUrgentNoticeTimes`                                                                                                                                   | `apps/server/src/modules/channels/metrics-repo.ts`   |

## Data

The service reads `emails`, `triage_results`, `triage_feedback`, `actions`, `action_feedback`, `delegations`, `audit_log` (`llm.call`, `delegation.done`, `delegation.overdue` and `action.rejected` rows), `outbox`, `mailbox_settings`, `sender_rules` and `mailboxes`. It writes nothing. It does not read `email_flags` or `email_headers` yet. Every reader filters `org_id` on each table it touches.

Tables that other capabilities write for the measures:

- `action_feedback` (written by the reason buttons, the mistake mark and the two routes of rule 5; `drafts-and-send.md`) is the source of M3 (b), (c) and (d).
- `email_flags` is written by the flag refresh of sync (`sync.md` rule 6): one row per checked mail with `seen`, `answered`, `flagged`, the first time of each flag and `checked_at`. `touchEmailFlags` writes a "last tried" row for mail that the server did not return: all flags false and no first-seen time, so `checked_at` means the last try and such a row is not a read flag. The `answered_check` columns are not written by sync. No metric reads this table at this commit.
- `email_headers` is written by header capture (`sync.md` rule 18). No metric reads it yet.
  The week stats hold counts and numbers only.

## Limits

- The Monday message goes to Telegram only; a mail channel is E4-B.
- The holdout result, the history check and the tripwire are not in M8: F110. E5 loop rows are not in M2: F116. The E6 draft outcome line is not in the report: F115.
- The M1 answered-check signal is not computed from `email_flags` yet: the metric reads `triage_feedback` rows of source `answered_check` only.
- The backup share of M7 is an assumption (`F100-e3a-measure`, question Q6).
- The stats are not cached: each call runs the readers again. The route asks for up to 12 weeks.

## Decisions

- PD-056 to PD-069 (E3: the metrics, the weekly report and the header and flag capture), PD-127 (M2 numbers), ADR 0028 (autonomy evidence without user labels).

## Tests

- `apps/server/test/integration/reports-metrics.test.ts`, `apps/server/test/integration/web-stats.test.ts`, `apps/server/test/integration/stats-week-cli.test.ts`, `apps/server/test/integration/web-tenant-scope.test.ts`.
- `apps/server/test/integration/channels-weekly-report.test.ts` (the Monday message).
- `apps/server/test/integration/metrics-readers.test.ts`, `apps/server/test/integration/metrics-readers-2.test.ts`.
- `packages/core/src/metrics/m1.test.ts`, `packages/core/src/metrics/m2.test.ts`, `packages/core/src/metrics/m3.test.ts`, `packages/core/src/metrics/m4.test.ts`, `packages/core/src/metrics/m5.test.ts`, `packages/core/src/metrics/m7.test.ts`, `packages/core/src/metrics/m8.test.ts`, `packages/core/src/metrics/week.test.ts`, `packages/core/src/metrics/week-stats.test.ts`.
