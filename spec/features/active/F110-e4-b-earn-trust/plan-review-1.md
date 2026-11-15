# F110 plan review 1

Job `2026-11-15-f110-plan-review-f99b3fdc`, `claude-opus-5-5`, thinking high. Final message filed whole below.

FAIL 14219372a11497ce8394333db9cbcb8713cf33ea

HEAD = 14219372a11497ce8394333db9cbcb8713cf33ea (the candidate), clean tree. Plan base in plan.md: 9341d9f0; only the 3 plan commits come after it, and no code changed.

Pre-mortem answer: the bug most likely reaches the user through stage 03. Its migration leaves out the outbox constraints, so every trust notice and every mail-channel row fails at insert. Stage 03 also adds the module edges that form a cycle. The second likely path is stage 07: the re-check after a model switch reuses the old model's triage results, so the new key gets "evidence" that the new key never produced.

## BLOCKING

B1. The stage 03 layer edges form a cycle, so the Proof of stage 03 cannot print PROOF_OK (acceptance bullet 6).
- stage-03-migration.md:27 puts `trust` in layer 4 and adds `trust → channels` and `reports → trust`. The edge `channels → reports` already exists (layers.json sameLayerEdges).
- Proven: I ran `findCycle` from `apps/server/src/scripts/module-graph-build.ts` on today's edges plus the two new edges. Result: `[ "channels", "reports", "trust", "channels" ]` (today's edges: null). `layers.test.ts:40` ("sameLayerEdges has no cycle") and the lint (eslint.config.js:37-38) fail on it.
- Stage 12 (stage-12-m8-evidence.md:8) depends on the same edge.
- Decision needed: put `trust` in layer 5, and inject the M8 trust reader into `reports` from the composition root (as stage 04 injects the gate into the routes). Or keep `reports` free of `trust` in another way.

B2. No stage adds `trust_report_ready` and `autonomy_paused` to `outbox_kind_check`. This breaks acceptance bullet 4 ("…queue one notice") and the report-ready notice (D16).
- At HEAD, `db/migrations/20261115130001_approval_edit.sql:28-31` allows only the listed kinds. Each earlier new kind had its own migration (for example `20261114140001_weekly_report_kind.sql`).
- interfaces.md:23-31 (§ Schema) and stage-03-migration.md:7 do not list it. Stage 10 has no migration and may not add one (plan.md:117).
- Proven by reading: the insert of stage 10 test 3 and stages 07/08/09 (tests 9, 2, 1) violates the check.
- Fix: put both kinds in the stage 03 migration and in § Schema.

B3. `outbox_channel_check` allows only `'telegram'`, so the stage 19 mail rows cannot be inserted. This breaks acceptance bullet 5 ("A mail-only member finds the digest in INBOX").
- `db/migrations/20261113100001_outbox_view.sql:6`: `CHECK (channel IN ('telegram'))`. No later migration changes it (grep of db/migrations).
- Stage 19 has no migration. interfaces.md § Schema does not name the change.
- Fix: stage 03 (or a planned migration slot for stage 19) widens the check to `('telegram','mail')`.

B4. `EvidenceKey` leaves out `host`, so a switch between two own servers does not re-gate. This breaks acceptance bullet 3 ("After a model or endpoint switch, no mail moves under the old grant") and conflicts with rule 16.
- docs/capabilities/triage.md:73: "A gate file proves one model and prompt on one endpoint and host. It holds `endpoint` and `host`."
- interfaces.md:7 and plan.md:25 (D2) match five fields without `host`.
- An `OPENAI_BASE_URL` change from own server A to own server B with the same model name keeps `sameKey` true, so `effectiveAutoFor` stays true and stage 08 does nothing.
- Fix: add `host` to the key (null for `standard`/Gemini, as the gate file default), and add a stage 02 test with two `own` files of different hosts.

