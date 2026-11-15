# F114 stage 02 review (Sonnet 5.5, PASS cc0231c2)

Model: Sonnet 5.5, because the stage is read-only checks with no migration or send path. The tenancy part (cross-org readers) was judged with care: ids, times, counts and the zone name only; all joins carry `org_id`; suspended organizations are skipped; no log import in `slo-checks.ts`. No BLOCKING.

Test gaps (not blocking; carried to stage 03):
- TG1: `lateMin` has no autumn-DST test in the repo (the reviewer's probe: 120 for New York autumn; correct). Add one test.
- TG2: no test of `MIN(linked_at)` over two members or `MIN(sent_at)` over two notices (the earliest member notice).

Notes for stage 03 (texts, job):
- N-a: an urgent mail whose notice fails (`blocked`, `no_chat`, `bad_view`) keeps `noticeAt` null and counts as late for the 24 h lookback; one user who blocked the bot can hold `slo_urgent_latency` open. The alert text must say so.
- N-b: `startAt` starts at `received_at`, not `triaged_at`; a slow or late re-triage counts as a late notice. Follows plan D; state it in the text or docs.
- N-c: the detector caps at `URGENT_LIMIT = 200` mails per tick per org; mail beyond the cap counts as late. Extreme edge; document.
- N-d: `code-patterns.md` names the `ops.slo` job before it exists: stage 03 makes it true.
- N-e: `lateMin` uses `Intl` with `organizations.timezone`; a bad zone would throw and fail the whole urgent reading. Stage 03: catch per organization (skip that org and log a warning), or confirm the column is validated.
- Stage 03 must run the job in `withoutTenantScope` (RLS admits an unset org id, as for the other job readers).
- The surviving mutation `cand_notice_sent` is equivalent (DB CHECK `outbox_check3`).
- The owner rule "only counts and ages go out": ids stay in memory; plan D5 decides whether the alert text shows them.
