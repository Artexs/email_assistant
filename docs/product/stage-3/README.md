# Stage 3 — open questions (collected, not planned)

Stage 2 is "sell-ready, not sold" (PD-001): no billing, no real customer. Stage 3 starts selling. This page collects the questions that a Stage 3 discovery session must answer. Nothing here is decided.

## 1. Plans, tiers and pricing (owner, 2026-11-14)

The owner asked: which features, limits and usage should differ between subscription tiers, and how to price them?

What the system has today that a tier could change (all global or per organization, none per tier yet):

| Lever                                    | Today                                                                                                                                                                                                                                                                     | Where                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Plan state                               | `trial`, `active`, `suspended`; trial 30 days by default                                                                                                                                                                                                                  | `organizations.plan`, `bun run org:plan` (`docs/capabilities/tenancy-and-plans.md`) |
| Mailboxes per organization               | `--max-mailboxes N` per organization                                                                                                                                                                                                                                      | same                                                                                |
| Send limits                              | 20 per mailbox per hour, 100 per day, 5 per recipient per day; global env keys `SEND_LIMIT_*`. They are a **safety cap** against a bug that sends in a loop (a provider can suspend a mailbox for a burst), not a usage limit (PD-044, `epics/E07-discovery-notes.md` §5) | F099                                                                                |
| LLM calls                                | one daily cap for the server (`LLM_DAILY_CAP`); role shares per model (F090)                                                                                                                                                                                              | `platform/config`                                                                   |
| Features                                 | flags per organization (`org_features`, ADR 0027); today for rollout, not for tiers                                                                                                                                                                                       | F087                                                                                |
| Retention                                | `data_retention_days` per organization                                                                                                                                                                                                                                    | `docs/capabilities/retention.md`                                                    |
| Identity                                 | TOTP (E7-T6), SSO/OIDC (E7-T7)                                                                                                                                                                                                                                            | Stage 2 tickets F105, F119                                                          |
| Private model option                     | EU provider, zero data retention (E11b)                                                                                                                                                                                                                                   | F111                                                                                |
| Reply drafts, open loops, sender context | Stage 2 epics E6, E5, E11                                                                                                                                                                                                                                                 | F115, F116, F120                                                                    |

Questions:

1. Which tiers (for example solo executive, executive with an assistant, team), and what is the price unit: per user, per mailbox, per organization?
2. Which features are tier-only (for example SSO, private model, reply drafts, longer retention)?
3. Which usage counts against a tier: mail processed per month, LLM calls, mailboxes, delegates, sends? Send limits stay a safety cap for every tier; only a per-tier raise of the cap is a pricing question.
4. What does a tier change need in code: a plan-to-limits table per organization in place of global env keys, and flags that follow the plan?
5. Billing: provider, invoices, VAT in the EU, trial end, what happens to data at cancel (the DSR and delete flows of E7-T3 exist).
6. What does the LLM cost per user per month (E3a measures it; `notes/2026-11-13-measured-core-facts.md`), and what margin does each tier need?

## 2. Other Stage 3 candidates already named

- Assistant agent with voice in Telegram and the mobile app: `docs/product/stage-2/02-inventory-and-roadmap.md` §14.
- The EA (assistant) role with its own flow and review: `docs/product/stage-2/03-product-frame.md` and `04-review-result.md` R8.
- Calendar and meetings, native mobile app: `03-product-frame.md` non-goals.

## 3. Support and help agent (owner, 2026-11-16)

Status: wishlist. Needs a product decision and a planning session before any ticket.

Problem: the owner does not know if the product has a support contact, documentation or tutorials. A user has no place to ask "how does this work?".

Idea:

1. A pipeline gathers documentation from the codebase (`docs/capabilities/`, `docs/product-brief.md`, ADRs, UI text) into one help corpus. It rebuilds when the code or docs change.
2. One help agent runs in the background. It reads only that corpus and answers user questions.
3. The same agent serves every surface: the web app, the website, and Telegram (text messages and voice notes).

Questions for the planning session:

- Which docs are user-facing, and which stay internal? The corpus must not leak internal decisions, secrets or other organizations' data.
- Retrieval method: full-text search, embeddings, or the docs in the model context (the corpus may be small enough).
- What happens when the agent does not know? Options: a support contact, a ticket, or a hand-off to the owner.
- Voice notes: reuse the voice path of the assistant agent (§2, first item).
- Cost and limits: does a help question count against `LLM_DAILY_CAP` or a tier (§1)?
- Language: the answer follows the language of the question.
- Does the web app also need static tutorials and a support contact page, apart from the agent?

Related: §2 (assistant agent with voice), `docs/capabilities/`.
