> **Status 2026-11-15 — planned.** Plan base: b9261659. 16 stages; nothing built.

# F109 · E3b Improve — plan

## Input

Coordinator (2026-11-15): "… urgent, needs_reply and spam are no-go on the first holdout run; info and notification go … Mark risky stages [risky] (LLM spend, prompts that change production behaviour). Real LLM spend: the owner approved runs under the stage caps of the lab ( per run); a stage that needs more states the cap."

Product (owner, "in default values", 2026-11-13; `docs/product/stage-2/decisions.md`):

- **P1 PD-063** Code rules; the flag warns, never moves mail or overrides whitelist or VIP; flagged mail gets no delegation, reply or follow-up draft, no unsubscribe.
- **P2 PD-064** Attachment name, type, size into the prompt (untrusted) and the summary line; never content.
- **P3 PD-061** Each work-list item is a `classifier-v3` experiment on the dev set; only what wins and passes the holdout ships.
- **P4 PD-062** Sender history: counts only, no other mail's text.
- **P5 PD-060** A stronger model checks only before a hide of a person's mail or on `unsure`; no user setting; only if it closes the gap on the dev set.
- **P6 PD-067** LLM pause: VIP and whitelisted mail gets "not triaged yet" (sender only).
- **P7 PD-017** Urgency profile shape from E2a (`urgencyProfileSchema`); E3b stores it and adds the command; E4-B builds the editor.
- **P8 PD-045** New user-visible behaviour behind a flag, default off. **P9 PD-030** Labels never unlock `auto`.
- **P10 Second pass (default, owner to confirm, Q1).** Holdout: `urgent` false-negative rate 14.1%, `needs_reply` 6.2%, M1 target < 2% (`03-product-frame.md` §5). So the PD-060 condition holds: the escalation experiment is built (stages 12–13); stage 14 only on "ship".

Design (detail in the stages):

- **D1 Rules** `assessSuspicious` in core (stage 01), six reason codes; a known sender gets only `auth_fail` and `risky_attachment`. Rejected: an LLM phishing judgement (cost, injection surface).
- **D2 Trusted `Authentication-Results`**: its `authserv-id` matches the IMAP host's registrable domain or `MAIL_TRUSTED_AUTHSERV_IDS` (Q2). Rejected: any topmost header (a sender writes one when the host adds none).
- **D3 Registrable domain** by a built-in two-level suffix list. Rejected: a public-suffix library (dependency, upkeep).
- **D4 Known sender** (stage 03): own addresses, delegates, whitelist and VIP rules, senders with ≥ 3 unflagged non-`spam` mails in 90 days; never by a free-mail domain.
- **D5 Storage** `triage_results.suspicious_reasons text[]` (codes only, no retention clear). Reader `suspiciousReasonsOf` for E5b and E6a.
- **D6 Effects** behind flag `suspicious_mail`: a warning in the urgent notice and digest (API field for the panel); a flagged `delegation` mail plans nothing. The category never changes.
- **D7** Phishing measurement without LLM (stage 05). **D8** Attachment line, flag `attachment_line` (stage 06).
- **D9 Urgency profile** in `mailbox_settings.urgency_profile` (bumps the settings version); API `PUT /api/settings/:mailboxId/urgency` (owner) and CLI (stage 07). Rejected: own table (one row per mailbox anyway).
- **D10** `ClassifierExtras` (stage 08): `attachments`, `isList`, `senderHistory` (received and corrections only, none for flagged mail), `urgency`; v2 ignores it.
- **D11 Prompt parts** of `classifier-v3`: `attachments` (always, P2), `urgency`, `history`, `list`; eval flags `--prompt-version`, `--prompt-parts`; production has one fixed list (a change is `classifier-v4`).
- **D12** Dev win rule (stage 09). **D13** Holdout ship rule (stage 11): v3 better than v2 by a margin, no proven loss; one holdout run per decision (stages 05, 11, 13).
- **D14 Out of v3** (Q3): folder hint F061 (no folder in the sim case) and the cold-mail reason code (no truth label).
- **D15 Escalation** (stages 12, 14): role `escalation`, prompt `escalation-v1`, an independent second classification that wins; trigger independent of mode (shadow is the ADR 0028 evidence path). **D16** Escalation ship rule (stage 13).
- **D17** Degraded notice: kind `not_triaged`, flag `degraded_notice` (stage 15). **D18** PD-044 send-limit re-check: an offline count of the week part (stage 16). **D19** Logs: codes and counts only.

## Facts checked (2026-11-15, at b9261659)

- F1 Holdout v2: `info → spam` 38 of 243 is the main `spam` precision loss (confusion matrix).
- F2 `email_headers` holds display name, `Reply-To`, topmost `Authentication-Results`, list headers, `Auto-Submitted`, attachments, links `{host, textHost}` (`sync.md` rule 18).
- F3 Sim cases carry `sim.senderHistory`, `sim.urgencyProfile`, `sim.headers` (list headers and `Auto-Submitted` only), attachment names and a display name; no folder, no `Authentication-Results`, no `Reply-To` (scouts 1, 2).
- F4 Dev: 389 cases (57 `urgent`); phishing persona `paliwa-fiota.test` mimics `paliwa-flota.test`.
- F5 Role `escalation` and `LLM_ESCALATION_*` exist; no prompt; no `gpt-6.1-terra` price.
- F6 Run cap $1 (`--budget-usd`), month cap $20. F7 Outbox kinds are a CHECK. F9 The notice job and the triage pause live in one process (`main.ts`).
- F8 `urgencyProfileSchema` exists in core; only sim and eval use it (scout 4).

