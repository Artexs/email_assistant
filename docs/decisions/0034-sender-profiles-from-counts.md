# 0034 — Sender profiles hold counts under a keyed hash, never mail text

- Status: proposed (E11 discovery, 2026-11-13; `docs/product/stage-2/epics/E11-contacts-and-context.md` § Discovery)
- Date: 2026-11-13

## Context

E11 wants the system to know who a sender is to the user: for urgent mail (M1), for suggestions (VIP, whitelist, blocklist), for the phishing "known domains" list (E3b, PD-063) and for the follow-up wait per contact (E5). The old mental model (`.ai/architecture/mental_model/mental_model_v2.md`) keyed a `contacts` table by the plain address, with a trust score, LLM-written competence summaries and few-shot mail pairs.

Today the system keeps no data per sender beyond the rules and delegates the user made. Addresses on `emails` are cleared after 90 days (architecture §7). A table keyed by the plain address would keep the address of every person who ever wrote to the user, for as long as the table lives. These people are not users and never agreed to anything. E3 already ruled out text of other mails in a prompt (PD-062).

## Decision

1. **One table, `sender_profiles`, per mailbox and sender, and per mailbox and sender domain.** The key is `HMAC-SHA256(org secret, normalized address or domain)`. The plain address is not a column. A view joins it from `emails` (inside its retention), `sender_rules` or `delegates` when the user must see it.
2. **Counts and dates only.** Received mail per category, corrections per true category, moved back, answered, flagged, never seen after 7 days, user mails to the sender (from the read-only Sent sync, ADR 0029 draft), median reply delays, delegations, bulk signals, first and last seen. No subject, body, name, display name, summary or LLM output.
3. **No LLM builds or reads it as text.** A relation class (`delegate`, `vip`, `bulk`, `known`, `new`) comes from code. The classifier may get one line with counts, and only if the E2a holdout shows a gain over the E3b hint (PD-061, PD-062).
4. **Suggestions only.** The profile never changes a rule, a category or `auto` by itself. Suggestions need a tap (Accept creates the rule through the existing command) and show their counts as the reason.
5. **Retention and rights.** A profile with no mail for 12 months is deleted by the retention job. The DSR erase (PD-038) hashes the given address and deletes the rows; the DSR address map test lists the table. Export gives the org owner the rows with the joined address. Mailbox and organization delete remove them.
6. E3b may build the minimal form of this table for its sender-history hint (counts from `triage_results` and `triage_feedback`); E11a extends it. There is one table, not two.

## Consequences

- The system learns "who matters" from behaviour without storing more personal text.
- The hash limits what a dump or an export shows. It is still personal data (pseudonymised, GDPR Art. 4(5)); the records of processing (S6e) list it.
- The org secret becomes one more key to keep. If it is lost or rotated, the profiles are rebuilt from the 30-day pass of the history check (ADR 0028) and new mail; nothing is lost that cannot be derived again.
- `docs/architecture.md` §5 (data model) and §7 (retention table) get the new table when E11a lands.
