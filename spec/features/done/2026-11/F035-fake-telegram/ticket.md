---
opened: 2026-11-07
landed: 2026-11-07
---

# F035 · Fake Telegram: a local Bot API emulator for agent-run dev tests

## Outcome

A local fake of the Telegram Bot API that our server talks to in dev, plus a driver (CLI + script API) with which an agent plays the user. The agent can then run full Telegram flows (link, notices, digest, buttons) alone, with GreenMail, and repeat them after each change.

## Notes

Moved from `tasks/done/fake-telegram.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
