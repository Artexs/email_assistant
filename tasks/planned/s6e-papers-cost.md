> **Status 2026-11-12 — planned.** Left: the detailed stage plan (an own `plan-task` session), then the build with `run-task`, then the lawyer review (user step U6).

# S6e Papers and cost model

Scope: the S6 master plan `tasks/active/s6-pre-sale.md` (P3, P11, P13, D18–D20, D27, D28 (ADR 0020), "Rules for every step"). Needs: S6c merged and S6d done (the texts state their facts), U1 (domain), U8 (B2 lifecycle and region), U9 (operator contact).
Git mode: worktree (`task/s6e-papers-cost`). Run mode: pipeline. Review model: Sonnet, high, plus a cross-check stage (below).

## Goal

A customer can read, before the first password, what the service does with their mail, who processes it, how long it is kept and how to delete it; the user knows the cost per mailbox and sets a price.

## Done when

- The stub pages of S6b (`/legal/{pl,en}/{privacy,terms,dpa}`) hold the texts, linked from `/login`, `/setup` and the Account card (Playwright: each page opens without a session and no redirect happens).
- The texts state every item of D19 and the sub-processors of D27; a cross-check stage compares each claim with the code and the docs (retention periods, delete, export, LLM terms, Telegram content) and lists each claim with its source line.
- `TERMS_VERSION` (S6b, `packages/core`) changes with the texts; the S6b dialog appears for a user with the old version (existing test).
- The texts state the Telegram content and the U0 answer, the restore test on a short-lived VM (D24), the backup period (U8) and the operator notices (ids only, D31).
- The texts carry a "draft" line until the lawyer review is logged here (U6); the user removes it after the review (one commit).
- `docs/cost-model.md` follows D20 with real numbers and their dates; the user writes the price (U7).
- ADR 0020 (customer accounts: invite, plan state, consent by mode, deletion) is accepted; `docs/product-brief.md` and `docs/roadmap.md` point to the papers.

## Owns (from the master plan)

- Decisions D18 (texts in the S6b pages; the version bump), D19 (content), D20 (cost model), D27 (sub-processor list in the texts), D28 (ADR 0020).
- Files (expected): `apps/web/src/content/legal/{pl,en}/{privacy,terms,dpa}.md` (S6b made stubs), `packages/core` (`TERMS_VERSION` bump), links in the login, setup and Account components, `docs/cost-model.md`, `docs/decisions/0020-*.md`.

## Stage sketch

1. **Links and frame check**: the links in the login, setup and Account components; the CSP check (no inline script); Playwright without a session.
2. **Privacy policy** (pl, en): controller and processor roles, data, purposes, periods, sub-processors, transfers (Telegram, the US parents of Google and Backblaze), rights and how to use them, contact.
3. **Terms and DPA** (pl, en): service, trial and payment (P3), suspension, deletion, liability (the agent drafts; the lawyer decides); DPA with the processing details and the sub-processor list as an annex.
4. **Cross-check**: every claim against the code and the docs; fix the texts or open a follow-up.
5. **Cost model and ADR 0020**: `triage:cost` on the pilot (read-only on production or staging), the Vertex price, hosting and services; ADR 0020; docs pointers.

## Questions for the plan session

- The legal name and address of the service provider for the papers (user; it goes into the public repo, so the user decides what is written).
- Governing law and court (default: Polish law, the court of the provider's seat), and the trial and payment terms in words.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-12: Created by the S6 master plan session (`tasks/active/s6-pre-sale.md`).
