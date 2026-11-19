# F110 · Plan

> **Status 2026-11-15 — planned.** Plan base: 17b2a369, refreshed 2026-11-15 ([plan-refresh-1.md](plan-refresh-1.md)). Nothing built.

## Input

Owner (PD-030, 2026-11-13): "we can't rely on users to confirm any values there … system should also work properly based on the global assumptions … they should be optional or suggested but definitely not mandatory." Owner (E4 discovery): "Use the default values." Sources: epic E04, ADR 0028, ADR 0022. Names: [interfaces.md](interfaces.md). Defaults: [questions.md](questions.md).

### Product (do not reopen)

- **P1 (PD-030)** Global holdout evidence per (model, prompt, endpoint) decides; the history check only blocks; user signals only block (tripwire; real labels block at 30+).
- **P2 (PD-032)** Report page with "Turn on recommended" (one tap); one notice when ready, one per pause; "Check 10 decisions" optional.
- **P3 (PD-068)** History pass: Wilson 95% upper bound of acted-on mail moved ≤ 2% on ≥ 50; sample 500; $0.25 per check. Tripwire: 2 corrections of applied moves in 7 days, or one acted-on mail moved.
- **P4 (ADR 0022)** Digest and report by IMAP APPEND into the own INBOX, per user; urgent and approvals stay on Telegram.
- **P5** Quiet hours per user (default 22:00–07:00), notices only.
- **P6 (PD-034)** Bulk unsubscribe, last and cuttable: RFC 8058 POST after a tap, else "open the link"; never for spam or suspicious mail.
- **P7 (PD-017)** Urgency card on the Rules page through the existing command.
- **P8 (PD-045)** New behaviour behind flags, default off.
- **P9 (rule 16)** Gate files match model and endpoint; a switch re-gates `auto`.

### Design

- **D1** Global evidence = gate files in the image, read at start. Rejected: a DB table (an import per release). No match → `none`.
- **D2** Match `EvidenceKey` (model, provider, effort, prompt version and parts, endpoint; host for `own`). Non-provisional first, then newest `date`, then name. A provisional `go` shows but is not eligible (Q1).
- **D3** Only `info`, `notification`, `spam` get the history check and "recommended" (Q4).
- **D4** `n` = acted-on mails in the sample, `k` = those the category would move. `n < 50` → `no_result`; upper ≤ 0.02 → `pass`; `k/n > 0.02` → `fail`; else `inconclusive`. Only `fail` blocks: at `k = 0` the upper bound needs `n ≥ 189`, so P3 alone would block most mailboxes, against P1 (Q2).
- **D5** Eligible = non-provisional global `go`, history not `fail`, real-label gate not `no-go` at ≥ 30 labels. Recommended = eligible, no active trip, and D3. A manual switch clears a trip. "Set anyway" stays (`forced`). With `trust_ladder` off, the old gate stays.
- **D6** Acted-on = `\Answered` or `\Flagged`, or feedback with true category `urgent`/`needs_reply`. Sent signals wait for E5a.
- **D7** Each `auto` on stores a `CategoryGrant`. Triage uses `effectiveAutoFor`: a key mismatch is `auto` off at once. A pre-F110 `auto` has no grant: it counts as matching until the first re-gate run stamps the running key (`legacy`), so the deploy changes nothing.
- **D8** Re-gate (always on, every org): on a mismatch, eligible under the new key → grant `regate`; else `auto` off, trip `model_switch`, one notice. Never re-grant `forced`. A newer `no-go` file for the same key → trip `evidence_changed`. Queue a history check; a stale `fail` blocks until a newer check ends.
- **D9** Correction = feedback `wrong` (any source) after the grant on a move of that category applied after the grant. Trip at ≥ 2 in 7 days, or 1 with true category `urgent`/`needs_reply` (Q3). A history `fail` after a non-forced grant also trips. A trip turns `auto` off until the user turns it on.
- **D10** History backfill stores INBOX mail `skipped` / `history_check`: no digest, action or requeue. Reuse the newest `triage_results` only when its model and prompt version equal the check key (never for a `model_switch` check); else classify as triage does.
- **D11** Sample: acted-on mail first, then a fill seeded by the check id, to 500.
- **D12** History calls write `llm.call` with `data.historyCheckId`; `LLM_DAILY_CAP` skips them; the LLM pause applies. 20 mails per 15 s run. Stop at $0.25 (`capped`) and evaluate. Unpriced model → `no_result`/`cost_unknown` (Q5).
- **D13** Idempotent steps (dedup key; items `(check_id, email_id)`); a crash repeats at most one LLM call. `SKIP LOCKED`, 10-min stale lock, 3 attempts → `stopped`.
- **D14** Mail channel: outbox `channel = 'mail'`; APPEND to INBOX with `X-EA-Action-Id: <outbox id>`; every own-mail check adds `isOwnReportMail`. By mail: `digest`, `weekly_report` and the two trust kinds (Q6). Links to `WEB_BASE_URL` only.
- **D15** New Telegram texts hold counts, categories, fixed phrases, confidence and delegate tags: no consent bump (else bump `TELEGRAM_CONSENT_VERSION`).
- **D16** `trust_report_ready` after a mailbox's first `done` or `no_result` check. `trust` sits in layer 5; `reports` gets trust data by injection.
- **D17** One-click needs both RFC 8058 headers, `https` and a trusted `dkim=pass` for the From domain. POST: public pinned address, no redirects, 10 s. Intent row first; audit holds the domain.

