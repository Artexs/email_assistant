# Suspicious-mail rules: sim lab-01 week

- date: 2026-11-15
- rules: assessSuspicious (packages/core/src/triage/suspicious.ts); no LLM call, no spend
- corpus: lab-01 v1 (week), manifest bc4fc25c86d3, owner audit: pending
- cases: 840
- known senders (sim stand-in): the company domain, delegates, the case's VIP and whitelist rules, and personas of the groups team, delegate, client, vendor, boss, partner
- trusted authserv-ids: none (lab-01 has no Authentication-Results header; `auth_fail` stays at 0)
- ids listed: no (counts only)

## Targets (default, owner to confirm)

| target | limit | result | status |
| --- | --- | --- | --- |
| phishing recall | >= 90% | 15 of 15 (100.0%) | met |
| whitelisted cases flagged | 0 | 0 of 102 | met |
| non-phishing flag rate | <= 2% | 43 of 825 (5.2%) | missed |

Secondary view (not a target): the cases flagged without a `phishing_*` tag may come from a phishing persona. The rules flag them for the right reason.

| view | flagged | total |
| --- | --- | --- |
| non-phishing cases flagged, sender is a phishing persona | 43 | 43 |
| non-phishing cases flagged, sender is not a phishing persona (rate 0.0%) | 0 | 782 |

## Phishing cases per tag

| tag | flagged | total |
| --- | --- | --- |
| phishing_delegation | 5 | 5 |
| phishing_unsubscribe | 5 | 5 |
| phishing_urgent_push | 5 | 5 |
| all phishing cases | 15 | 15 |

## Non-phishing cases flagged, by truth category

| truth category | flagged | total |
| --- | --- | --- |
| delegation | 0 | 56 |
| info | 0 | 173 |
| needs_reply | 0 | 113 |
| notification | 0 | 293 |
| spam | 43 | 151 |
| urgent | 0 | 39 |

## Reason codes

| reason | cases (all) | phishing cases | other cases |
| --- | --- | --- | --- |
| auth_fail | 0 | 0 | 0 |
| lookalike_domain | 58 | 15 | 43 |
| display_name_spoof | 0 | 0 | 0 |
| reply_to_mismatch | 0 | 0 | 0 |
| link_mismatch | 0 | 0 | 0 |
| risky_attachment | 0 | 0 | 0 |

## What these numbers show

- All lab-01 phishing comes from one persona with one look-alike domain. The recall number tests mainly `lookalike_domain` on that domain. It says little about display-name, Reply-To, link or auth rules, and it does not show recall on other phishing.
- The sim has no `Authentication-Results`, no `Reply-To` and no HTML links. Those rules stay at 0 here. The non-phishing flag rate does not cover marketing mail with tracking links.
- Known senders differ from production. The sim uses persona groups. Production also counts frequent senders (3 clean mails in 90 days), and a phisher can reach that state.
