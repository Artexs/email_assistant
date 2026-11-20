# F122 · Style from Sent: plan

> **Status 2026-11-20 — planned.** Plan base: ead9ec4d3. 8 stages; nothing built.

Names: [interfaces.md](interfaces.md). Defaults: [questions.md](questions.md). Scouts: [scouts.md](scouts.md). Sources: epic E06 § Discovery decision 11, `E06-discovery-notes.md` §3.9, ADR 0029 decision 7, ADR 0033, F115 `tuning-4.md`.

## Input

Owner words, word for word:
- PD-080: "E6b "Suggest my style from my sent mail": one tap, up to 100 own sent texts that E5a stores (last 14 days, quotes cut), one LLM call, the user edits and saves; only the saved text stays. Needs one amendment of ADR 0029 decision 7. No sent mails as examples in prompts."
- PD-079: "An expand migration copies `organizations.style_text` into each mailbox's signature; E6b drops the column in a contract step (PD-053)."
- Board (owner, 2026-11-20): "the judge-gain gate is the last stage (ship gate behind a flag, owner 2026-11-20); build after F115 closes; about $1 of judge runs."
- Job: "About 1 USD of judge runs is the cap."

### Product decisions (do not reopen)

- **P1** PD-080 as quoted. ADR 0029 decision 7 is already amended (accepted text names the E6b call); no ADR edit is needed.
- **P2** PD-079 contract step belongs to this ticket.
- **P3** The feature ships behind its own flag; it turns on only after the gate of stage 08 passes (owner, 2026-11-20).
- **P4** Production drafts are skeletons (`drafter-v4`: greeting from the mail, "Regarding <topic>: [[gap]]." lines, code signature; G1 2026-11-20). This plan does not change the drafter. A style that the drafter cannot show is a gate failure, not a reason to change the drafter here.

### Design decisions

