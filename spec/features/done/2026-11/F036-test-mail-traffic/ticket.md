---
opened: 2026-11-07
landed: 2026-11-10
---

# F036 · Test mail traffic: AgentMail synthetic mail utility

## Outcome

Support for AgentMail in the app, as test tooling: a utility that an agent can run by itself. The agent session writes made-up mails for several personas into a batch file. The utility sends them from an AgentMail inbox to the Interia test mailbox, puts them into the Interia INBOX, and compares the triage result of each mail with its expected category.

## Notes

Moved from `tasks/done/test-mail-traffic.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md). Its stage files: [stages/](stages/).
