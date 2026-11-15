# Suspicious-mail rules: sim lab-01 dev

- date: 2026-11-15
- rules: assessSuspicious (packages/core/src/triage/suspicious.ts); no LLM call, no spend
- corpus: lab-01 v1 (dev), manifest bc4fc25c86d3, owner audit: pending
- cases: 389
- known senders (sim stand-in): the company domain, delegates, the case's VIP and whitelist rules, and personas of the groups team, delegate, client, vendor, boss, partner
- trusted authserv-ids: none (lab-01 has no Authentication-Results header; `auth_fail` stays at 0)
- ids listed: yes (dev)

## Targets (default, owner to confirm)

| target | limit | result | status |
| --- | --- | --- | --- |
| phishing recall | >= 90% | 9 of 9 (100.0%) | met |
| whitelisted cases flagged | 0 | 0 of 77 | met |
| non-phishing flag rate | <= 2% | 13 of 380 (3.4%) | missed |

Secondary view (not a target): the cases flagged without a `phishing_*` tag may come from a phishing persona. The rules flag them for the right reason.

| view | flagged | total |
| --- | --- | --- |
| non-phishing cases flagged, sender is a phishing persona | 13 | 13 |
| non-phishing cases flagged, sender is not a phishing persona (rate 0.0%) | 0 | 367 |

## Phishing cases per tag

| tag | flagged | total |
| --- | --- | --- |
| phishing_delegation | 3 | 3 |
| phishing_unsubscribe | 3 | 3 |
| phishing_urgent_push | 3 | 3 |
| all phishing cases | 9 | 9 |

## Non-phishing cases flagged, by truth category

| truth category | flagged | total |
| --- | --- | --- |
| delegation | 0 | 59 |
| info | 0 | 67 |
| needs_reply | 0 | 81 |
| notification | 0 | 63 |
| spam | 13 | 53 |
| urgent | 0 | 57 |

## Reason codes

| reason | cases (all) | phishing cases | other cases |
| --- | --- | --- | --- |
| auth_fail | 0 | 0 | 0 |
| lookalike_domain | 22 | 9 | 13 |
| display_name_spoof | 0 | 0 | 0 |
| reply_to_mismatch | 0 | 0 | 0 |
| link_mismatch | 0 | 0 | 0 |
| risky_attachment | 0 | 0 | 0 |

## Phishing cases not flagged (dev ids)

- none

## Non-phishing cases flagged (dev ids)

- b-spa-0005 (spam): lookalike_domain
- b-spa-0008 (spam): lookalike_domain
- b-spa-0023 (spam): lookalike_domain
- b-spa-0054 (spam): lookalike_domain
- b-spa-0055 (spam): lookalike_domain
- b-spa-0077 (spam): lookalike_domain
- b-spa-0083 (spam): lookalike_domain
- b-spa-0125 (spam): lookalike_domain
- b-spa-0153 (spam): lookalike_domain
- b-spa-0161 (spam): lookalike_domain
- b-spa-0166 (spam): lookalike_domain
- b-spa-0171 (spam): lookalike_domain
- b-spa-0197 (spam): lookalike_domain

## Whitelisted cases flagged (dev ids)

- none

## What these numbers show

- All lab-01 phishing comes from one persona with one look-alike domain. The recall number tests mainly `lookalike_domain` on that domain. It says little about display-name, Reply-To, link or auth rules, and it does not show recall on other phishing.
- The sim has no `Authentication-Results`, no `Reply-To` and no HTML links. Those rules stay at 0 here. The non-phishing flag rate does not cover marketing mail with tracking links.
- Known senders differ from production. The sim uses persona groups. Production also counts frequent senders (3 clean mails in 90 days), and a phisher can reach that state.