B5. D8 cannot hold: the re-check after a model switch reuses triage results of the old model.
- plan.md:31 (D8) queues a history check because "the history result belongs to the old key".
- stage-07-history-classify.md:11 and D10 (plan.md:33) reuse "its newest row" of `triage_results` with no model or prompt filter. For an existing mailbox, most of the 30-day sample is old-model output, and the check stores it under the new `key`.
- `triage_results` has `model` and `prompt_version` (db/migrations/20261104000001_triage.sql:29-30), so a filter is possible.
- Decision needed: reuse a row only when its model, prompt version and endpoint equal the running key; else classify again.
- Same gap: when a check is already open at the switch, `queueHistoryCheck(..., "model_switch")` is a no-op (stage-03:13), and that open check finishes with mixed keys.

## TEST GAP

T1. Stage 03: a member has `report_mailbox_id = M`; `delete_mailbox(org, M)` succeeds, the membership stays, and `report_mailbox_id` becomes null. The composite FK pattern with plain `ON DELETE SET NULL` would also null `org_id` (NOT NULL), so it needs PG17 `SET NULL (report_mailbox_id)`. Stage 03 test 6 covers only checks, items and trips.

T2. Stage 08: a `ready` `move` of `notification` planned under key A before the restart; the process starts on key B with no B file. The row ends `expired` (reason `policy_changed`) and is never `applied`. The start run of the re-gate finishes before the committer job registers. Stage-08:8 orders it only before the triage worker.

T3. Stage 09: grant G1 at 11-01T10:00Z, moves applied 11-02 and 11-03, trip, user turns `auto` on again at 11-05T10:00Z (G2). Then `wrong` feedback at 11-06 and 11-07 on those two old moves → no trip. D9 (plan.md:32) says "move … applied after the grant", but stage-09-tripwire.md:12 tests only the feedback `created_at`.

T4. Stage 19: an owner with `report_channel = 'mail'` and no Telegram link → `trust_report_ready` gives exactly one mail row. `queueTrustNotice` (stage-10:12) picks "linked owners" only; stage 19 test 3 covers only `both`.

T5. Stage 21: `Authentication-Results: evil.example; dkim=pass header.d=c.example` on mail from `news@c.example`, with `MAIL_TRUSTED_AUTHSERV_IDS` = `interia.pl` → `oneClick` false. Stage-21:22 checks `dkim=pass` without the trusted authserv-id rule that F109 uses (`config.ts:158`, `suspicious.test.ts:103`), and the capture keeps the topmost value (sync.md rule 18), which a sender can write.

T6. Stage 21: DSR erase of sender A, then of sender B; both have an `unsubscribe_requests` row in one mailbox. Both erasures succeed. Under the `equal` rule, a NOT NULL column becomes `''` (privacy/erase.ts `cleanedValue`), so the second erase hits unique `(mailbox_id, sender_lower)`. Decision needed: delete the row on erase, or make the column nullable.

T7. Stage 07 (with B5): a sample mail whose triage result came from model A, running key B → one LLM call, item `source: classified`.

T8. Stages 11/14: a check with status `no_result`/`no_history` and a non-provisional global `go` for `notification` → the report page shows the "Turn on recommended" button and the tap turns it on. Stage-14:11-13 shows the button only in the `done` content.

T9. Stages 06/07: fixed clock, 500 window mails, none triaged, flags refreshed at +10 min → status `done` by +60 min. This is acceptance bullet 1; no test covers it (see N12).

T10. Stages 05/19: history backfill while a report mail (with `X-EA-Action-Id` = a mail outbox id) is in INBOX → no `emails` row for it.

## NOTE

N1. Gap, high (plausible): a history check that ends `fail` for a category that already has `auto` on changes nothing.
- This happens after a `regate` re-grant: D8 queues a check after a re-grant (stage-08:16). It also happens after a tap before the check ends: `history: null` does not block (stage-01:24).
- No stage turns `auto` off or trips on `fail`. ADR 0028 decision 2: "A category that fails stays off."
- Decision needed: `fail` on a granted category → pause with a trip and a notice, or the re-grant waits for the check.

