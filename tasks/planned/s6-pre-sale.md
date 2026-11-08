> **Status 2026-11-02 — planned.** Left: everything. Write the file-level plan when the task moves to `active/`.

# S6 Pre-sale

Scope: `docs/roadmap.md` §2, row S6. Modules: `docs/modules.md`. Needs: S5.

## Goal

The first external customer can sign up: sign-up, billing, account and data deletion, hosted EU production, Vertex AI EU, privacy policy and DPA, cost model.

## Done when

- The first external customer can sign up and connect a mailbox.
- `platform/llm.ts` uses Vertex AI with the EU endpoint and the zero-data-retention setup.
- A deletion test removes every row of an organization; mailbox removal tells the user to change the mailbox password.
- The privacy policy names Google as the LLM processor; the DPA with Google is in place.
- A one-page cost model (LLM + hosting + optional CASA if Gmail comes) gives a price per mailbox.

## Plan

Written when the task starts (files to change, steps, tests).

If Gmail customers come (Phase 2 adapter): Google verification and a yearly CASA assessment are an external wait of weeks. Start them early.

From the S5 plan (2026-11-08, `tasks/active/s5-web-panel.md`):

- Polish UI translation: S5 ships English strings in `apps/web/src/i18n/en.ts` (U1); S6 adds `pl.ts` and a per-user language choice.
- An e-mail sender for the login: `sendResetPassword` (and the sign-up verification) sends mail in S6; S5 prints the link in the CLI (D2). `tasks/planned/web-public-hardening.md` lists what must hold before the panel leaves Tailscale.
- Public access: ADR 0016 (S5e) names Tailscale Serve for the pilot; S6 moves to a public proxy with TLS (Cloudflare Tunnel or Caddy on the hosted EU VPS) with no code change (P3).

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-02: Created from `docs/roadmap.md` and `docs/architecture.md` §11.
- 2026-11-02: Changed after the cold review (`tasks/done/mvp-plan-review.md`) and the user's answers (IMAP, home VPS, own Postgres).
