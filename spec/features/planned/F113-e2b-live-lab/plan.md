# F113 · E2b Live lab — plan

> **Status 2026-11-15 — planned.** 15 stages written, nothing built. Plan base: `2e2451be`.

Sources: epic `E02-quality-lab.md`, `E02-discovery-notes.md` §2.4, ADR 0021, F097 plan seam S6, [scouts.md](scouts.md). Defaults: [questions.md](questions.md).

## Input

Owner words: "create more synthetic emails that will mock behaviors"; "Looks like a good plan, so yes, go with defaults." (PD-013).

### Product decisions (do not reopen)

- **P1** (PD-020, ADR 0021) A separate Compose project, own DB, GreenMail, fake Telegram, no outbound mail; tailnet-only panel.
- **P2** (PD-021) Delegates are GreenMail bots (`done`, `late`, `out_of_office`, `other_address`, `silent`); a scripted executive taps through the fake Telegram.
- **P3** (PD-022) Real time. A live day is the routine smoke; the live week runs before the Stage 2 exit.
- **P4** (PD-023) Caps: $5 per live week, $20 per month (with the offline runs).
- **P5** (PD-027) Demo organization in the sim stack, fed from the week, 3 days shadow then assist, one reset command. E10 adds an export (seed file).
- **P6** (PD-056) The scorer calls the E3a metric module. One definition per metric.
- **P7** (PD-057, PD-063, PD-068) The report counts phishing mail pushed as urgent and the PD-044 send-limit hits.
- **P8** (E5 notes §6) Executive-started threads get a Sent copy by APPEND; the `other_address` case is reported.

### Design decisions

- **D1 Stack.** Project `ea-sim`, `deploy/compose.sim.yaml`: `db`, `greenmail`, `fake-telegram`, `server`, `lab`. `fake-telegram` owns the network namespace; `server` and `lab` join it (`network_mode: service:fake-telegram`), so `TELEGRAM_API_ROOT=http://127.0.0.1:8090` passes the loopback check. Panel on `127.0.0.1:8180`, subnet `172.31.0.0/24`; memory limit and log rotation per service. Rejected: a looser config check (weakens a production guard).
- **D2 Image.** `deploy/Dockerfile.sim` builds `FROM` the `ea-server` image of the same commit. It adds `tools/fake-telegram/src` and `evals/sim`. The production image does not change.
- **D3 Env guard.** `checkSimEnv(env)` (core) returns issue codes; every `lab` command refuses on any issue. The rule list is in stage 02. Example: a real bot token would steal the production bot's updates (one poller per token).
- **D4 Two outbound guards.** GreenMail does not relay (N1); `SEND_SCOPE=self` lists only scenario addresses.
- **D5 Time.** The run shifts the week by whole weeks. Each slot keeps its local Warsaw wall time (`localToInstant`). A week run starts on a Monday. A day run plays the scenario day with the same weekday as its date; the default date is tomorrow. A run that holds a DST change refuses to start.
- **D6 Dates in text.** `shiftDatesInText` moves full dates in subject and body by the same offset: `dd.mm.yyyy`, `d.mm`, `d <month>` (pl genitive, en, de), `<Month> d`. Bare years, month-and-year and ids (`ZK-2027-0143`) stay. Else "due in 4 days" becomes "in 10 weeks" and the urgent truth breaks (F3).
- **D7 Messages.** Message-ID `<slotId.runId@persona-domain>`; `In-Reply-To` and `References` from the parent chain of the same run; headers and HTML from slot and text; `To` = the run's executive mailbox. `direction: sent` slots: APPEND to the executive's `Sent` folder with `\Seen`, no SMTP.
- **D8 Exactly once.** Each outside write (inject, bot reply, tap) writes an `intent` event, then a `done` event. On resume, an intent without done is checked against GreenMail by Message-ID (inject, reply) or against the DB (tap) before a retry. A slot due while the loop was down goes out at once with `lateBySec`.
- **D9 Bots.** One loop per delegate address; the slot's `delegateBehaviour` decides; fixed pl/en/de templates, no LLM. Rules: stage 07.
- **D10 Executive.** It acts by the slot truth: approve or reject (with reason) drafts, Undo wrong automatic moves, approve reminder sets. No relabel taps, no draft edits. Rules: stage 08.
- **D11 Hours.** Human delays and working hours (stages 07, 08) come from `mulberry32` seeded by the run id, so a run repeats.
- **D12 Budget.** Cap $1 a day run, $5 a week run. Spend = the run org's `llm.call` audit rows, priced by `costPerMail`; the month cap uses the eval spend ledger. At the cap the injector stops (`stopped: budget`).
- **D13 Runs.** Run id `<day|week>-<YYYYMMDD>-<4 hex>`; one active run per organization; state under `LAB_STATE_DIR` (a volume). Tail with bots and executive, no new mail: 4 days (week), 1 day (day).
- **D14 Scorer.** Truth = the slot. M1 rows use slot truth; M2–M5 and M7 use the E3a readers with no test senders. The scorer builds rows and never copies a metric formula. Report `evals/results/sim-<date>-lab-01-<mode>-<runId>.md` plus JSON counts; slot ids allowed, no mail text.
- **D15 Demo.** Organization "Kordelan demo", mailbox `wiktor.szalewski@demo.kordelan.test`, a week run, shadow for days 1–3, assist from day 4 00:00. `demo-reset` deletes only the organization whose id the lab state holds.
- **D16 Export and import.** A JSON seed of the demo org (no secret, only `.test` addresses); the import makes a new org with new ids, open actions `expired`, no Telegram link, a paused mailbox.
- **D17 Borders.** No migration, no new dependency. Module `lab` is a leaf; `main.ts` never starts its loops.
- **D18 Not seeded.** `week/history.json` (E11a seam); the urgency profile only when its store exists (E3b seam).