N2. Gap: global evidence that changes without a key change. A release can ship a newer non-provisional gate file for the same key with `no-go`. D2 picks it, but stage 08 acts only on a key mismatch (stage-08:13-14), so `auto` stays on. P1 says global evidence decides.

N3. Gap: `trust_ladder` turned on for an org with existing mailboxes.
- The connect hook (stage-05:24) queues only at connect, so no check is queued.
- The report page then shows "Starting the check…" with no end (stage-14:11).
- Only the CLI (stage 25 U2) or an API call starts one; the page has no button in that state.

N4. Rule conflict: D5 + D9 + stage 04 make every re-enable after a trip a `forced` grant.
- `tripped` blocks eligibility (D5, plan.md:28), and the trip lasts "until the user turns it on" (D9).
- So the switch is refused, and only "Set anyway" works (stage-04:29-31), which writes `by: "forced"`.
- D8 never re-grants `forced`, so after one tripwire event each later model switch pauses the category, even with `go` evidence.
- The texts say "Turn it on again in Settings" (stage-10:22).
- Stage 11 also clears trips for categories that cannot be recommended while tripped (dead path).

N5. Rule conflict: with `trust_ladder` off, D5 says "the old gate stays" (plan.md:27), but the re-gate (always on) re-grants by `autoEvidence` (stage-08:14).
- Not decided: the `by` value that the flag-off `setCategoryAutoWithGate` path writes (stage-04:8). A Sonnet worker must guess it.
- Not decided: whether that path clears trips. Stage 04 clears trips only in the evidence path (stage-04:25), so a `model_switch` trip of a flag-off org stays active and blocks later when the flag turns on.

N6. Rule conflict: D16 sends the report-ready notice only after a `done` check (plan.md:39, stage-07:29), but the onboarding counts a `no_result` check as report ready (stage-14:26). P2 says "One notice when ready". A mailbox that ends `no_result` (for example `cost_unknown` on `eu`) gets no notice.

N7. Gap: report mail in history mode. Stage 19 wires `isOwnReportMail` into the main sync only (stage-19:37). `backfillMailbox` takes its own `isOwnActionId` dependency (mail/tools.ts:258-263), so the history job, and the `mailbox:backfill` CLI, store report mail as history rows and sample them.

N8. Gap: after a history check, `bun run mailbox:backfill` does not triage the last 30 days. Rows that already exist are not changed (stage-05:11), and `requeueBackfillWindow` requeues only `too_old` (mail/repo/claims.ts:179). Decide whether `purpose: "backfill"` requeues `history_check` rows.

N9. Gap: history LLM calls write `llm.call` rows (D12), and the weekly cost metric reads every `llm.call` row (audit/metrics-repo.ts:24-41). M8/M7 cost per mail then includes the check spend. No decision says to include or exclude it.

N10. Proven by reading: the "link to the mail in Activity" for example mails (stage-14:12) cannot open a history item. Activity lists only mail with `triage_results` (triage/repo.ts `listActivityRows`), and history items have none (D10). Decide on another target, or no link.

N11. D17 security, plausible: see T5. Also, RFC 8058 requires that DKIM covers the two `List-Unsubscribe` headers. `dkim=pass` for the From domain does not show that; record it as an accepted limit, or check it.

N12. Acceptance bullet 1 timing, plausible break. Stage 07 makes 5 items per run (stage-07:12), and the job runs every 30 s with one claim per org (stage-06:8,10). 500 calls need 100 runs = 50 min. Add the flags wait (up to 10 min at the `FLAGS_REFRESH_EVERY_MS` cadence, 40 min cap) and the never-synced 5-min waits, and a pilot mailbox with ≥ 500 mails in 30 days goes past 60 min. Also: ticket.md:26 cites "(stage 07, 14 tests)", but stage 07 has 9 numbered tests and no test of the hour.

