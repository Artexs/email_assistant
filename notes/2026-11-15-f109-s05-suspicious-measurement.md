# F109 stage 05: suspicious-rule measurement on lab-01 (no LLM)

Command: `bun run eval --sim lab-01 --part dev|holdout|week --suspicious [--out <file.md>]`. Code: `apps/server/src/scripts/eval-suspicious.ts`. Reports: `evals/results/2026-11-15-sim-lab-01-{dev,holdout,week}-suspicious.md`.

## Numbers (rules of stage 01, unchanged: 1 dev round, 1 holdout run, 1 week run)

| part | phishing recall (tag `phishing_*`) | whitelisted flagged | non-phishing flag rate (as written) | same, sender not a phishing persona |
| --- | --- | --- | --- | --- |
| dev | 9 of 9 | 0 of 77 | 13 of 380 (3.4%) | 0 of 367 |
| holdout | 21 of 21 | 0 of 315 | 67 of 1392 (4.8%) | 0 of 1325 |
| week | 15 of 15 | 0 of 102 | 43 of 825 (5.2%) | 0 of 782 |

## Why the written rate target misses

- The written definition: "phishing" = a case with a `phishing_*` hard-case tag. Target for others: rate <= 2%.
- All lab-01 phishing-persona mail (`billing@paliwa-fiota.test`) is look-alike mail. Only some of it has a `phishing_*` tag. The rest are plain `spam` slots from the same persona (no tag).
- Every flagged non-phishing case (13 dev, 67 holdout, 43 week) is from that persona. Every flag is `lookalike_domain`. No case from another sender is flagged.
- No rule change fixes this: the flags are right. The cause is the tag-based definition of "phishing", not a rule. I did not change the definition or the rules. The report prints the written number as the target row and the persona view as a secondary table.
- Decision for the coordinator or owner (target Q4 is "owner to confirm"): define "phishing" by sender persona group, or keep the tag. By persona group the holdout numbers would be recall 88 of 88, others 0 of 1325.

## What the numbers do and do not show (review N17, N18)

- One phishing persona with one look-alike domain: recall mostly tests `lookalike_domain` on that domain. `auth_fail`, `display_name_spoof`, `reply_to_mismatch`, `link_mismatch` and `risky_attachment` stay at 0 in lab-01 (no `Authentication-Results`, no `Reply-To`, no HTML links, no risky attachments). Recall on other phishing is not shown.
- The non-phishing rate does not cover marketing mail with tracking links (the sim has no such links).

## Known-sender difference (review N1)

- Production (stage 03): known = mailbox addresses, delegates, exact whitelist and VIP rules, plus frequent senders (3 clean mails in 90 days).
- Sim: known = company domain, delegates, the case's VIP and whitelist rules, and personas of the groups team, delegate, client, vendor, boss, partner. No frequency rule.
- So the sim does not show that a phisher can become "known" by frequency in production.

## Holdout discipline (review N7)

One holdout run for this decision. No rule change after it. Dev round count: 1 (no change needed to the rules).
