# F100 plan review 2 (cold review of refresh 1)

Job `2026-11-14-f100-plan-review-refresh-1-36cdb752` (Opus 5.5 high, review role), candidate `a7e99f3`. Final message, filed whole (from `limen jobs`; Limen status line: DONE WITH OPEN CHECKS, the two open checks are Limen's backtick heuristic, the message proves both in § Note check):

PASS a7e99f342315dc558d0b0932473a15cf56c88396

I found no blocking findings. Refresh 1 matches the code at a6690e4/HEAD for all six named checks. Four notes (N1–N4) are proven plan defects. Each one makes a Sonnet worker guess or leaves a doc wrong, so fix them before the stages they touch build. None of them breaks a ticket acceptance bullet.

HEAD matches the candidate (`git rev-parse HEAD` = a7e99f3). HEAD changes only files in `spec/features/planned/F100-e3a-measure/` (`git show --stat HEAD`, 18 files).

## Unverified
- N9 (stage 04 measure-schema case 1, PK before FK) is reasoned from Postgres semantics only. No job DB was available: `DATABASE_URL` is not set, and the local socket refused the role. I did not run `bun install` or any bun test, because this is a plan review and no JS check discriminates here.

## Named checks
1. **Stage 04 RLS vs `20261114100002_rls_tenant_policies.sql` and `rls-policy.test.ts`: holds.** The three blocks (stage-04:78-92) match the migration text (e.g. migration :10-13). They give the stored text `POLICY_TEXT` (rls-policy.test.ts:47). Case 1 (:128-146) needs the tables in `TENANT_TABLES` (:24-43). Cases 2–4 (:148-193) read `ALL_POLICY_TABLES`, which comes from `TENANT_TABLES`. `relname` uses the C collation, so the alphabetical order in stage-04:127 agrees with the JS `.sort()` at :192. Cases 6–7 (:229-254) need one row per org from `seedOrg` (:59-85). `fillMailbox` returns `MailboxIds { emailIds, actionIds }` (mailbox-rows.ts:13-17, :87), so the seedOrg step in stage-04:127 can be done. The no-GRANT claim (stage-04:111) holds: `20261103000001_app_grants.sql:2`. `emails_id_org_key` is at `20261104000001_triage.sql:2`. `actions (id, org_id)` is referenced at the same file :94.
2. **Stage 16 CHECK lists vs `20261114100003_outbox_send_held.sql`: holds.** Up (stage-16:96-98) = migration :3-5 plus `weekly_report`. Down (stage-16:103-105) = migration :3-5 exactly. `outbox_send_held_mailbox_check` (:7) stays untouched (stage-16:108). `noticeKinds` (kinds.ts:6-19) has the same 12. `detectors` and `queuedBy` match F15 (channels/notices/index.ts:26-42).
3. **Stage 18 vs F099 stage 06: holds.** `meSchema.features` is at packages/core/src/web/me.ts:57. `tenancy/routes.ts:77` fills it. web-me.test.ts:125-143 proves it. Stage 18 step 1 (stage-18:11-23) changes no server file. It matches F099 stage-10-operator-page.md:13-14 (`OPERATOR_ITEM`, `me.operator`). `TAB_ITEMS`, `grid-cols-4` and `useMe` are where the stage says (nav-items.ts:15-20, Nav.tsx:23, AppShell.tsx:37). `Placeholder` takes no props (Placeholder.tsx:4).
4. **Capability-page steps vs `docs/capabilities/` and `capability-map.test.ts`: hold in part.** See N1, N4 and N5. The rules cited by number exist: retention.md:12 and :33, the Data paragraph :51, digest-and-notices.md:14 and :49, web-panel.md:22, and sync.md lines 7, 24, 36, 43, 78.
5. **D31 vs F098 D9, D10, D18: conflicts.** See N2 and N3.
6. **Flag-list rule (plan.md:159) vs the three tests: holds.** tenancy-features.test.ts:168-173 (case 8 `toEqual`). web-operator.test.ts:47 (`flagOn` union), :106 (title "four keys"), :111-117 (rows and `[false, false, false, false]`). org-flag-cli.test.ts:68-71 (case 1 `toContain`). No other test lists every flag (grep `approvals_page`). One gap: see N7.

## Notes

**N1 (proven) — Stages 14 and 15 edit `measurement.md`, which can be absent.**
- `measurement.md` is created only by stage 12 step 3 (stage-12:93-105).
- plan.md:234 orders "14 after 13", and 13 needs only 04 and 09. Stage 15 needs only 06, 10 and F097 s04. Neither waits for 12.
- stage-14:11 and stage-15:61 still say "update `docs/capabilities/measurement.md` (rule M3/M1)".
- If 14 or 15 builds before 12, the worker must guess: create the page and its README row (capability-map.test.ts:145-148 fails without the row), or skip the step.
- Fix: make 14 and 15 wait for 12, or say "skip when absent; stage 12 writes it".

**N2 (proven) — The D31 trigger conflicts with the per-section rule.**
- D31 (plan.md:70) and Q15 trigger on "`packages/core/src/texts/index.ts` exists". F098 creates that file in stage 06 (F098 stage-06-core-texts-registry.md:13,18-27).
- The sections D31 sends texts to arrive later: notices in s08, approvals s09, digest s10, bot s11. See F098 stage-06:25 "stages 08–11 add common, notices, approvals, digest, bot".
- plan.md:236 (How to run 3) and stage-16:85 ("after F098 stage 08 landed") use the per-section stage instead.
- Between F098 s06 and s11, stages 07 (stage-07:34), 13 (stage-13:45) and 15 (stage-15:40) are told to write into a section that does not exist. The worker must guess: create F098's section early (a clash with F098 s08–s11), or stay inline.
- F097 D39 splits the same trigger by s06 and by `texts/bot.ts` (F097 plan.md:82). Apply the same split to D31.
- No user-visible harm while the D10 hold returns `textTables.en`.

**N3 (proven) — Wrong F098 helper facts.**
- D31 (plan.md:70) says `formatClock` takes `texts: CoreTexts`. F098 D6 and stage-06:71 give `formatClock(at, tz, now, locale)` and `formatDay(at, tz, locale)`, which take a `UserLocale`.
- stage-15:40 says `cleanSubject` and `senderLabel` take `texts` "after F098 stage 06". They change in F098 stage 08 (stage-08-notice-texts.md:48-49). Only `categoryTag` changes in s06 (stage-06:114).
- Typecheck will correct the worker. The facts still have no correct source.

**N4 (proven) — A stale doc line is missed.**
- `docs/architecture.md:321` reads "Every 5 minutes: fetch UIDs above the cursor".
- Stage 07 names only §4.1 (stage-07:11, i.e. architecture.md:95).
- Stage 19's check `grep -rn "every 5 min"` (stage-19:26) is case-sensitive, so it does not match "Every".
- After F100 the doc is wrong. Add that line to stage 07, or use `grep -rni` in stage 19.

**N5 (proven) — Rule wording claims a check the test does not do.**
- plan.md:158 says "Name only paths, functions and `bun run` scripts … capability-map.test.ts checks them".
- The test checks paths, scripts and ADR numbers only (capability-map.test.ts:157-172). Function names are not checked.
- Done-when 9 (plan.md:124) cites this test as its proof that "each stage … updated its page". It cannot show that. Only the stage reviews can.

**N6 (proven) — Polish texts with no review job.**
- D31 says "the stage review reads" the Polish text, and F098 P9 requires a review of every stage that adds Polish texts.
- Stage 07 (pause line, resume text) and stage 18 (`nav_stats`, `stats_*`, `title_stats` in `pl.ts`) are not in the review list (plan.md:198-199).
- Add both to § Review, or add a text check to stage 19.

**N7 (proven, minor) — The flag rule misses a Limits line.**
- The flag rule names only `tenancy-and-plans.md` rule 5.
- The Limits line `docs/capabilities/tenancy-and-plans.md:93` ("The registry has three flags") is outside it. It is already stale at HEAD (there are 4 flags).
- Rule 5's sub-bullet :31 ("`isFeatureOn` has no caller") is also stale since F099 (`tenancy/routes.ts:92`).
- Stage 19 lists the page but not these lines.

**N8 (plausible) — Kill switch and route behaviour differ.**
- Telegram taps do not check `mistake_capture` (stage-14:16 "The flag is not checked on the tap").
- The web routes return 404 with the flag off (stage-14:19).
- After `FEATURES_OFF=mistake_capture`, buttons already queued (`mistakeButton: true`) still write rows. The kill path in ADR 0027 then does not stop Telegram writes.
- No rule covers the kill case.

**N9 (plausible, not reproduced) — Stage 04 measure-schema case 1 expects the wrong error.**
- Case 1 (stage-04:135) inserts a row for org A, then "the same mail id with org B's `org_id` → foreign-key error".
- `email_id` is the PK (stage-04:21). Postgres checks a unique index when it inserts the row, and an FK check runs later, as an AFTER trigger. So the second insert raises 23505, not 23503.
- The worker must reorder the inserts or use another mail.

**N10 (plausible) — Stages 07 and 14 are large for one job.**
- Stage 07 has three steps: a config key and cron, the resume text, a flag with the three list tests, an audit reader, a core line, digest and `/status` wiring, two pages, deploy README and known-alerts.
- Stage 14 has two tap handlers, the send-result flag read, a router with 7 result mappings, a core schema, a mount, 5 test groups in 4 files, and 4 pages.
- Both are likely above the ~200–220 lines in the stage table (plan.md stage rows 07 and 14).

**N11 (plausible) — Same-ticket flag stages are not ordered.**
- Stage 07 may run next to stage 13 or 16 (plan.md:234-235). All three append to `features.ts` and the three flag-list tests "last at its base".
- plan.md:236 forbids only another ticket's flag stage. The later job's merge resolves it, but the rule does not say so for F100's own stages.

**N12 (proven) — Board drift.**
- `spec/build.md:38` still says F100 "needs refresh" after refresh 1. That is for the coordinator to update.
- Note on the pre-mortem: if a bug reaches the user, the stage most likely to let it through is 07 or 18 (N6). Their user-visible Polish texts land on the worker's proof alone.

## Checks run
- `git rev-parse HEAD && test -z "$(git status --short)" && bash scripts/plan-drift.sh spec/features/planned/F100-e3a-measure a6690e4` → printed a7e99f3, the tree is clean, and "named paths: 144; changed since base: 0; gone: 0 / no drift". All three passed (one bash call joined with &&).
- `git show --stat HEAD` → only F100 folder files.
- Read and grep checks of the files cited above. No bun test ran (see Unverified).

## Note check
- HEAD is a7e99f3: proven. `git rev-parse HEAD && test -z "$(git status --short)" && bash scripts/plan-drift.sh spec/features/planned/F100-e3a-measure a6690e4` printed a7e99f342315dc558d0b0932473a15cf56c88396.
- Each of the six named checks has a finding or a "holds" with file:line: proven. This message, § "Named checks" items 1–6, each with file:line.
- Pre-mortem answered (gaps, rule conflicts, guess steps, unsourced facts, too-big stages): proven. This message, notes N1–N12. Gaps: N1, N4, N7, N8. Conflicts: N2, N6, N8. Guess steps: N1, N2, N9. Unsourced or wrong facts: N3, N5. Too-big stages: N10. Pre-mortem answer: N12, last bullet.
- Easy-to-miss rule "Read only; change no file": followed. The `test -z "$(git status --short)"` step in the same && call passed, so the worktree is clean at the end. Only the job note outside the worktree was written, as the Limen job requires.
