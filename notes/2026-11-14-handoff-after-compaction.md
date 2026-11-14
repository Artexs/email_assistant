# Coordinator handoff (written 2026-11-14 before the owner compacts the chat)

Standing owner orders: builders no cap; planners max 3; VPS, ssh and deploy are pre-approved (backup first, name the rollback, verify after); checkpoints and owner steps are not a stop; only a missing API key stops me; use plan defaults; first reply line is the answer; plain English; end with an overview.
Order rule: plan a ticket only after the tickets it needs have landed (see spec/build.md Planning lines).

Steps after the owner says "start":
1. Set a wake rule at the quota reset (12:00 Warsaw) plus 2 min: `limen rule set noon-resume --until "2026-11-14 12:02" "..."`. Resume only after 12:00.
2. Resume the failed jobs (`limen continue <id> --engine pi --provider claude-bridge --model <m> --thinking high --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge "<msg>"`): F095 stage 08 build (2026-11-14-f095-s08-778b34cc), review of F095 stage 07 (2026-11-14-f095-review-s07-c3742646; or spawn a new review of branch limen/2026-11-14-f095-s07-cc53288f), planners F101 (2026-11-14-f101-plan-astro-7-f9a673cd; its review job failed; B1 of that review: stage 04 check 7 baseline), F103 (2026-11-14-f103-plan-e8a-logs-fd4a9f85). Hold F102 (2026-11-14-f102-plan-e4-a-db8911dd): finish after F098 and F101 are built, then a planner re-checks it against the new code.
3. Plan F092 (RLS) now with the review's default (yes, include).
4. Build in order: F095 stages 07 to 10 (stage 10 needs the owner U1 phone session), then F097, F098, F099, F100 builds (each after F095 closes; F100 stage-level waits on F097 stages 01, 03, 04).
5. Old unblocked tickets that need a plan: F029+F032+F064 (one ticket), F062, F068, F085.
6. 2026-11-15 01:10: rule f094-next-day: the next-day VPS check, then `limen ticket done F094`.
7. Land rules: `limen land <done job id> --yes [--keep-open]`; if the continue job has no commits, merge the parent branch by hand (`limen ticket check`, `git merge --no-ff`), then `limen ticket done FNNN`. Read the land output before closing a ticket. For history-merge branches, land only when master equals the branch base.
8. Notes with follow-ups: notes/2026-11-13-s2-foundation-followups.md. State summaries: notes/2026-11-14-overnight-summary.md, notes/2026-11-13-stage-2-foundation-state.md.

## Incident 2026-11-14 ~12:40 UTC: /tmp had no free inodes
`/tmp` (tmpfs, 1,048,576 inodes) was 100% full of inodes: `/tmp/node-compile-cache` held 823,000 files; old review folders (`f086-review`, `f090-review`, `f091-review`, `ea-s5-*`) held about 200,000. Jobs fail with ENOSPC when this happens (a review reported TLS/SMTP tests failing). I deleted those folders (4% used after). If it returns: `df -i /tmp`, then `rm -rf /tmp/node-compile-cache`. A follow-up idea: set `NODE_COMPILE_CACHE` to a folder outside /tmp or clear it in `scripts/limen-prepare.sh`.
## Landing rule (my own mistake, three times today)
Run `limen land` ALONE. Read its last lines. "Recorded preimage" or CONFLICT = not landed: resume the worker with "git merge master, keep both sides, re-run the proof"; do NOT drop its databases and do NOT spawn the next stage until it landed.

## F097 stage 04 review carry-over (landed 2026-11-14, review PASS)
- F098 stage 11 spawn text MUST say: move `review.helpLine` / `review.commandDescription` (packages/core/src/texts/review.ts, read by channels/texts.ts and BOT_COMMANDS) into `texts.bot.help` / `texts.bot.commands`; use the verb "Stuknij" for tap; keep one source only.
- Polish `empty` text in texts/review.ts: change to "Brak wiadomości do przeglądu: każda wiadomość z ostatnich 30 dni ma etykietę." ("etykieta" vs panel "ocena": F098 owner choice; pl only, hold is on).
- Test case 3 in apps/server/test/integration/channels-review.test.ts inserts no mail; add one mail plus a feedback row.
- Coordinator still has C2 (deploy) and C3 (flag on for pilot) for /review.

