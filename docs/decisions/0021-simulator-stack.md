# 0021 — Simulator stack: a separate Compose project with GreenMail and a fake Telegram

- Status: proposed (E2 discovery, 2026-11-13; waits for the owner's answer to decision 8 of `docs/product/stage-2/epics/E02-quality-lab.md`)
- Date: 2026-11-13
- Numbers 0018–0020 are reserved by the S6 plan (`tasks/active/s6-pre-sale.md`: D17, S6f, S6e).

## Context

The quality lab (Stage 2 epic E2) must run a "simulated week" through the real pipeline: about 830 made-up mails over 7 days, delegate personas that answer, and an executive who taps approve, reject, edit and Undo. PD-006 forbids the pilot mailbox. AgentMail (the current test sender) has 3 inboxes and 100 mails a day on its Free plan and cannot set a per-mail `From`. The pipeline reads the system clock, so the week runs in real time.

Running the simulation as one more organization on the production stack has three problems:
- The mail host guard (`apps/server/src/modules/mail/host-check.ts`) refuses private addresses. A local mail server needs `MAIL_ALLOW_LOCAL_HOSTS=true`, which is one switch for every organization.
- `TELEGRAM_API_ROOT` is one value per server. The simulated executive needs the fake Telegram; the pilot needs the real one.
- A scripted approver on the production stack is one bug away from a tap on a real organization's draft.

## Decision

1. The simulation runs on its own Compose project (`ea-sim`, file `deploy/compose.sim.yaml`): the same server image, its own database, a GreenMail service, a fake Telegram service (`tools/fake-telegram`), and its own `.env`.
2. Only this stack sets `MAIL_ALLOW_LOCAL_HOSTS=true` and points `TELEGRAM_API_ROOT` at the fake. The production `.env` never sets either.
3. The stack has no outbound mail path: every mailbox and every delegate address of the stack is a GreenMail user on `*.test` addresses. GreenMail stores mail for its own users and does not relay [check in the first E2b stage: send to an outside address and see it refused or kept local].
4. The scripted executive and the delegate bots talk only to services of this stack (its API, its fake Telegram, its GreenMail).
5. Its LLM calls carry made-up mail only (data rule `evals/README.md`); they use the same provider and model as production so the numbers are comparable.
6. Its web panel is served on the tailnet only, on a second `tailscale serve` port (ADR 0017 rule kept). The demo organization lives here.
7. Later the same project is the staging stack of E8.

## Consequences

- The production host guard and Telegram settings stay as they are; no per-organization exception is needed.
- The VPS runs a second server process, a second database (or a second database in the same Postgres) and GreenMail (Java). RAM and disk (3.8 GB free on 2026-11-11) must be checked first (E8 discovery). If the VPS is too small, the same stack runs on the owner's PC for live days.
- Provider behaviour (Interia sort folders, spam filters, SES headers) is not tested here; the pilot mailbox and the E9 provider spikes cover it.
- One more stack to deploy: the deploy checklist (E8) gets a line for it.
