# F107 — pilot cost measurement (stage 07, M0–M3)

Date: 2026-11-19 (about 19:37 UTC). Read-only on the VPS at `4f1e76df` (release `v0.4.1`).
Pilot organization: the oldest organization (time zone Europe/Warsaw), 1 mailbox. Ids stay out of the repo.

## M1 — `stats:week` per finished week (all mailboxes)

| Week (Monday) | llm_usd_week | llm_calls | unpriced_calls | mailboxes | triaged (m4_handled "of") |
|---|---|---|---|---|---|
| 2026-10-19 | 0.0000 | 0 | 0 | 1 | 6 |
| 2026-10-26 | 0.0000 | 0 | 0 | 1 | 5 |
| 2026-11-02 | 0.0658 | 195 | 0 | 1 | 26 |
| 2026-11-09 | 0.0256 | 81 | 0 | 1 | 50 |

The weeks of 2026-10-19 and 2026-10-26 show triaged mail but 0 LLM calls (no priced LLM rows in those weeks).

## M2 — `triage:cost --days 28` (pilot mailbox, real mail; informational, not in the formula, D10)

| Model | Endpoint | LLM results | Avg tokens in | Avg tokens out | Avg cost per mail |
|---|---|---|---|---|---|
| gemini-3.5-flash-lite | standard | 37 | 1503 | 78 | $0.000646 |
| gpt-6-luna | standard | 181 | 2805 | 61 | $0.000311 |

Rows without a model (blocklist, triage_error, llm_blocked) are not counted by the command.

read-only on the VPS at 4f1e76df