## F100 stage 10 review carry-over (landed, PASS)
- Single `org_id` filter drops are equivalent mutants (composite FKs + `tr.org_id`); the rule "each single drop must fail" does not apply to these readers. A pair drop (emails + tr) fails 5/4 tests.
- Fixture `seedWeek` (apps/server/test/integration/metrics-fixtures.ts): its `updateTable("mailbox_settings").set({mode:"assist"})` changes no row because `createOrgWithMailbox` inserts no mailbox_settings row. Stage 12 or 17 MUST insert the row (e.g. via config/repo.ts:22) if it reads mode.
- `WeekQuery.testMail.senders` must be lower case.

## F097 stage 11 (sim CLI) worker decisions, landed
- Week mail with direction "sent" is excluded from labelling; labels for dropped texts are ignored (not `label_unknown`); `brief` omits senderHistory (guess: the writer does not need it). Revisit at stage 12 (freeze and audit) or 14 if the owner audit needs them.

## F105 stage 02 review carry-over (landed, PASS)
- Two parallel `enable` calls give 200+200 (never 500) and one row; the second write replaces the first, so one answer holds a stale secret/backup codes (a wrong secret never becomes verified; enrolment failures do not count to the lock). Plan D22 and "Not verified" are wrong about this. Stage 11 (account card) MUST block a double submit of "Turn on" so the user never sees a QR code or backup codes that are not stored.
- TOTP replay of the same code in a new challenge gives 200 (plan D26 / owner question Q5 accept this).
- Sessions made before enrolment on other devices stay alive after TOTP is turned on: stage 03 (D9) ends them.

## F100 stage 14 landed (review PASS) — carry-overs
- F098 stage 11 (branch limen/2026-11-14-f098-s11-bot-texts-4569598d, re-review 2026-11-14-f098-re-review-s11-83cab473 running) now conflicts with master: (1) callbacks.ts reject case: take `taps.rejectedNow`, keep the `reasonButtons` extra; (2) callbacks.ts ~:320,325 still use NOT_FOUND_TEXT (compile error after F098 removes it): use the `texts.bot.taps` not-found entry; (3) channels-callbacks.test.ts new tests use APPROVAL_TEXTS.not_found / owner_only: replace with textTables.en.bot.taps.*; (4) comment at action-feedback-taps.ts:30 mentions APPROVAL_TEXTS; (5) feedbackTaps answers stay in texts.approvals (D31). Give this list to the F098 s11 merge worker.
- F100 stage 15: first move handleApprovalCallback (~230 lines) from channels/callbacks.ts to its own file (callbacks.ts is 418 lines) before adding lines.
- Polish style (pl only, F098 stage 12 or a later texts pass): feedbackTaps 'Zapisano jako błąd.' -> 'Oznaczono jako błąd.'; 'Ta wysyłka nie jest odrzucona.' -> 'Ta wysyłka nie została odrzucona.'
- web-suspended.test.ts:28 comment says "18 write routes", the list holds 20. Flag check runs before id/body validation (flag off + bad id = 404, not 400): E4-A must not expect 400. drafts-and-send.md rule 11 points to measurement.md rule M3 (stage 12 creates the page).

## F100 stage 06 landed (PASS + fixes)
- touchEmailFlags inserts an all-false row with checked_at = now for notFound/mismatch targets: "last tried", not "flags known". If stage 07/12/15 or the answered check count coverage (share of mail with known flags), they must not treat these rows as read: add a nullable `flags_read_at` column in the stage 16 migration and set it in writeEmailFlags only. Tell the stage 07, 12, 15 and 16 workers.
- Review gaps: none open. Mutation of touchEmailFlags call fails case 6, N3 and N1.

