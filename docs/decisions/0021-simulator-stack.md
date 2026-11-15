# 0021 — Simulator stack: a separate Compose project with GreenMail and a fake Telegram

- Status: accepted (PD-020, built in F113, 2026-11-15; first proposed in the E2 discovery, 2026-11-13)
- Date: 2026-11-13
- Numbers 0018–0020 are reserved by the S6 plan (`tasks/active/s6-pre-sale.md`: D17, S6f, S6e).

## Context

The quality lab (Stage 2 epic E2) must run a "simulated week" through the real pipeline: about 830 made-up mails over 7 days, delegate personas that answer, and an executive who taps approve, reject, edit and Undo. PD-006 forbids the pilot mailbox. AgentMail (the current test sender) has 3 inboxes and 100 mails a day on its Free plan and cannot set a per-mail `From`. The pipeline reads the system clock, so the week runs in real time.

Running the simulation as one more organization on the production stack has three problems:

- The mail host guard (`apps/server/src/modules/mail/host-check.ts`) refuses private addresses. A local mail server needs `MAIL_ALLOW_LOCAL_HOSTS=true`, which is one switch for every organization.
- `TELEGRAM_API_ROOT` is one value per server. The simulated executive needs the fake Telegram; the pilot needs the real one.
- A scripted approver on the production stack is one bug away from a tap on a real organization's draft.

## Decision

1. The simulation runs on its own Compose project (`ea-sim`, file `deploy/compose.sim.yaml`): the same server image, its own database, a GreenMail service (in the network namespace of the fake Telegram, so the server reaches it on 127.0.0.1: it opens plain mail only to a loopback host), a fake Telegram service (`tools/fake-telegram`), and its own `.env`.
2. Only this stack sets `MAIL_ALLOW_LOCAL_HOSTS=true` and points `TELEGRAM_API_ROOT` at the fake. The production `.env` never sets either.
3. The stack has no outbound mail path: every mailbox and every delegate address of the stack is a GreenMail user on `*.test` addresses. GreenMail stores mail for its own users and has no relay feature. Check N1 (`deploy/README.md` § Sim stack, step 9) proves this on the VPS. Checked on the VPS: not yet; the coordinator fills the date and the result here at the first VPS run (F113 step C1).
4. The scripted executive and the delegate bots talk only to services of this stack (its API, its fake Telegram, its GreenMail).
5. Its LLM calls carry made-up mail only (data rule `evals/README.md`); they use the same provider and model as production so the numbers are comparable.
6. Its web panel is served on the tailnet only, on a second `tailscale serve` port (ADR 0017 rule kept). The demo organization lives here.
7. Later the same project is the staging stack of E8.
8. **Network namespace (F113 D1).** `fake-telegram` owns the network namespace of the stack. `greenmail`, `server` and `lab` join it (`network_mode: service:fake-telegram`), so all of them share `127.0.0.1`. A loopback `TELEGRAM_API_ROOT` then passes the production config check, and the server reaches GreenMail on a loopback host. Rejected: a looser config check, because it would weaken a production guard. Cost: a restart of `fake-telegram` detaches the three other services (`deploy/README.md` § Sim stack, "Restart order"), and GreenMail keeps its mail in memory only.
9. **Env guard (F113 D3).** `checkSimEnv` (`packages/core/src/sim/live/env-guard.ts`) returns issue codes and never a value. Every `bun run lab` command (except `demo-import`, which runs on a dev machine) and the start command of `server`, `lab` and `fake-telegram` (`bun run lab:env-check &&`) refuse on any issue: the sim stack marker is missing, the Telegram root is not loopback, the bot token is not the fake token, `SEND_SCOPE` is not `self`, a send address is not a lab address, `TRIAGE_LLM_SCOPE` or `ACTIONS_SCOPE` is not `all`, or the heartbeat, operator chat, operator users or auth mail are set. A real bot token in the sim server would take the updates of the production bot, so the check runs before the program starts.
10. **Two outbound guards (F113 D4).** (a) GreenMail does not relay (check N1). (b) `SEND_SCOPE=self` with `SEND_TEST_ADDRESSES` set to the lab addresses only, so the server sends to no other address. The lab mail client adds two more: it refuses a host that is not loopback (`host_refused`) and an address outside the scenario (`address_refused`).
11. **Deploy is a release.** The sim images are built from the checkout of a release tag (`deploy/README.md` § Sim stack, step 1). Every VPS deploy is a release (`docs/release-checklist.md`).

## Consequences

- The production host guard and Telegram settings stay as they are; no per-organization exception is needed.
- The VPS runs a second server process, a second database (or a second database in the same Postgres) and GreenMail (Java). RAM and disk (3.8 GB free on 2026-11-11) must be checked first (E8 discovery). If the VPS is too small, the same stack runs on the owner's PC for live days.
- Provider behaviour (Interia sort folders, spam filters, SES headers) is not tested here; the pilot mailbox and the E9 provider spikes cover it.
- One more stack to deploy: the deploy checklist (E8) gets a line for it.
