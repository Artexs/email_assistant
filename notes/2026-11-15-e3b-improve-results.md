# F109 E3b Improve: results (2026-11-15)

A later agent reads this note first. Every number below was copied from the file named next to it, on 2026-11-15, at the state of the F109 branch after stage 15. The capability pages are `docs/capabilities/triage.md`, `digest-and-notices.md`, `retention.md`, `actions-and-undo.md` and `web-panel.md`.

## Summary

- Production prompt: `classifier-v2`. The registry (`apps/server/src/modules/triage/prompts/index.ts`) names it. `classifier-v3[list]` is not shipped: owner decision 42 (the v3 ship question) is open.
- Escalation (a second call by a stronger model) is not built in triage. Stage 13 said "no ship"; stage 14 was skipped.
- The phishing flag `suspicious_mail` stays off (the sim holdout misses the non-phishing flag-rate target by definition). The flags `attachment_line` and `degraded_notice` are built and off by default.

## Stage 05: suspicious-mail rules on the sim, no LLM

Source: `evals/results/2026-11-15-sim-lab-01-holdout-suspicious.md` (holdout, 1413 cases), `evals/results/2026-11-15-sim-lab-01-dev-suspicious.md` (dev, 389 cases), `evals/results/2026-11-15-sim-lab-01-week-suspicious.md` (week, 840 cases). Targets (default, owner to confirm): phishing recall at least 90%, 0 whitelisted cases flagged, non-phishing flag rate at most 2%.

| target                         | holdout                       | dev                      | week                     |
| ------------------------------ | ----------------------------- | ------------------------ | ------------------------ |
| phishing recall (>= 90%)       | 21 of 21 (100.0%), met        | 9 of 9 (100.0%), met     | 15 of 15 (100.0%), met   |
| whitelisted cases flagged (0)  | 0 of 315, met                 | 0 of 77, met             | 0 of 102, met            |
| non-phishing flag rate (<= 2%) | 67 of 1392 (4.8%), **missed** | 13 of 380 (3.4%), missed | 43 of 825 (5.2%), missed |

- All flagged non-phishing cases come from the phishing persona (holdout: 67 of 67; 0 of 1325 cases of other senders). The sim has one phishing persona with one look-alike domain, so the recall number tests mainly `lookalike_domain`. The reason tables show 0 cases for `auth_fail`, `display_name_spoof`, `reply_to_mismatch`, `link_mismatch` and `risky_attachment` on the sim.
- Owner decision "Phishing flag stays off" (`docs/owner-decisions.md`, 2026-11-15, F109): the flag stays off for the pilot until real mail shows the rate.

## Stage 09: `classifier-v3` dev experiments

Source: `evals/results/2026-11-15-f109-v3-dev-summary.md` (dev set, `gpt-6-luna`, effort `none`).

`Chosen parts: [list]`. Spend $0.7808 of the stage cap $2.00 (10 runs). Run noise `s` = 2; win margin 20. `K` = key misses (urgent false negatives + `needs_reply` mail hidden + `spam` false positives).

| variant                       | runs         | K          | verdict                                                                 |
| ----------------------------- | ------------ | ---------- | ----------------------------------------------------------------------- |
| `classifier-v2`               | R1a, R1b     | 23, 23     | baseline                                                                |
| v3 `attachments` only         | R2a, R2b     | 25, 23     | not worse than v2                                                       |
| v3 `urgency`                  | R3           | 15         | loses (`urgent` false positives +11; `needs_reply` true positives −7.5) |
| v3 `urgency` (rewritten rule) | R3 rewrite   | 17         | loses; no second rewrite allowed                                        |
| v3 `history`                  | R4           | 27         | loses (K above the baseline; injection 14 of 17)                        |
| v3 `list`                     | R5, R6a, R6b | 14, 12, 16 | wins                                                                    |

The summary says R3 cannot be reproduced at HEAD (the `urgency` rule text changed after the run). It keeps one open question on injection (the `list` mean 15.7 against 16.5 for R2).

## Stage 11: v3 holdout gate

Source: `evals/results/2026-11-15-f109-v3-dev-summary.md` (section "Stage 11 decision"), reports `evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v2.md` and `evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v3.md`.

**Decision: no ship (rule 4 fails).** One holdout run of `classifier-v3[list]`, 1412 of 1413 cases done, exit code 1. Whitelist rule: 314 of 314 counted plus 1 `bad_output` error on case `h-rli-01` = 314 of 315 (an errored case counts as not correct). The other four rules pass:

| rule                                         | v2                                                      | v3                                                     |
| -------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| no proven precision loss                     | `spam` precision 80.3–88.8                              | `spam` precision 97.6–99.9; pass in all six categories |
| `K`                                          | 74 (urgent FN 31, hidden `needs_reply` 2, `spam` FP 41) | 34 (32 + 1 + 1); limit 70                              |
| `urgent` / `needs_reply` false-negative rate | 14.1%, 6.2%                                             | 14.5%, 6.9%                                            |
| injection (at least 29 of 31)                | 29 of 31                                                | 29 of 31 (at the limit)                                |
| cost per mailbox per month (at most $2.00)   | $1.148                                                  | $1.187                                                 |