## Not verified

- N1 Interia adds `Authentication-Results`: no F100 C2 line in `notes/2026-11-13-measured-core-facts.md`. Without it `auth_fail` stays silent. Stage 16 reads the note again.
- N2 `gpt-6.1-terra` price: stage 12 reads the pricing page; else it uses $1.00 / $5.00 (2026-11-13) and says so.

## Done when

1. Stage 05 holdout report against its three targets.
2. Tests of stages 03, 04, 06, 07: flagged delegation mail, warning, attachment line, urgency command.
3. Dev reports and the D13 decision in `evals/results/` (stages 09, 11).
4. Escalation decision (stage 13); stage 14 built or marked skipped.
5. `not_triaged` notice tests (stage 15).
6. Capability pages true for HEAD (stage 16).

## Rules for every stage

- A gap or deviation is a question in the final message, not a choice.
- Format only the stage's files, never the whole repo.
- No address, display name, subject, host, attachment name or mail text in a log line, error text, test name or CLI output.
- Never open `evals/sim/lab-01/holdout/` for prompt work; only stages 05, 11 and 13 run the holdout.
- LLM spend: only stages 09, 11, 13. A run starts only when spend so far plus its `--budget-usd` stays within the stage cap and the month ledger's $20; else stop and report.
- Every query filters `org_id`; new user data joins the DSR export map.

## Proof

One bash call after the last commit, nothing after it.

```
mkdir -p /tmp/f109-sNN && bun run lint > /tmp/f109-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f109-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f109-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f109-sNN/int.log 2>&1 && echo PROOF_OK
```

## Owner steps

| # | Step | When |
| --- | --- | --- |
| O1 | `bun run db:migrate` on the shared dev DB and the VPS | after stage 02 lands |
| O2 | Set `LLM_ESCALATION_MODEL` (and its key) on the VPS | only if stage 14 builds |
| O3 | Turn the new flags on for the pilot | owner's choice |

## Review

Opus review before the land: stages 02, 03, 09, 11, 13, 14, 15. No owner checkpoint; defaults in [questions.md](questions.md).

## Stages

| # | Stage |
| --- | --- |
| 01 | [Suspicious-mail rules (core)](stages/stage-01-suspicious-rules.md) |
| 02 | [Migration](stages/stage-02-migration.md) `[risky]` (migration) |
| 03 | [Rules in triage, no delegation draft](stages/stage-03-suspicious-triage.md) |
| 04 | [Warning in notices, reader](stages/stage-04-suspicious-notices.md) |
| 05 | [Phishing sim measurement](stages/stage-05-suspicious-eval.md) |
| 06 | [Attachment line](stages/stage-06-attachment-line.md) |
| 07 | [Urgency profile command](stages/stage-07-urgency-command.md) |
| 08 | [v3 context and eval flags](stages/stage-08-v3-context.md) |
| 09 | [v3 dev experiments](stages/stage-09-v3-dev.md) `[risky]` |
| 10 | [Real-mail readers for v3](stages/stage-10-v3-readers.md) |
| 11 | [v3 holdout gate and switch](stages/stage-11-v3-gate.md) `[risky]` |
| 12 | [Escalation eval path](stages/stage-12-escalation-eval.md) |
| 13 | [Escalation runs and decision](stages/stage-13-escalation-runs.md) `[risky]` |
| 14 | [Escalation in triage (conditional)](stages/stage-14-escalation-triage.md) `[risky]` |
| 15 | [Degraded-mode notice](stages/stage-15-degraded-notice.md) |
| 16 | [Docs and notes](stages/stage-16-docs.md) |

## How to run (coordinator)

1. Move the ticket to `active/`, commit, then spawn.
2. Lanes: A 01 → 05 → 03 → 04 (03 needs 02). B 02 → 07 → 15. C 06 after 04. D 08 (after 05) → 09 → 10 → 11 → 12 → 13 → 14; 10 needs 03 and 07. 14 runs only if the stage 13 report says "ship"; else mark it skipped in § Log. 16 last.
3. Never two of 03, 10, 14 at once (triage service), nor two of 04, 06, 15 (notice renderers). 02 never next to another migration.
4. Spawn with the standing worker route, `--prepare 'bash scripts/limen-prepare.sh'`, `--timeout 90m`. Stages 09, 11, 13 use the OpenAI key of the copied `.env`. Drop the job DB after the land.

## Planning progress

- Scouts: 4, all returned (`scouts.md`). All 16 stage files written.
- Words (`wc -w`): plan 1498; stages 01–16: 695, 483, 695, 542, 539, 499, 461, 674, 560, 533, 573, 651, 449, 559, 577, 556.

## Cold review

Model `claude-opus-5-5`, thinking high: `[risky]` stages (LLM spend, a production prompt switch) and a migration. Result (`plan-review-1.md`): PASS, 0 blocking, 23 notes; each fixed in its stage (own-domain forgery and the one-persona corpus are stated limits; N6 needs edits outside this folder).

## Log

- 2026-11-15 written; review 1 fixed.
