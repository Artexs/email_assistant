# F110 · Plan

> **Status 2026-11-15 — planned.** Plan base: 9341d9f0. Nothing built.

## Input

Owner (PD-030, 2026-11-13): "we can't rely on users to confirm any values there, whether this is 30 or 10 or even 1 … system should also work properly based on the global assumptions … those 10 corrections or checks are fine but they should be optional or suggested but definitely not mandatory." Owner (E4 discovery): "The rest is fine. Use the default values." Sources: `docs/product/stage-2/epics/E04-control-surface.md`, `E04-discovery-notes.md` §3, ADR 0028, ADR 0022. Shared names: [interfaces.md](interfaces.md). Defaults: [questions.md](questions.md).

### Product (do not reopen)

- **P1 (PD-030)** Global holdout evidence per (model, prompt, endpoint) decides; the history check only blocks; user signals only block (tripwire; real labels block at 30+).
- **P2 (PD-032)** Report page from the history check with "Turn on recommended" (one tap). One notice when ready, one when the tripwire pauses. "Check 10 decisions" is optional.
- **P3 (PD-068)** History pass: Wilson 95% upper bound of acted-on mail moved ≤ 2% on ≥ 50; sample 500; $0.25 per check. Tripwire: 2 corrections of applied moves in 7 days, or one acted-on mail moved.
- **P4 (ADR 0022)** Digest and report by IMAP APPEND into the own INBOX; per user Telegram, mail or both; urgent and approvals stay on Telegram.
- **P5** Quiet hours per user (default 22:00–07:00), notices only.
- **P6 (PD-034)** Bulk unsubscribe is last and cuttable: RFC 8058 POST after a tap through a host guard, else "open the link"; never for spam or suspicious mail.
- **P7 (PD-017)** Urgency card on the Rules page through the existing command; VIP links to the VIP rules.
- **P8 (PD-045)** User-visible behaviour behind flags, default off.
- **P9 (rule 16)** Gate files match model and endpoint; a switch re-gates `auto`.

### Design

- **D1** Global evidence = gate files copied into the image (`deploy/Dockerfile`), read once at start. Rejected: a DB table (an import per release). No match → `none`.
- **D2** Match all five `EvidenceKey` fields (no `endpoint` = `standard`). Non-provisional first, then newest `date`, then name. A provisional `go` shows but is not eligible (Q1).
- **D3** Moving categories `info`, `notification`, `spam` get the history check and "recommended"; `urgent`, `needs_reply` keep the switch only (Q4).
- **D4** `n` = acted-on mails in the sample, `k` = those the category would move. `n < 50` → `no_result`; upper ≤ 0.02 → `pass`; `k/n > 0.02` → `fail`; else `inconclusive`. Only `fail` blocks: at `k = 0` the upper bound needs `n ≥ 189`, so P3 alone would block most mailboxes, against P1 (Q2).
- **D5** Eligible = non-provisional global `go`, history not `fail`, no active trip, real-label gate not `no-go` at ≥ 30 labels. Recommended = eligible and D3. "Set anyway" stays (`forced`). With `trust_ladder` off, the old gate stays.
- **D6** Acted-on = `\Answered` or `\Flagged`, or feedback with true category `urgent`/`needs_reply`. Sent signals wait for E5a.
- **D7** Each `auto` on stores a `CategoryGrant`. Triage uses `effectiveAutoFor`: a key mismatch is `auto` off at once. A pre-F110 `auto` has no grant: it counts as matching until the first re-gate run stamps the running key (`legacy`), so the deploy changes nothing.
- **D8** Re-gate job (always on): on a mismatch, eligible under the new key → grant `regate`; else `auto` off, trip `model_switch`, one notice. `forced` grants are never re-granted. Queue a history check; a stale `fail` blocks until a newer check ends.
- **D9** Correction = feedback `wrong` (any source) on a mail whose `move` for that category applied after the grant. Trip at ≥ 2 in 7 days, or 1 with true category `urgent`/`needs_reply` (Q3). A trip turns `auto` off until the user turns it on.
- **D10** History backfill stores mail `skipped` / `history_check`: no digest, action, daily cap or requeue. INBOX only. Reuse the newest `triage_results`; else classify with the triage hard rules, classifier and thresholds.
- **D11** Sample: acted-on mail first (newest first), then a fill seeded by the check id, to 500. Cleared bodies left out.
- **D12** History calls write `llm.call` with `data.historyCheckId`; `LLM_DAILY_CAP` skips them; the LLM pause applies. Stop at $0.25 (`capped`) and evaluate. Unpriced model → `no_result`/`cost_unknown` (Q5).
- **D13** Steps are idempotent (dedup key; items `(check_id, email_id)`); a crash repeats at most one LLM call. `SKIP LOCKED` claim, 10-min stale lock, 3 attempts → `no_result`/`stopped`.
- **D14** Mail channel: outbox `channel = 'mail'` with `mailbox_id`; APPEND to INBOX with `X-EA-Action-Id: <outbox id>`; `main.ts` adds `isOwnReportMail` to the own-mail check. By mail: `digest`, `weekly_report`, `trust_report_ready`, `autonomy_paused` (Q6). Subject prefix `[Email assistant]`; links to `WEB_BASE_URL` only.
- **D15** No new mail-derived data in Telegram (counts, categories, fixed phrases, confidence, delegate tags): no consent bump. A stage that adds one bumps `TELEGRAM_CONSENT_VERSION`.
- **D16** `trust_report_ready` only after a mailbox's first `done` check.
- **D17** One-click only with both RFC 8058 headers, an `https` URI and `dkim=pass` for the From domain. POST: all resolved addresses pass `isLocalAddress`, pinned connection, no redirects (3xx = `failed`), 10 s timeout. Intent row first; audit holds the domain only.