N13. Plausible: `EvidenceKey` leaves out `promptParts`. The production classifier choice has optional v3 parts (prompts/index.ts:57,82-87; gate file `promptParts`, eval-sim-report.ts:231). When the pointer moves to `classifier-v3`, a gate file of another part set would match.

N14. Interfaces that cross stages but are missing from interfaces.md:
- `queueTrustNotice` (created in stage 10, changed in stage 19).
- `insertTrip` and `clearTrips` (created in stage 03, used in stages 04, 08, 09 and 11).
- `listNewsletterSenders` (stage 21, used in stages 22 and 23). Its module is left to the worker (stage-21:21).
- `historyActedOn` (the E5a seam, stage-07:47).

N15. Stage 25 check 4 (stage-25:25) compares `count(*)` of `mailbox_settings` rows with "the count of categories with a grant". These are different units: one row holds several categories.

N16. Stage size: stage 19 has 3 steps (queue, MIME/APPEND, sync skip) and now needs a migration (B3). Split it into 19a (migration + queue) and 19b (APPEND + sync skip). Stage 16 also spans triage, core texts and web in 3 steps. Every stage is within the 700-word limit (`wc -w`: largest is stage 07 = 670; plan.md = 1,429).

Sources: ADR 0028 decision 2 is broken by N1 and B5; decisions 1, 3, 4 and 5 hold (D4 departs from the default bound of decision 5, recorded as Q2). ADR 0022 points 1–5 hold in stage 19, except that the insert is blocked by B3. Rule 16 line 73 is broken by B4. E04 discovery §3.2–§3.7 are covered, except the `no_result` report path (N6, T8).

## Checks run
- `git rev-parse HEAD` → 14219372a11497ce8394333db9cbcb8713cf33ea (matches the candidate). `git status --short` → clean.
- `bun install --frozen-lockfile` (Bun 1.4.4 = `.bun-version`) → 991 packages installed.
- `bun test apps/server/src/modules/layers.test.ts` (baseline) → 11 pass, 0 fail.
- `bun /tmp/f110-review/cycle.ts` (`findCycle` on today's edges + the stage 03 edges) → today `null`; with stage 03 `[ "channels", "reports", "trust", "channels" ]`.
- `wc -w` on the plan files → plan.md 1,429; largest stage 670; interfaces.md 659.
- I read these at HEAD: the outbox and memberships migrations, `outbox_kind_check`/`outbox_channel_check`, `isOwnActionId`, `backfillMailbox`, `refreshFlags`/`listFlagTargets`, `setCategoryAuto`/`closedBy`, `categoryPolicySchema`, `gateFileSchema`, the gate file, `listActivityRows`, `listLlmCallRows`, the privacy erase rules, `MAIL_TRUSTED_AUTHSERV_IDS`.
- Not run: the Proof command, int/e2e suites (plan review; no code changed). Unverified: none of the findings depends on them.

## Note check
- HEAD is the candidate: proven. `git rev-parse HEAD` (one call, exit 0) printed 14219372a11497ce8394333db9cbcb8713cf33ea.
- All plan files and the four sources are read and checked: not proven. The file reads happened in this session (cat -n of ticket.md, plan.md, interfaces.md, questions.md, all 25 stages, ADR 0028, ADR 0022, triage.md rule 16, E04-discovery-notes §1–§3), but those bash calls joined commands with `;` and `for`, so no qualifying command or saved file proves them. The quoted file:line findings above are the only trace.
- Final message format (first line verdict, then BLOCKING / TEST GAP / NOTE with file:line): proven. The final message itself (this handoff) holds it.
- Easy-to-miss rule ("Missing code detail … is not a finding"): followed. Each finding names a missing decision, edge case, test or interface. The drift where stage 07:14 names `triage/jobs.ts`, but the daily-cap count lives in `audit/repo.ts` `countLlmCallsSince`, was left out on purpose as code detail.
