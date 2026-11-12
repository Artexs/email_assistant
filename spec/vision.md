# Vision

> Human-owned durable intent for every role. Keep this file at or below 1000 lines. The injected copy is capped at 1000 lines; keep each item high-signal and move supporting history to feature notes. The coordinator may propose changes but does not invent or rewrite this intent unprompted.

## Product principles

- Product: an AI email assistant for executives and managers, sold as SaaS to business owners. It sorts, summarizes and delegates mail, and filters spam. Source of truth: `docs/product-brief.md`.
- Users: the executive wants a clean inbox, only important items, and proof that delegated work gets follow-up. The assistant (EA) sets rules and checks drafts. MVP merges both into one power user.
- Value: time saved and trust. The user always sees what the system did and why (audit log, report, Undo for every change).
- The system never sends mail by itself. It sends only after the user approves (button or explicit command). Labels, moves and archive are allowed.
- Whitelisted mail is never spam. Hard rules run before the AI. Low confidence gives `unsure`, not a guess.
- Mailbox modes: `shadow` (report only) and `assist` (moves and drafts). Each automatic action has an ON/OFF switch and must pass the go/no-go bar for its category first.
- LLM text is untrusted: never a recipient, a folder name or a command. A Zod schema checks every LLM answer.
- Multi-tenant from day one: every table carries `org_id`, even with one tenant.
- Privacy and GDPR are product features: encrypted mailbox secrets, tenant isolation, retention limits, EU location before external customers. Telegram never gets raw mail bodies.
- Telegram is the main channel; the web panel is for setup and control. One channel-neutral backend API serves both.
- Mail access: IMAP + SMTP with the mailbox password (Interia first). Gmail and Microsoft 365 (OAuth) are Phase 2.
- Phase 2, not MVP: style learning, two-way chat, voice, meetings and calendar, mobile app, EA review flow.

## Current direction

- Pilot MVP (S0–S4) and the web panel lite (S5) are built and run on the home VPS on the user's own Interia mailbox. Detail: `docs/roadmap.md`.
- Now: S6 pre-sale, so the first external customer can sign up: sign-up, billing, account and data deletion, hosted EU production, Vertex AI EU, privacy policy and DPA, cost model. It runs in the old flow (`tasks/active/s6-pre-sale.md`).
- Open product question for S6: which mail providers the target customers use (market check P9 not done).
- Pilot results (one week of `assist` on real mail, the S4 pilot week) can change the go/no-go of each category. Read them before you widen any automatic action.