## Facts checked (2026-11-15, 17b2a369)

- **F1** Running classifier v2 has one provisional gate file: `info` go at 0.95. The Dockerfile copies `evals/cases` only.
- **F2** Only the CLI calls `backfillMailbox`; backfilled mail is `pending`. **F3** `outbox.channel` exists; `isOwnActionId` matches drafts and sends only.
- **F4** `categoryAuto` gates `move` and `mark_read`. **F5** The urgency command exists; no card. **F6** F111 03 and F102 01–08 landed. **F7** `categoryPolicySchema` is non-strict (drops unknown keys). **F8** Setting `auto` off expires `ready` moves (`policy_changed`).

## Not verified

- **N1** `refreshFlags` covers `skipped` history mail (stage 06 test).
- **N2** Interia sets `\Answered` (stage 07 logs counts).
- **N3** Bun `node:https` honours a custom `lookup` (stage 24 probe).

## Done when

The five lines of `ticket.md` § Acceptance, and each Proof prints `PROOF_OK`.

## Rules for every stage

- Format only your files. Commit by explicit path.
- No mail text, subject, address, URL or token in logs, errors or test names.
- Page keys in `en.ts`/`pl.ts`; notice texts in `packages/core/src/texts/`.
- A new `/api` route gets `apiDoc` in the same commit. A new table or column joins the F106 maps. A migration passes `bun run db:check-migrations`.
- Logs are events; new fields go in `platform/log-fields.ts`. CLI output uses `createCliOutput`.
- Fixed clocks; quiet-hour tests cover a DST day in `Europe/Warsaw`.
- A gap or deviation is a question in the final message.

## Proof

