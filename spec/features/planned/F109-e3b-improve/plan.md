> **Status 2026-11-15 — planned.** Plan base: b9261659. 16 stages; nothing built.

# F109 · E3b Improve — plan

## Input

Coordinator (2026-11-15): "Its need F097 (the offline lab) is closed: read its results (… urgent, needs_reply and spam are no-go on the first holdout run; info and notification go; gate file provisional until the owner audit; the sim-vs-real gap report shows no gap for notification and spam) … Mark risky stages [risky] (LLM spend, prompts that change production behaviour). Real LLM spend: the owner approved runs under the stage caps of the lab ( per run); a stage that needs more states the cap."

Product (owner, "in default values", 2026-11-13; `docs/product/stage-2/decisions.md`):

- **P1 PD-063** Suspicious-mail rules in code; the flag warns, never moves, never overrides whitelist or VIP; flagged mail gets no delegation, reply or follow-up draft and no unsubscribe.
- **P2 PD-064** Attachment name, type and size go into the prompt (untrusted) and the summary line; never the content or the file.
- **P3 PD-061** Each work-list item is a `classifier-v3` experiment on the dev set; only what wins and passes the holdout ships.
- **P4 PD-062** Sender history is counts only; no text of other mail in a prompt.
- **P5 PD-060** A stronger model checks a mail only before a hide of a person's mail or on `unsure`; no user setting; built only if it closes the gap on the dev set.
- **P6 PD-067** During an LLM pause, VIP and whitelisted mail gets "not triaged yet" (sender only).
- **P7 PD-017** Urgency profile shape from E2a (`urgencyProfileSchema`); E3b stores it and adds the command; E4-B builds the editor.
- **P8 PD-045, PD-068** New user-visible behaviour ships behind a flag, default off. **P9 PD-030** Labels never unlock `auto`.
- **P10 Second pass (default, owner to confirm, Q1).** Holdout: `urgent` false-negative rate 14.1%, `needs_reply` 6.2%, M1 target < 2% (`03-product-frame.md` §5). So the PD-060 condition holds: the escalation experiment is built (stages 12–13); stage 14 only on "ship".

Design (detail in the stage files):

- **D1 Rules** `assessSuspicious` in `packages/core/src/triage/suspicious.ts` (stage 01): six reason codes `auth_fail`, `lookalike_domain`, `display_name_spoof`, `reply_to_mismatch`, `link_mismatch`, `risky_attachment`. A known sender gets only `auth_fail` and `risky_attachment`. Rejected: an LLM phishing judgement (cost, injection surface).
- **D2 Trusted `Authentication-Results`** only when its `authserv-id` matches the registrable domain of the mailbox IMAP host or an entry of `MAIL_TRUSTED_AUTHSERV_IDS` (Q2). Rejected: trusting any topmost header (a sender can write one when the receiving host adds none).
- **D3 Registrable domain** from a built-in list of two-level suffixes. Rejected: a public-suffix library (new dependency, data upkeep).
- **D4 Known sender** (stage 03): own mailbox addresses, delegates, whitelist and VIP rules, and senders with ≥ 3 mails in 90 days whose latest category is not `spam`. Free-mail domains never make a sender known by domain.
- **D5 Storage** `triage_results.suspicious_reasons text[]` (codes only, no retention clear). Reader `suspiciousReasonsOf` for E5b and E6a.
- **D6 Effects** behind flag `suspicious_mail`: warning line in the urgent notice, digest and activity row; a flagged `delegation` mail plans no actions. The category never changes.
- **D7 Phishing measurement** without LLM on dev and holdout (stage 05); targets in the stage.
- **D8 Attachment line** behind flag `attachment_line` (stage 06).
- **D9 Urgency profile** in `mailbox_settings.urgency_profile jsonb` (bumps the settings version), API `PUT /api/settings/:mailboxId/urgency` (owner) and CLI (stage 07). Rejected: own table (one row per mailbox anyway).
- **D10 Classifier context** `ClassifierExtras` (stage 08): `attachments`, `isList`, `senderHistory`, `urgency`. v2 ignores it.
- **D11 Prompt parts** of `classifier-v3`: `attachments` (always, P2), `urgency`, `history`, `list`. Eval flags `--prompt-version`, `--prompt-parts`. Production uses one fixed part list; a later change is `classifier-v4`.
- **D12 Dev win rule** (stage 09). **D13 Holdout ship rule** (stage 11): no regression against v2; at most 2 holdout runs.
- **D14 Out of v3** (Q3): folder hint F061 (no folder in the sim case) and the cold-mail reason code (no truth label).
- **D15 Escalation** (stages 12, 14): role `escalation`, prompt `escalation-v1`, independent second classification that wins; trigger independent of mode, because shadow mode is the evidence path of ADR 0028. **D16** Escalation ship rule (stage 13).
- **D17 Degraded notice** kind `not_triaged`, flag `degraded_notice` (stage 15).
- **D18 PD-044 send-limit re-check** as an offline count of the week part (stage 16, a note; no code).
- **D19 Logs**: codes and counts only.

