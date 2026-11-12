> **Status 2026-11-12 — planned.** Left: the detailed stage plan (an own `plan-task` session), then the build with `run-task`.

# S6e Draft papers and cost model

> **Scope change 2026-11-12:** local production on the home VPS, no outside customers (master plan § "Scope change", P16–P24). This file is rewritten for it; the plan session reads that section first.

Scope: the S6 master plan `tasks/active/s6-pre-sale.md` (P21, D18, D19 and D20 as changed, D27 as changed, D28 (ADR 0020), "Rules for every step"). Needs: S6c merged (the texts describe the delete, the export and the Polish UI). No user step: no lawyer, no domain, no price decision (the price is a placeholder).
Git mode: worktree (`task/s6e-papers-cost`). Run mode: pipeline. Review model: Sonnet, high, plus a cross-check stage (below).

## Goal

The application has the full shape of the legal pages: a privacy policy, terms and a DPA in Polish and English, as in-app pages marked "DRAFT, not legal advice", that describe the real setup. A one-page cost model gives the cost per mailbox from real data.

## Done when

- The stub pages of S6b (`/legal/{pl,en}/{privacy,terms,dpa}`) hold the draft texts, linked from `/login`, `/setup` and the Account card (Playwright: each page opens without a session and no redirect happens).
- Every page starts with the line "DRAFT, not legal advice. This service runs on a private server for its owner only." (pl and en). The line stays (P21).
- The texts state the real setup and nothing else: the home server behind Tailscale, OpenAI as the LLM provider (the current `LLM_PROVIDER`), Telegram (outside the EU; what it gets: sender, subject, AI summary, draft text), Backblaze B2 (encrypted backups), Tailscale (access only); the retention periods of `docs/architecture.md` §7 and the identifier columns that retention keeps (S6a note); the delete (S6c) and the export; the operator notices (ids only). Placeholders for what does not exist: `<provider name>`, `<address>`, `<contact>`.
- A cross-check stage compares each claim with the code and the docs and lists each claim with its source line.
- `TERMS_VERSION` (S6b, `packages/core`) changes with the texts; the S6b dialog appears for a user with the old version (existing test).
- `docs/cost-model.md`: tokens per mail from `triage:cost` on the pilot (real numbers, date), the OpenAI price of the current model, the home VPS (power, the user's estimate or a placeholder), Backblaze, Tailscale (free tier); cost per mailbox at 50, 100 and 200 mails a day; the price is `<price>` (P21).
- ADR 0020 (accounts: invite, plan state, consent by mode, deletion; written for the local production shape) is accepted; `docs/product-brief.md` and `docs/roadmap.md` point to the drafts.

## Owns (from the master plan)

- Decisions D18 (texts in the S6b pages; the version bump), D19 and D20 (as changed by the scope change), D27 (the sub-processor list of the drafts: OpenAI, Telegram, Backblaze, Tailscale), D28 (ADR 0020).
- Files (expected): `apps/web/src/content/legal/{pl,en}/{privacy,terms,dpa}.md` (S6b made stubs), `packages/core` (`TERMS_VERSION` bump), links in the login, setup and Account components, `docs/cost-model.md`, `docs/decisions/0020-*.md`.

## Stage sketch

1. **Links and frame check**: the links in the login, setup and Account components; the CSP check (no inline script); Playwright without a session.
2. **Privacy policy** (pl, en): roles, data, purposes, periods, sub-processors, transfers (Telegram, OpenAI), rights, contact placeholder.
3. **Terms and DPA** (pl, en): service, plan state (trial, active, suspended) without payment terms, deletion, liability placeholder; DPA with the processing details and the sub-processor list as an annex.
4. **Cross-check**: every claim against the code and the docs; fix the texts or open a Limen ticket.
5. **Cost model and ADR 0020**: `triage:cost` on the pilot (read only on the VPS, the user's go), the OpenAI price, the other costs; ADR 0020; docs pointers.

## Questions for the plan session

- Whether the drafts name the user (default: no; placeholders only, because the repo is public).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are Limen tickets in `spec/features/planned/`.

## Log

- 2026-11-12: Created by the S6 master plan session (`tasks/active/s6-pre-sale.md`).
- 2026-11-12: Rewritten for the scope change (P21): drafts without a lawyer, OpenAI instead of Vertex, price placeholder.
