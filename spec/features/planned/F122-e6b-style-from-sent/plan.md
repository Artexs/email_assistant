# F122 · Style from Sent: plan

> **Status 2026-11-20 — planned.** Plan base: ead9ec4d3. 10 stages; nothing built.

Names: [interfaces.md](interfaces.md). Defaults: [questions.md](questions.md). Sources: epic E06 decision 11, `E06-discovery-notes.md` §3.9, ADR 0029, ADR 0033, F115 `tuning-4.md`.

## Input

Owner words, word for word:
- PD-080: "E6b "Suggest my style from my sent mail": one tap, up to 100 own sent texts that E5a stores (last 14 days, quotes cut), one LLM call, the user edits and saves; only the saved text stays. Needs one amendment of ADR 0029 decision 7. No sent mails as examples in prompts."
- PD-079: "An expand migration copies `organizations.style_text` into each mailbox's signature; E6b drops the column in a contract step (PD-053)."
- Board (owner, 2026-11-20): "the judge-gain gate is the last stage (ship gate behind a flag, owner 2026-11-20); build after F115 closes; about $1 of judge runs."
- Job: "About 1 USD of judge runs is the cap."

### Product decisions (do not reopen)

- **P1** PD-080 as quoted. ADR 0029 decision 7 already names the E6b call; no ADR edit.
- **P2** The PD-079 contract step is ours.
- **P3** The feature ships behind its own flag; it turns on only after the gate of stage 09 passes (owner, 2026-11-20). Exception to the rule "a prompt change commits its gate file before the merge": `stylist-v1` lands in stage 01 with no gate file, behind the off flag; stage 09 writes its evidence (owner board line 2026-11-20; `questions.md` 15).
- **P4** Production drafts are skeletons (`drafter-v4`, G1 2026-11-20). This plan does not change the drafter; a style that it cannot show is a gate failure.

### Design decisions

