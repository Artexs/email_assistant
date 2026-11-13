# Architecture decision records (ADR)

One file per decision: `NNNN-short-title.md`. Never edit an accepted decision to change it.
Write a new ADR and set the old one to `Superseded by NNNN`.

Template:

```
# NNNN — Title
- Status: proposed | accepted | superseded by NNNN
- Date: YYYY-MM-DD
## Context
## Decision
## Consequences
```

| ADR  | Title                                                                    | Status                                |
| ---- | ------------------------------------------------------------------------ | ------------------------------------- |
| 0001 | Multi-tenant SaaS, one pilot tenant in MVP                               | accepted                              |
| 0002 | One repo, Bun workspaces, modular monolith                               | accepted                              |
| 0003 | LLM returns data; plan → policy → commit; no send without user command   | accepted                              |
| 0004 | Gmail API first, behind a MailProvider port                              | superseded by 0010                    |
| 0005 | Telegram first, behind a ChatChannel port                                | accepted                              |
| 0006 | Postgres (Supabase) for data, auth and work queue                        | superseded by 0011                    |
| 0007 | LLM: Google Gemini through `@google/genai`                               | accepted, amended by 0012, 0013, 0015 |
| 0008 | Minimal append-only audit log in MVP                                     | accepted                              |
| 0009 | Mail credentials encrypted in the server, never readable by clients      | accepted                              |
| 0010 | IMAP + SMTP with a password first, behind a MailProvider port            | accepted, amended by 0014             |
| 0011 | Own Postgres in Compose on the home VPS; no Supabase                     | accepted                              |
| 0012 | LLM: data rules, endpoint per stage, cost and failure limits             | accepted, amended by 0013, 0015       |
| 0013 | LLM: the temporary pilot mailbox on the Gemini free tier                 | accepted, amended by 0015             |
| 0014 | The sync reads INBOX and the provider's sort folders and spam folder     | accepted                              |
| 0015 | LLM: Gemini and OpenAI behind one switch                                 | accepted                              |
| 0016 | Web panel: Astro static build with React islands, login with Better Auth | accepted                              |
| 0017 | Web access only through Tailscale Serve                                  | accepted                              |
| 0021 | Simulator stack: separate Compose project with GreenMail, fake Telegram | proposed                              |
| 0022 | Report mail goes into the user's own INBOX by IMAP APPEND               | proposed                              |
| 0023 | Every user action is a typed HTTP command described in OpenAPI           | proposed                              |
| 0024 | Structured logs, tailnet log store, operator alerts checked by the app   | proposed                              |
| 0026 | Identity tier 1: OIDC per organization, TOTP, break-glass owner         | proposed                              |
| 0027 | Operator role in the panel and per-organization feature flags           | proposed                              |
| 0028 | Autonomy earned from global evidence and a history check, not labels   | proposed                              |
| 0029 | The sync reads the Sent folder, read-only                               | proposed                              |
| 0030 | Public docs site: static Starlight on GitHub Pages, synthetic content   | proposed                              |
| 0031 | Mailbox OAuth through the existing IMAP adapter; Microsoft sends by Graph | proposed                              |
| 0032 | Phone channel: Web Push with ids and counts; Telegram detail per user   | proposed                              |
| 0033 | Reply drafts: free LLM text under code checks; mail-client edits win    | proposed                              |