## F105 stage 04 landed (review PASS) — VPS rollout rule
- master now has operator-needs-TOTP (stage 04). The VPS OPERATOR_USER_IDS owner has NO TOTP. Do NOT deploy a master that has F105 stage 04 without the enrolment UI (stages 09-11) and all of stages 01-14 in ONE deploy (stage 15 runbook). After deploy: owner step U1 enrols TOTP in Settings -> Account; until then /operator redirects to /settings?two_factor=required and /api/operator/* gives 403. Escape hatches: operator CLIs over ssh (no requireOperator), /api/auth/two-factor/enable and /verify-totp (allow-list), rollback image ea-server:pre-f105 (never db:rollback).
- Any other VPS deploy from now on (e.g. F098 s12 Polish, F100, F097 /review) must NOT ship F105 stage 04 before stage 11: deploy from a commit before f105 s04 (git merge --ff-only <commit>) or wait until F105 stages 01-14 are done.
- Optional test to add later (stage 12 e2e): keep a test that web.ts reads user.twoFactorEnabled from the REAL Better Auth session (a plugin upgrade hiding the field fails closed today).

## F100 s07 review carry-over (landed)
- Fixed on master: mermaid node quoted; two CLI texts no longer say 5 minutes.
- Open, optional: web panel texts `mb_resumed_toast` and `connected_toast` (en.ts 107, 168, and pl) still say "within 5 minutes". Fix in F100 stage 18/19 or a later web ticket.
- Soft-pause line vanishes after 10 min while a doubled soft pause runs; other orgs see no pause line (plan D8, N17). Owner step O1 note after land: set MAIL_SYNC_EVERY_MIN only if 2 is wrong.

## F100 s16 review carry-over (landed)
- N6 open for the owner/F098 follow-up: Polish `Załatwiłbym` (digest and weekly wouldHandle) is a masculine first-person verb; the F098 glossary has no neutral form. Polish stays off until F098 s12. Decide the assistant's grammatical voice before Polish goes live (neutral: "Do załatwienia przez asystenta: …").
- Migration 20261114140001 applied on the shared dev DB.

## F029 s01 review carry-over (landed)
- Stage 04 docs: architecture.md 6.1 "Known mail" parenthetical sits in the system-moved sentence; the multi-copy rule also covers a first copy in its source folder (test 1.5). Say so in stage 04 docs.
- Accepted risks (D1, Q4): more locates = more exposure to Interia SEARCH limit (h) for tab-folder copies (false `relocated`); with 6+ copies and only the 6th gone, a new copy is stored silently.

## F097 s18 writers: thread order (holdout 049-057 landed)
- Thread order in holdout 049-057 was checked by hand only (no command detects a reversed thread). The blind checker and reconcile show a reversed thread only through disagreement. Stage 20 (freeze + owner audit of 50 cases) must include threaded cases. A mechanical check (thread[i] signature name vs slot thread[i].persona) would be a small ticket for the sim check.
- Slots whose persona language differs from slot.lang were written in slot.lang with the persona signature unchanged.

## F100 s18 re-review carry-over (landed, PASS)
For F100 stage 19 (docs) and later web work:
- measurement.md rule 9 and web-panel.md rule 9: say the page applies the 30-label rule and names the stats_mailbox_gone state. "Checked against" lines in both pages name d91e47f, a master commit that does not hold the stats page: set them to the commit that holds the page (after this land).
- Page text gap: below 30 labels the page drops the auto mark ("29 of 30 rated mails needed" has no "· auto"). Add `stats_evidence_few_auto` (en, pl) so a category on auto shows it.
- kept 0 shows "–", not "0 of 30 needed": acceptable; decide later.
- Cleanup idea: extract a pure `statsView({mailboxId,data,error,loading})` from StatsPage.tsx and unit test the state cases (the page has no component test).