- **D1 Role.** New LLM role `stylist` (`light`, effort `low`), prompt `stylist-v1` in the triage registry. Rejected: a second prompt under `drafter` (one production prompt per role).
- **D2 Sync call.** One call in the route, as Preview (`createStylePreview`); nothing queued or stored. Rejected: a request table (PD-080).
- **D3 Sources.** Rows of `sent_emails` of the mailbox: `origin = user`, `content = stored`, `body_text` not null, `internal_date` in the last 14 days, `auto_submitted` null or `no`, `list_id` null, `precedence` not `bulk`/`list`/`junk`, `has_calendar` false, `action_id` null (a system draft is not the user's style); newest 100. Synthetic scope: test mail only. Only the body goes to the model.
- **D4 Cut.** Core `cutQuotedReply` cuts at the first reply header, drops `>` lines, cuts at `-- ` and removes the stored signature. Samples ≤ 1,500 characters each, ≤ 60,000 in all; an empty one does not count.
- **D5 Minimum** (default). Under 5 samples after the cut → `too_few`, no call.
- **D6 Prompt.** Samples in one data block with a random id (untrusted). The answer describes form of address, greeting, sign-off, length, tone and language use, in the tapping user's language (pl/en), with no name, contact, number, quote or topic.
- **D7 Checks.** `checkStyleSuggestion` runs on every answer with no allowed list (`allowedOf` later trusts the writing style, F9). One retry with the failure codes, then `failed` / `checks`. The text must also pass `checkProfileInput`.
- **D8 Gates.** Flags `reply_drafts` and `style_from_sent` (404, before the role); owner; flag `sent_sync` and the switch "Track my sent mail" (409 `sent_off`); a password IMAP mailbox (409 `blocked` `oauth_mailbox`); a provider with a sub-processor row (`realMail`, else `failed` / `llm_off`).
- **D9 Limits.** At most 3 suggestion runs with a model call per mailbox per quota day (no-call answers do not count), then 429 `suggest_limit`; one at a time, else 429 `suggest_busy`. Calls count in `LLM_DAILY_CAP` as a tap: at 100% → `failed` / `llm_cap`.
- **D10 Switch-off wins.** The service reads the switch again after the call; off → `sent_off`, the text is dropped.
- **D11 Records.** One `llm.call` row per attempt (role `stylist`, no `email_id`); one audit row `mailbox.style_suggested` per run, never text; log events `style_suggested`, `style_suggest_failed` (ids, counts, codes).
- **D12 Panel.** An owner sees the button while both flags are on; the answer shows in a box with "Use this text" (fills the writing-style field) and "Discard"; only Save saves. Switch off: the button is off with a reason.
- **D13 Contract, two releases.** Stage 04: a data migration copies `style_text` into each null profile signature (a missing row is created) and empties the column; no code reads or writes it, also not the export and the DSR erase (review B1); `PATCH /api/organization` refuses `styleText`. Stage 05, a later release: drop with `-- contract:`. Rejected: one release (`release.sh` migrates before the swap).
- **D14 New mailbox** (default). After stage 04 new mailboxes sign with the owner name.
- **D15 Gate.** A paired run on the reply holdout: config A no writing style, config B the `stylist-v1` text made from `sent-holdout`. `judge-v4` = `judge-v3` plus `style_match` (0–2) against the reference style (`executive.voice`). Bars: stage 08 (Wilson test on wins; paired flip tests for facts).
- **D16 Spend.** Total ≤ $1.00 for stage 09; each `--budget-usd` is the rest of the $1.00; a futility stop after the dev smoke (default). A run stopped at the cap gives the verdict `stopped`; the owner decides on more spend.
- **D17 Gate fail.** The flag stays off; the code stays; the result goes into `tuning-1.md` and `outcome.md`. A drafter that shows style is a new ticket.

## Facts checked (ead9ec4d3)

- **F1** `sent_emails.body_text` is the full text, not quote-cut. (scout 1, read)
- **F2** ADR 0029 decision 7 already names the E6b call. (read)
- **F3** `prompts` holds one entry per role; no DB CHECK on the role. (scout 4)
- **F4** `drafter-v4`: "The greeting follows the email, also when the writing style says otherwise." (read)
- **F5** `judgeReplyDraft` sends no persona or style. (read)
- **F6** The drafter eval style is `executive.voice`, no override; sent bank 50 dev, 250 holdout mails. (scout 3, read)
- **F7** Holdout cost with judge: $0.4329 for 260 cases (`tuning-4.md`).
- **F8** `release.sh` runs `migrate` before the swap; `db:check-migrations` needs `-- contract:` for a drop. (read)
- **F9** `allowedOf` in the drafter allows strings of the writing style. (scout 2)
- **F10** The export selects every listed column; an F115 schema test re-runs an Up part that reads `style_text`; sent parts span 2027-01-25 to 01-31. (review 1)

## Not verified

- **N1** That a style text changes `drafter-v4` drafts in a way the judge sees. Stage 09 measures it.
- **N2** The holdout cost with `judge-v4` (longer prompt) per config. Stage 09 stops at the budget.

## Done when

Ticket § Acceptance; `style_text` gone from schema and code; `tuning-1.md` of stage 09 holds a verdict; capability pages updated.

## Rules for every stage

- Read `docs/code-patterns.md`, this file, `interfaces.md` and your stage.
- No sent text, style text, subject or address in a log, error, audit row, test name or committed eval file, except the synthetic style texts of stage 09.
- New texts in `apps/web/src/i18n/` (en, pl) with a Polish unit test.
- Files under about 400 lines (stage 07 splits `eval-drafter.ts`).
- A gap or deviation is a question in the final message, not a choice.
- For each guard a stage adds (role, flag, org scope, input rule): remove it, run its test, see it fail, restore it; list them.

## Proof

The last line of `bun run check:job` (`check:job PASS master=… tip=…`), after the last commit.

## Checkpoints and owner steps

- **C1** after 02b: review of 01–02b (real Sent text to the LLM).
- **R1** release that carries stage 04, before stage 05 builds (coordinator).
- **O1** (record, not a stage): gate passed and stages 02–03 released → coordinator turns `style_from_sent` on for the pilot org with `setOrgFeature`.

## Review

`claude-opus-5-5` before land: 01, 02, 02b, 04, 05, 09 (LLM prompt, privacy, migrations, spend); 03 (Polish text). Else `claude-sonnet-5-5`.

## Stages

- 01 [Stylist core](stages/stage-01-stylist-core.md) `[risky]`
- 02 [Suggestion service](stages/stage-02-suggest-route.md) `[risky]`; needs 01
- 02b [Suggestion route](stages/stage-02b-suggest-route.md); needs 02
- 03 [Style card button](stages/stage-03-style-card.md); needs 02b
- 04 [Stop using style_text](stages/stage-04-style-text-stop.md) `[risky]`; may run next to every stage but 05
- 05 [Drop style_text](stages/stage-05-style-text-drop.md) `[risky]`; needs the release of 04
- 06 [Stylist eval](stages/stage-06-stylist-eval.md); needs 01
- 07 [Drafter eval style and judge-v4](stages/stage-07-style-ab.md); may run next to 06
- 08 [Style gate command](stages/stage-08-style-gate.md); needs 07
- 09 [Gate run](stages/stage-09-gate-run.md) `[risky]`; needs 01, 06, 07, 08

## How to run (coordinator)

- Worker `claude-sonnet-5-5`, `--prepare 'bash scripts/limen-prepare.sh'`; ticket in `active/`. Start every stage whose Needs are met; 04 and 05 never next to another migration. 09 spends ≤ $1.00.

## Planning progress

- Scouts: 4 (`scouts.md`); every packet had `Verified` lines; F2, F4, F5, F8 read again by the planner.
- [written] plan, interfaces, questions, stages 01–09; review fixes.
- Words (`wc -w`): plan 1500; stages 01 700, 02 683, 02b 249, 03 589, 04 698, 05 456, 06 690, 07 466, 08 485, 09 697.

## Cold review

Opus (`[risky]` stages, privacy, migrations, spend). [plan-review-1.md](plan-review-1.md): FAIL, B1–B2 and N1–N17. All fixed in the plan, the stages and `questions.md` 13–16; stage 07 split into 07 and 08. Rejected: none.

## Log