## Facts checked (2026-11-15, 9341d9f0)

- **F1** One gate file, provisional: `info` go at 0.95, others no-go. The Dockerfile copies `evals/cases` only.
- **F2** Only the CLI and tests call `backfillMailbox`; backfilled mail is `pending` (scout 1).
- **F3** `outbox.channel` exists; `isOwnActionId` matches draft and send actions only.
- **F4** `categoryAuto` gates `move` and `mark_read`; junk-folder `urgent` moves under `urgent`'s `auto`.
- **F5** `setUrgencyProfile` and its route exist; no web card.
- **F6** `LlmClient.modelOf`/`endpointOf` exist; F111 stage 03 landed. F102 01–08 landed.

## Not verified

- **N1** `refreshFlags` covers `skipped` history mail: stage 06 tests it.
- **N2** Interia sets `\Answered`: stage 07 logs counts.
- **N3** Bun `node:https` honours a custom `lookup`: stage 23 probes first.

## Done when

1. A new mailbox gets a history check with no user step; the report shows within an hour.
2. "Turn on recommended" turns on only eligible moving categories, in `assist`.
3. A model or endpoint switch stops `auto` before the next plan.
4. Two corrections in 7 days pause a category with one notice.
5. A mail-only user gets the digest in INBOX, not triaged.
6. Each Proof prints `PROOF_OK`.

## Rules for every stage

- Read `CLAUDE.md`, the styleguide, `docs/code-patterns.md`, the ticket, this file, `interfaces.md`, your stage.
- Format only your files. Commit by explicit path after `git diff --staged`.
- No mail text, subject, address, URL or token in logs, errors or test names.
- Page keys in `en.ts`/`pl.ts`; notice texts in `packages/core/src/texts/`.
- A new `/api` route gets `apiDoc` in the same commit. A new table or column joins the F106 maps.
- Fixed clocks; quiet-hour tests cover a DST day in `Europe/Warsaw`.
- A gap or deviation is a question in the final message.

## Proof

```
mkdir -p /tmp/f110-sNN && bun run lint > /tmp/f110-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f110-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f110-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f110-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages (13, 14, 15, 18, 20, 22) add before `echo`: `&& bun run web:build > /tmp/f110-sNN/web.log 2>&1 && grep -q 'csp checked in' /tmp/f110-sNN/web.log && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f110-sNN/e2e.log 2>&1`. Own e2e DB `f110_sNN_e2e` (as F102 stage 07). New UI passes `expectNoA11yViolations`.

## Owner checkpoints and steps (not a stop)

- **C1** After 09: a review job over 03–09.
- **U1** After 03 and 21 land: `bun run db:migrate` on the shared dev DB.
- **U2** After 25: `trust_ladder` on for the pilot org; 10-minute phone test.

## Review

`claude-opus-5-5` before land: 03–09, 19, 21, 23, 25 (risk); 10, 13, 14, 16, 18, 20, 22 (Polish text).

## Stages

- 01 [Evidence core](stages/stage-01-evidence-core.md)
- 02 [Gate reader](stages/stage-02-gate-reader.md); needs 01
- 03 [Migration](stages/stage-03-migration.md) `[risky]`; needs 01
- 04 [Grant and gate](stages/stage-04-grant-and-gate.md) `[risky]`; needs 02, 03
- 05 [History backfill](stages/stage-05-history-backfill.md) `[risky]`; needs 03
- 06 [History job](stages/stage-06-history-job.md) `[risky]`; needs 05
- 07 [History classify](stages/stage-07-history-classify.md) `[risky]`; needs 02, 06, 10
- 08 [Re-gate](stages/stage-08-regate.md) `[risky]`; needs 04, 07, 10
- 09 [Tripwire](stages/stage-09-tripwire.md) `[risky]`; needs 04, 10
- 10 [Trust notices](stages/stage-10-trust-notices.md); needs 03
- 11 [Trust API](stages/stage-11-trust-api.md); needs 07, 09
- 12 [M8 evidence](stages/stage-12-m8-evidence.md); needs 11
- 13 [Autonomy card](stages/stage-13-autonomy-card.md); needs 11
- 14 [Report page](stages/stage-14-report-page.md); needs 13
- 15 [Panel review](stages/stage-15-panel-review.md); needs 14
- 16 [Why lines](stages/stage-16-why-lines.md)
- 17 [Spam review line](stages/stage-17-spam-review-line.md); needs 16
- 18 [Quiet hours and channel](stages/stage-18-quiet-hours-channel.md); needs 03
- 19 [Mail channel](stages/stage-19-mail-channel.md) `[risky]`; needs 10, 18
- 20 [Urgency editor](stages/stage-20-urgency-editor.md)
- 21 [Unsubscribe data](stages/stage-21-unsubscribe-data.md) `[risky]`; needs 03 migrated
- 22 [Newsletters view](stages/stage-22-newsletters-view.md); needs 21
- 23 [One-click POST](stages/stage-23-one-click.md) `[risky]`; needs 22
- 24 [Docs](stages/stage-24-docs.md); needs 01–23
- 25 [VPS deploy](stages/stage-25-vps-deploy.md) `[risky]`; needs 24

## How to run (coordinator)

- Worker `claude-sonnet-5-5`, `--prepare 'bash scripts/limen-prepare.sh'`, ticket in `active/` first.
- Lanes after 01: {02}, {03→10→05→06→07}, {16→17}, {20}; then by "Needs". Never build 03 or 21 next to another migration.
- Land with the `spec/build.md` land check; drop job DBs. Stage 25: the coordinator. 21–23 can be cut.

## Planning progress

- Scouts: 4 ([scouts.md](scouts.md)).
- [ ] Stages 01–25.

## Cold review

Not run yet.

## Log