- **D1 Role.** New LLM role `stylist`, tier `light`, effort `low`, prompt `stylist-v1` in the triage prompt registry. Rejected: a second prompt under role `drafter` (the registry holds one production prompt per role; the cap and the eval need their own role).
- **D2 Sync call.** One synchronous call in a route, as Preview does (`createStylePreview`). Nothing is queued or stored. Rejected: a request table (PD-080: only the saved text stays).
- **D3 Sources.** Rows of `sent_emails` of the mailbox: `origin = user`, `content = stored`, `body_text` not null, `internal_date` in the last 14 days, `auto_submitted` null or `no`, `list_id` null, `precedence` not `bulk`/`list`/`junk`, `has_calendar` false; newest 100. Under the `synthetic` LLM scope only test mail counts (the rule that the open-loop analysis and `replySampleScope` apply). Only the body goes to the model: no subject, address, date or id.
- **D4 Cut.** Pure core `cutQuotedReply` cuts each text at the first reply header (en, pl, our `quoteReply` forms, "Original message" lines, an `From:`/`Od:` header block), drops `>` lines, cuts at a `-- ` line and removes the stored signature text. Each sample ≤ 1,500 characters, all samples ≤ 60,000. A text that is empty after the cut does not count.
- **D5 Minimum** (default). Fewer than 5 samples after the cut → `too_few` with the count; no call.
- **D6 Prompt.** Samples go in one data block with a random id (untrusted text). Output schema `{ style: string }`. The text describes form of address, greeting, sign-off habit, length, tone and language use, in the language of the tapping user (pl/en). It holds no name, address, phone, link, number, quote or topic.
- **D7 Checks.** `checkStyleSuggestion` (core) runs on every answer, with no allowed list (the drafter's `allowedOf` later trusts the writing style, so the suggestion must be clean). Codes in `interfaces.md`. One retry with the failure codes, then `failed` / `checks`. The output must also pass `checkProfileInput` for `writingStyle`.
- **D8 Gates.** Route needs: owner; org flags `reply_drafts` and `style_from_sent` (404 while either is off, flag before role, as Preview); flag `sent_sync` and the mailbox switch "Track my sent mail" on (else 409 `sent_off`); a password IMAP mailbox (else 409 `blocked` `oauth_mailbox`, F115 D19); a provider with a sub-processor row (`realMail`, else `failed` / `llm_off`).
- **D9 Limits.** At most 3 suggestion runs per mailbox per quota day (count of `mailbox.style_suggested` audit rows; a retry is one run), then 429 `suggest_limit`; one run per mailbox at a time, then 429 `suggest_busy`. The calls count in `LLM_DAILY_CAP` as a tap (`capVerdict` trigger `tap`): at 100% → `failed` / `llm_cap`.
- **D10 Switch-off wins.** After the call the service reads the switch again; if it is off now, the answer is `sent_off` and the text is dropped.
- **D11 Records.** One `llm.call` row per attempt (role `stylist`, no `email_id`). One audit row `mailbox.style_suggested` per run (`mailbox_id`, `count`, `outcome`; never text). Log events `style_suggested`, `style_suggest_failed` (`mailbox_id`, `count`, `error_code`).
- **D12 Panel.** The style card shows "Suggest my style from my sent mail" for an owner while both flags are on. The answer shows in a box with "Use this text" (replaces the writing-style field) and "Discard"; nothing is saved until Save. With the switch off the button is off and a line says why.
- **D13 Contract, two releases.** Stage 04: a data migration copies `style_text` into `mailbox_profiles.signature` where the signature is null (a missing profile row is created), and the code stops every read and write of the column (fallback chain becomes signature → owner name). `PATCH /api/organization` refuses `styleText` (400). Stage 05, in a later release: drop the column with `-- contract: v<release of 04>`; privacy maps and export lose it. Rejected: one release (`release.sh` migrates before the image swap; the old image would read a dropped column).
- **D14 New mailbox** (default). After stage 04 a new mailbox has no signature until the owner writes one (owner name fallback).
- **D15 Gate.** A paired run on the reply holdout: config A no writing style, config B the `stylist-v1` text made from `sent-holdout`. Judge `judge-v4` = `judge-v3` plus score `style_match` (0–2) against the reference style (scenario `executive.voice`). Bars in stage 08. Gate file `evals/results/gate/stylist-<version>-<model>-<effort>-lab-01-v1.json`.
- **D16 Spend.** Total ≤ $1.00 for stage 08, ledger lines checked; each run `--budget-usd` as stage 08 says.
- **D17 Gate fail.** The flag stays off; the code stays; the result goes into `outcome.md`. A drafter that shows style is a new ticket.

## Facts checked (ead9ec4d3)

- **F1** `sent_emails.body_text` holds the full text (≤ 100,000 characters, `sent-texts.ts`); no quote cut at store time. Retention clears it after `data_retention_days`. Cascade with the mailbox; the switch off deletes the rows. (scout 1, read again)
- **F2** ADR 0029 decision 7 already names the E6b call. (read)
- **F3** `prompts` holds one entry per role; `llmRoles` = classifier, judge, drafter, extractor; no DB CHECK on the role. (scout 4)
- **F4** `drafter-v4`: "The greeting follows the email, also when the writing style says otherwise." (read)
- **F5** `judgeReplyDraft` sends no persona or style; `tone_fits` is "fits a short message from a manager's assistant". (read)
- **F6** The drafter eval takes `writingStyle` from `executive.voice`; no override flag. Sent bank: `sent-dev` 50 and `sent-holdout` 250 mails of one persona. (scout 3, read)
- **F7** Holdout cost with judge: $0.4329 for 260 cases (`tuning-4.md`).
- **F8** `release.sh` runs `migrate` before the swap; `db:check-migrations` needs `-- contract:` for a drop. (read)
- **F9** `allowedOf` in the drafter allows strings of the writing style. (scout 2)

## Not verified

- **N1** That a style text changes `drafter-v4` drafts in a way the judge sees. Stage 08 measures it.
- **N2** That the holdout fits $0.50 per config with `judge-v4` (a longer judge prompt). Stage 08 stops at the budget.

## Done when

Ticket § Acceptance; `style_text` gone from schema and code; the gate file of stage 08 exists with its verdict; capability pages updated.

## Rules for every stage

- Read `docs/code-patterns.md`, this file, `interfaces.md` and your stage.
- No sent text, style text, subject or address in a log, error, audit row, test name or committed eval file, except the synthetic style texts of stage 08.
- New texts in `apps/web/src/i18n/` (en, pl) with a Polish unit test.
- Files under about 400 lines: `scripts/lib/eval-drafter.ts` is over it; split before you add.
- A gap or deviation is a question in the final message, not a choice.
- For each guard a stage adds (role, flag, org scope, input rule): remove it, run its test, see it fail, restore it; list them.

## Proof

The last line of `bun run check:job` (`check:job PASS master=… tip=…`), after the last commit.

## Checkpoints and owner steps

- **C1** after 02: review of 01–02 (privacy: real Sent text to the LLM).
- **R1** release that carries stage 04, before stage 05 builds (coordinator).
- **O1** (record, not a stage): gate passed and stages 02–03 released → coordinator turns `style_from_sent` on for the pilot org with `setOrgFeature`.

## Review

`claude-opus-5-5` before land: 01, 02, 04, 05, 08 (LLM prompt, privacy, migrations, spend); 03 (Polish text). Else `claude-sonnet-5-5`.

## Stages

- 01 [Stylist core](stages/stage-01-stylist-core.md) `[risky]`
- 02 [Suggestion route](stages/stage-02-suggest-route.md) `[risky]`; needs 01
- 03 [Style card button](stages/stage-03-style-card.md); needs 02
- 04 [Stop using style_text](stages/stage-04-style-text-stop.md) `[risky]`; may run next to 01–03, 06, 07
- 05 [Drop style_text](stages/stage-05-style-text-drop.md) `[risky]`; needs the release of 04
- 06 [Stylist eval](stages/stage-06-stylist-eval.md); needs 01
- 07 [Style A/B and judge-v4](stages/stage-07-style-ab.md); may run next to 06
- 08 [Gate run](stages/stage-08-gate-run.md) `[risky]`; needs 01, 06, 07

## How to run (coordinator)

- Worker `claude-sonnet-5-5`, `--prepare 'bash scripts/limen-prepare.sh'`; ticket in `active/`.
- Start every stage whose Needs are met. 04 and 05 hold the only migrations: never next to another migration in build.
- 08 spends real money (≤ $1.00); the worker stops at the cap.

## Planning progress

- Scouts: 4 (`scouts.md`).
- [written] plan, interfaces, questions, stages 01–08.

## Cold review

## Log
