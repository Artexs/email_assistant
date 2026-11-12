# Quality lab (Stage 2 E2): facts learned in discovery

Written 2026-11-13 by the E2 discovery session. Decisions are in `docs/product/stage-2/epics/E02-quality-lab.md` and `decisions.md`; this note holds facts only.

- The eval runner classifies cases one after another (`apps/server/src/modules/triage/eval.ts:457`). At p50 1.4 s per call, 1,500 cases take about 35 min. The "< 10 min" exit needs a worker pool (about 8 in flight).
- Measured cost: `gpt-6-luna` classifier = $0.000143 per mail, $0.86 per mailbox per month at 200 mails a day (`evals/results/2026-11-07-gpt-6-luna-classifier-v2.md`).
- The server has no clock abstraction. Sync, expiry, digest and reminder jobs read the system time. A simulated week therefore runs in real time unless a clock port is added (not planned).
- `LLM_DAILY_CAP` default is 300 calls a day (`.env.example`). A stack that triages 150 mails a day plus drafts needs its own value.
- `MAIL_ALLOW_LOCAL_HOSTS` (F082 s09) is one switch for the whole server. A local mail server (GreenMail) on the production stack would need it for every organization.
- `TELEGRAM_API_ROOT` is one value per server; the fake Telegram (`tools/fake-telegram`) binds `127.0.0.1` by default.
- ADR numbers 0018 (D17, one LLM provider), 0019 (S6f) and 0020 (S6e) are reserved by `tasks/active/s6-pre-sale.md`. The next free number was 0021.
- AgentMail limits (docs read 2026-11-13): Free 3 inboxes, 100 mails/day; Developer 10 inboxes, 1,000/day; an agent self-sign-up starts at 1 inbox and 10 mails/day. Two of the three Free inboxes hold the owner's own addresses.
- `docs/product/` was untracked in git until the E2 discovery commit.
- GitHub CI (`.github/workflows/ci.yml`) has no LLM key.