```
mkdir -p /tmp/f110-sNN && bun run lint > /tmp/f110-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f110-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f110-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f110-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages (13, 14, 15, 18, 21, 23) add before `echo`: `&& bun run web:build > /tmp/f110-sNN/web.log 2>&1 && grep -q 'csp checked in' /tmp/f110-sNN/web.log && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f110-sNN/e2e.log 2>&1`. Own e2e DB `f110_sNN_e2e` (as F102 stage 07).

## Owner checkpoints and steps (not a stop)

- **C1** After 09: review job over 03–09.
- **U1** After 03 and 22 land: `bun run db:migrate` on the shared dev DB.
- **U2** After 26: `trust_ladder` on for the pilot org; 10-minute phone test.

## Review

`claude-opus-5-5` before land: 03–09, 20, 22, 24, 26 (risk); 10, 13, 14, 16, 18, 21, 23 (Polish text).

## Stages

- 01 [Evidence core](stages/stage-01-evidence-core.md)
- 02 [Gate reader](stages/stage-02-gate-reader.md); needs 01
- 03 [Migration](stages/stage-03-migration.md) `[risky]`; needs 01
- 04 [Grant and gate](stages/stage-04-grant-and-gate.md) `[risky]`; needs 02, 03
- 05 [History backfill](stages/stage-05-history-backfill.md) `[risky]`; needs 03
- 06 [History job](stages/stage-06-history-job.md) `[risky]`; needs 05
- 07 [History classify](stages/stage-07-history-classify.md) `[risky]`; needs 02, 06, 10
- 08 [Re-gate](stages/stage-08-regate.md) `[risky]`; needs 04, 07, 10
- 09 [Tripwire](stages/stage-09-tripwire.md) `[risky]`; needs 04, 07, 10
- 10 [Trust notices](stages/stage-10-trust-notices.md); needs 03
- 11 [Trust API](stages/stage-11-trust-api.md); needs 07, 09
- 12 [M8 evidence](stages/stage-12-m8-evidence.md); needs 11
- 13 [Autonomy card](stages/stage-13-autonomy-card.md); needs 11
- 14 [Report page](stages/stage-14-report-page.md); needs 13
- 15 [Panel review](stages/stage-15-panel-review.md); needs 14
- 16 [Why lines](stages/stage-16-why-lines.md)
- 17 [Spam review line](stages/stage-17-spam-review-line.md); needs 16
- 18 [Quiet hours and channel](stages/stage-18-quiet-hours-channel.md); needs 03
- 19 [Mail queue](stages/stage-19-mail-queue.md); needs 10, 18
- 20 [Mail APPEND](stages/stage-20-mail-append.md) `[risky]`; needs 19
- 21 [Urgency editor](stages/stage-21-urgency-editor.md)
- 22 [Unsubscribe data](stages/stage-22-unsubscribe-data.md) `[risky]`; needs 03 migrated
- 23 [Newsletters view](stages/stage-23-newsletters-view.md); needs 22
- 24 [One-click POST](stages/stage-24-one-click.md) `[risky]`; needs 23
- 25 [Docs](stages/stage-25-docs.md); needs 01–24
- 26 [VPS deploy](stages/stage-26-vps-deploy.md) `[risky]`; needs 25

## How to run (coordinator)

- Worker `claude-sonnet-5-5` with the prepare script; ticket in `active/` first. Workers read `CLAUDE.md`, styleguide, `interfaces.md`, stage.
- Lanes after 01: {02}, {03→10→05→06→07}, {16→17}, {21}; then by "Needs". Never build 03 or 22 next to another migration.
- `spec/build.md` land check; drop job DBs. Stage 26: coordinator. 22–24 are cuttable.

## Planning progress

- Scouts: 4 ([scouts.md](scouts.md)); refresh 1: none.
- `wc -w` after refresh 1: plan 1499; stages 04 682, 05 644, 06 697, 08 698, 16 583, 18 580, 20 500, 26 684.
- [x] Stages 01–26 written; reviews 1 and 2 fixed.

## Cold review

`claude-opus-5-5` (`[risky]` stages). Review 1 ([plan-review-1.md](plan-review-1.md)): FAIL, 5 blocking, 26 notes; all fixed. Review 2 ([plan-review-2.md](plan-review-2.md)): FAIL, 1 blocking, 8 notes; all fixed.

## Log

- 2026-11-15: planned; refresh 1 (→ 17b2a369, [plan-refresh-1.md](plan-refresh-1.md)).
- 2026-11-19 stage 26: deployed with release `v0.4.1` (`4f1e76df`) by `deploy/release.sh` (`release ok v0.4.1 previous v0.3.1`; rollback target `v0.3.1`). No model, provider or `OPENAI_BASE_URL` change. Checks: 1 `/health` 200, server lines carry `"release":"v0.4.1"`; 2 gate files: 3 (`classifier-v2`, `classifier-v3`, `extractor-v1` on `gpt-6-luna`, `lab-01`); 3 `trust_regate_done` `run=start` `stamped` 0 `paused` 0 (later `run=job` lines also `paused` 0); 4 `auto` without `grant`: 0; 5 30-min watch: 15 `sync_done`, 0 error lines (server log and `deploy/logs.sh --level error`), `ops:alerts` only resolved alerts; 6 `trust_ladder` on for the pilot organization, history check `done` after about 20 min, `cost_usd` 0.0152. Not done: the `/report` page through Tailscale (owner, U2). 7 flags still off: `why_lines`, `spam_review_line`, `user_quiet_hours`, `report_mail`, `urgency_editor`, `panel_review`, `bulk_unsubscribe`. Ticket not closed by this job; the stage 03 carry-over is open.
