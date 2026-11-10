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

| ADR  | Title                                                                  | Status                             |
| ---- | ---------------------------------------------------------------------- | ---------------------------------- |
| 0001 | Multi-tenant SaaS, one pilot tenant in MVP                             | accepted                           |
| 0002 | One repo, Bun workspaces, modular monolith                             | accepted                           |
| 0003 | LLM returns data; plan → policy → commit; no send without user command | accepted                           |
| 0004 | Gmail API first, behind a MailProvider port                            | superseded by 0010                 |
| 0005 | Telegram first, behind a ChatChannel port                              | accepted                           |
| 0006 | Postgres (Supabase) for data, auth and work queue                      | superseded by 0011                 |
| 0007 | LLM: Google Gemini through `@google/genai`                             | accepted, amended by 0012 and 0013 |
| 0008 | Minimal append-only audit log in MVP                                   | accepted                           |
| 0009 | Mail credentials encrypted in the server, never readable by clients    | accepted                           |
| 0010 | IMAP + SMTP with a password first, behind a MailProvider port          | accepted, amended by 0014          |
| 0011 | Own Postgres in Compose on the home VPS; no Supabase                   | accepted                           |
| 0012 | LLM: data rules, endpoint per stage, cost and failure limits           | accepted, amended by 0013          |
| 0013 | LLM: the temporary pilot mailbox on the Gemini free tier               | accepted                           |
| 0014 | The sync reads INBOX and the provider's sort folders and spam folder   | accepted                           |