## Facts checked

- **F1** Scout packets ([scouts.md](scouts.md)), re-read where a decision rests on them: the loopback check, the fake's `127.0.0.1` bind, `SEND_SCOPE=self`, `rules:add --kind vip`, `renderSeedMessage` headers.
- **F2** Week: 855 slots (153/154/155/156/155/42/40 a day), 56 delegations (done 23, late 11, out_of_office 8, silent 8, other_address 6), 15 `sent`.
- **F3** Dates in week texts (probe 2026-11-15): `dd.mm.yyyy` 537, `d.mm` 81, Polish `d <month>` 25, English 19, ISO 0.
- **F4** Agents cannot reach the local Docker socket (`permission denied`); `docker compose config` runs without it.
- **F5** No HTTP approve or edit route at HEAD; taps use `ap:`, `ar:`, `rw:`, `fu:`, `as:`, `ag:`.

## Not verified

- **N1** GreenMail 2.1.15 does not relay to an outside host. C1 sends to `probe@example.com` and checks that no outbound connection happens and the mail stays local.
- **N2** `network_mode: service:fake-telegram` survives a `server` restart. C1 restarts `server` and checks Telegram and DB.
- **N3** An `Auto-Submitted` reply does not close a delegation. The scorer reports what happens; a closed one is a finding for E5b.
- **N4** VPS free disk. C1 checks `df -h /`.

## Done when

The six lines of `ticket.md` § Acceptance, shown by: stage 03 CI check, C3 report, C5 report, C6 log, stage 02 tests.

## Rules for every stage

- Read `CLAUDE.md`, the styleguide, `docs/code-patterns.md`, the ticket, this file, your stage. Build only your stage.
- Never open `evals/sim/*/holdout/`. Lab code reads only `scenario.json` and `week/`.
- `packages/core` stays pure: no `fs`, no `process.env`, no `Date.now()`, no `Math.random()`.
- Logs, events and errors hold ids, codes and counts. Never mail text, a subject, a token or a key. Never read `.env`.
- Integration tests use the shared GreenMail (`TEST_IMAP_PORT`, `TEST_SMTP_PORT`) with random addresses and the fake Telegram in-process. No test needs Docker.
- Format only your files. Temp files in `/tmp/f113-sNN/`. Commit by explicit path.
- A stage that lands behaviour updates `docs/capabilities/live-lab.md` (stage 04 creates it).
- A gap or a deviation is a question in your final message, not a choice.

## Proof

```
mkdir -p /tmp/f113-sNN && bun run lint > /tmp/f113-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f113-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f113-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f113-sNN/int.log 2>&1 && echo PROOF_OK
```

## Owner steps

- **O1** Grow the VPS root volume (PD-055: `sudo vgs`, `sudo lvextend -r -l +100%FREE /dev/ubuntu-vg/ubuntu-lv`, `df -h /`). Before C4. Default: the code stages and C1–C3 go on; C1 deploys only with ≥ 2 GB free; C4 waits for O1.

## Coordinator steps (VPS pre-approved; backup first, name the rollback, verify after)

The runbook of stage 15 holds the commands. C1 after stage 15: build and start `ea-sim`, the env file (LLM key lines copied without printing), migrate, check N1, N2, tailnet port 8443. C2: seed, start a day run. C3: score it, commit the report. C4 after O1: start a week run on a Monday. C5: score it, commit. C6: demo reset; after day 4, export, import on the dev DB.

## Review

Review job before land (Opus): 03, 06, 07, 09, 14 (`[risky]`). Others land on the proof.

## Stages

01 run plan, date shift · 02 messages, env guard · 03 sim stack `[risky]` · 04 state, CLI · 05 seed · 06 injector `[risky]` · 07 bots `[risky]` · 08 executive rules · 09 executive driver `[risky]` · 10 serve loop · 11 scorer: triage, M1 · 12 scorer: M2–M7 · 13 demo reset · 14 demo export, import `[risky]` · 15 docs, runbook. Files: `stages/`.

## How to run (coordinator)

Spawn per `spec/build.md` TRACK. Order: 01, 02, 03, 04; then 05, 06, 07, 08 in parallel; 09 after 08; 10 after 05–07 and 09; 11 after 04; 12 after 11; 13 after 10; 14 after 13; 15 last. Drift check before 01.

## Planning progress

Scouts: 4, all answered. Stages 01–15 `[written]`. Words (`wc -w`): plan 1,500; stages 511–700.

## Cold review

Not run yet.

## Log