## Facts checked (2026-11-15, at b9261659)

- F1 Holdout v2 numbers above, and `info → spam` 38 of 243 is the main `spam` precision loss (holdout report, confusion matrix).
- F2 `email_headers` holds `from_name`, `reply_to`, `auth_results` (topmost), `list_unsubscribe`, `list_id`, `auto_submitted`, `attachments`, `links {host, textHost}`; retention clears the texts (`sync.md` rule 18, scout 2).
- F3 Sim cases carry `sim.senderHistory`, `sim.urgencyProfile`, `sim.headers` (`List-Unsubscribe`, `List-Id`, `Auto-Submitted` only), `sim.attachments` (names only), a `From` with display name; no folder, no `Authentication-Results`, no `Reply-To` (scouts 1, 2; `to-eval-case.ts`).
- F4 Dev part: 389 cases (57 `urgent`); phishing persona `billing@paliwa-fiota.test` mimics vendor `paliwa-flota.test` (`scenario.json`).
- F5 Role `escalation` and `LLM_ESCALATION_*` config exist; no prompt; `gpt-6.1-terra` has no price in `llmPrices` (scout 1).
- F6 Run cap $1 (`--budget-usd`), month cap $20 (scout 1). F7 Outbox kinds are a CHECK constraint (migration `20261114140001`).
- F8 `urgencyProfileSchema` exists in core, used only by sim and eval (scout 4).

## Not verified

- N1 Interia adds `Authentication-Results`: the F100 C2 run left no line in `notes/2026-11-13-measured-core-facts.md`. Without it `auth_fail` stays silent (D2). Stage 16 reads the note again.
- N2 `gpt-6.1-terra` price: stage 12 reads the pricing page; else it uses $1.00 / $5.00 (2026-11-13) and says so.

## Done when

1. Stage 05 report: phishing recall ≥ 90%, 0 whitelisted flags, non-phishing flag rate ≤ 2% on the holdout, or the stage 05 stop report.
2. Flagged `delegation` mail: no draft, warning shown (stage 03, 04 tests).
3. Attachment line in notices (stage 06 tests).
4. Urgency command round trip by API and CLI (stage 07 tests).
5. Dev reports per part and the D13 holdout decision committed in `evals/results/` (stages 09, 11).
6. Escalation decision report (stage 13); stage 14 built or marked skipped.
7. `not_triaged` notice (stage 15 tests).
8. Capability pages true for HEAD (stage 16).

## Rules for every stage

- A gap or a deviation from a decision is a question in the final message, not a choice.
- Format and lint only the stage's files. Never the repo-wide formatter.
- No address, display name, subject, host, attachment name or mail text in a log line, error text, test name or CLI output. Reports print counts and codes.
- Never open `evals/sim/lab-01/holdout/` for prompt work; only stages 05, 11 and 13 run the holdout.
- LLM spend: only stages 09, 11, 13. Each run passes `--budget-usd`; read the month ledger first; if the stage cap or the month cap would pass, stop and report.
- Every query filters `org_id`. New user data goes into the DSR export map (`modules/privacy/export-map.ts`).
- Fixtures: `test/fixtures` mail builders of F100 (capture); a stage that needs a new builder adds it.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. List as proven only what a saved log shows.

```
mkdir -p /tmp/f109-sNN && bun run lint > /tmp/f109-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f109-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f109-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f109-sNN/int.log 2>&1 && echo PROOF_OK
```

## Owner checkpoints

None stop the build. Defaults: [questions.md](questions.md).

## Owner steps

| # | Step | When |
| --- | --- | --- |
| O1 | `bun run db:migrate` on the shared dev DB and the VPS | after stage 02 lands |
| O2 | Set `LLM_ESCALATION_MODEL` (and its key) on the VPS | only if stage 14 builds |
| O3 | Turn the flags on for the pilot organization | when the owner wants the behaviour |

## Review

Review job before the land (model `claude-opus-5-5`): stages 02, 03, 09, 11, 13, 14, 15. Others land on the worker's proof.

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

1. Move the ticket to `active/` and commit before the first spawn.
2. Lanes: A 01 → 03 → 04 → 05 (03 needs 02). B 02 → 07 → 15. C 06 after 04 (same notice files). D 08 → 09 → 10 → 11 → 12 → 13 → 14. 08 may start at once; 10 needs 02 and 07. 14 runs only if the stage 13 report says "ship"; else mark it skipped in § Log. 16 last.
3. Never two of 03, 10, 14 at once (all edit `triage/service.ts`). Never two of 04, 06, 15 at once (notice renderers). 02 never next to another ticket's migration.
4. Spawn per stage with the standing worker route, `--prepare 'bash scripts/limen-prepare.sh'`, `--timeout 90m`. Stages 09, 11, 13 need the OpenAI key in the job `.env` (the prepare script copies it). Drop the job DB after the land.

## Planning progress

- Scouts: 4 (all returned; `scouts.md`). Stage files: see § Stages; counts below.

## Cold review

Not run yet.

## Log

- 2026-11-15 plan written.