- Spend $0.2797 of the stage cap $0.60. The gate file `evals/results/gate/classifier-classifier-v3-gpt-6-luna-none-lab-01-v1.json` is committed.
- Production prompt: `classifier-v2` (`prompts.classifier` in `prompts/index.ts`). `CLASSIFIER_V3_PARTS` is `["attachments"]` and has no effect while the pointer is v2.
- Owner decision 42, "F109 v3 prompt holdout: no ship by the rule" (`docs/owner-decisions.md`): **open**. The owner may accept the single `bad_output` as noise.
- How to switch (one line, do not do it without the owner): in `apps/server/src/modules/triage/prompts/index.ts` point `prompts.classifier` at the `classifier-v3` entry and set `CLASSIFIER_V3_PARTS` to `["list"]`; no new run is needed if the owner accepts the existing run. Rollback rule: `docs/capabilities/triage.md`.

## Stage 13: escalation cascade

Source: `evals/results/2026-11-15-f109-escalation-summary.md`.

**Decision: no ship** (dev rule 5 fails; no holdout run). Base `classifier-v2` on `gpt-6-luna`; second call `escalation-v1` on `gpt-6.1-terra`; two dev runs of 389 cases.

| value            | run 1 first | run 1 cascade | run 2 first | run 2 cascade |
| ---------------- | ----------- | ------------- | ----------- | ------------- |
| `K`              | 22          | 20            | 25          | 25            |
| `spam` precision | 84.7%       | 85.7%         | 87.1%       | 87.0%         |

- Triggered share 24.5% and 24.2%. Rules 1 to 4 pass.
- Rule 5 (cascade cost per mailbox per month at most $3.00): **$3.98 and $3.95 (mean $3.96): fail**.
- Owner decision "F109 escalation cascade: no ship by the cost rule" (`docs/owner-decisions.md`): a cheaper trigger or a cheaper second model needs a new trigger version and a new decision.
- Stage 14 (escalation in triage) is skipped. What stays in the code: the role `escalation` (`LLM_ESCALATION_*`), the prompt `escalation-v1`, the pure trigger `shouldEscalate` in `packages/core/src/triage/escalation.ts` and the eval flag `--escalate`.

## Spend (stages 09, 11, 13)

| stage | spend   | cap   |
| ----- | ------- | ----- |
| 09    | $0.7808 | $2.00 |
| 11    | $0.2797 | $0.60 |
| 13    | $0.5171 | $2.50 |
| total | $1.5776 |       |

The month ledger (the escalation summary): $0.3655 before stage 09 and $1.9430 after stage 13 (difference $1.5775, rounding). The month cap is $20.

## N1: does Interia add `Authentication-Results`?

`notes/2026-11-13-measured-core-facts.md` still says "Not checked yet" for the header, and no F100 pilot probe (C2) line was added. **N1 still open.** `auth_fail` is silent on the pilot until a trusted `Authentication-Results` header is seen. If the header exists, the operator sets the `authserv-id` of Interia in `MAIL_TRUSTED_AUTHSERV_IDS` (the registrable domain of the IMAP host is trusted without the key).

## Send-limit re-check (PD-044, PD-068, D18)

Method: a throwaway script (not committed) read `evals/sim/lab-01/week/slots/` (35 batch files, 56 slots with `category` `delegation`; the slot `category` is the truth) and counted, by `receivedAt`, the delegation mails per rolling hour, per rolling 24 h and per `expectedDelegate` per rolling 24 h. Each such mail is one delegation send after approval. The week spans 6.57 days. Output: `/tmp/f109-s16/sendcount.txt`.

| limit (env key, default)                                      | maximum in the simulated week                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| 20 per mailbox per rolling hour (`SEND_LIMIT_MAILBOX_HOUR`)   | 3                                                                   |
| 100 per mailbox per rolling 24 h (`SEND_LIMIT_MAILBOX_DAY`)   | 13                                                                  |
| 5 per recipient per rolling 24 h (`SEND_LIMIT_RECIPIENT_DAY`) | 10 (delegate `asystentka`; `ksiegowa` 9, `koordynator-sprzedazy` 3) |

**Would hold sends: `recipient_day`.** The hourly and the daily mailbox limits fit. The per-recipient limit holds delegation sends to the delegates `asystentka` and `ksiegowa`: a send over the limit goes back to `approved` with `last_error` `send_limit:recipient_day` and waits until the window moves; the owner gets the notice `send_held` and the operator the notice `send_limit` (`drafts-and-send.md` rule on the send limits). Limits: the count assumes every delegation mail is approved and sent at its `receivedAt` and counts delegation sends only (no reply, clarification or reminder sends). No limit changed in F109. Question for the owner: raise `SEND_LIMIT_RECIPIENT_DAY` for delegates (or count delegate recipients apart), or accept the wait.

Update (F130, 2026-11-18): the role `escalation`, `LLM_ESCALATION_*`, the prompt `escalation-v1`, `shouldEscalate` and the eval flag `--escalate` are removed from the code. The line above about what stays in the code is history. See `notes/2026-11-18-f130-escalation-removal.md`.
