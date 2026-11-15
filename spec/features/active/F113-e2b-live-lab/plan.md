# F113 · E2b Live lab — plan

> **Status 2026-11-15 — planned.** 16 stages written, cold review 1 applied, nothing built. Plan base: `2e2451be`.

Sources: epic `E02-quality-lab.md`, its notes §2.4, ADR 0021, F097 seam S6. Defaults: [questions.md](questions.md).

## Input

Owner: "create more synthetic emails that will mock behaviors"; "go with defaults" (PD-013).

### Product decisions (do not reopen)

- **P1** (PD-020, ADR 0021) A separate Compose project, own DB, GreenMail, fake Telegram, no outbound mail; tailnet-only panel.
- **P2** (PD-021) Delegates are GreenMail bots (five behaviours); a scripted executive taps through the fake Telegram.
- **P3** (PD-022) Real time. A live day is the routine smoke; the live week runs before the Stage 2 exit.
- **P4** (PD-023) Caps: $5 per live week, $20 per month (with the offline runs).
- **P5** (PD-027) Demo org fed from the week, 3 days shadow then assist, one reset command; E10 adds an export.
- **P6** (PD-056) The scorer calls the E3a metric module. One definition per metric.
- **P7** (PD-057, PD-063, PD-068) The report counts phishing mail pushed as urgent and the PD-044 send-limit hits.
- **P8** (E5 notes §6) Executive-started threads get a Sent copy by APPEND; the `other_address` case is reported.

### Design decisions

- **D1 Stack.** Project `ea-sim` (`deploy/compose.sim.yaml`): `db`, `greenmail`, `fake-telegram`, `server`, `lab`. `server` and `lab` join the fake's network namespace, so a loopback `TELEGRAM_API_ROOT` passes the config check. Panel on `127.0.0.1:8180`. Rejected: a looser config check (weakens a production guard).
- **D2 Image.** `deploy/Dockerfile.sim` builds on a sim-only base tag of the same commit, adds the fake and `evals/sim`; the production image and tag do not change.
- **D3 Env guard.** `checkSimEnv(env)` (core, rules in stage 02) returns issue codes. Every `lab` command and the start command of `server`, `lab` and `fake-telegram` (`lab:env-check &&`) refuse on any issue: a real bot token in the sim server would steal the production bot's updates.
- **D4 Outbound.** GreenMail does not relay (N1); `SEND_SCOPE=self` with scenario addresses only.
- **D5 Time.** The run shifts the week by whole weeks. Each slot keeps its local Warsaw wall time (`localToInstant`). A week run starts on a Monday. A day run plays the scenario day with its weekday (default: tomorrow). A DST change in the run refuses it.
- **D6 Dates in text.** `shiftDatesInText` moves dates in subject and body by the same offset (forms: stage 01); bare years, month-and-year and ids stay. Else "due in 4 days" becomes "in 10 weeks" and the urgent truth breaks (F3).
- **D7 Messages.** Message-ID `<slotId.runId@persona-domain>`; threading from the parent chain of the same run; `To` = the run's mailbox. `sent` slots: APPEND to `Sent` with `\Seen`.
- **D8 Exactly once.** Each outside write (inject, bot reply, tap) writes an `intent` event, then a `done` event. On resume, an intent without done is checked in every folder of the GreenMail mailbox by Message-ID (inject, reply) before a retry; a tap is never repeated (at most once). A slot due while the loop was down goes out at once with `lateBySec`.
- **D9 Bots.** One loop per delegate address; the slot's `delegateBehaviour` decides; fixed pl/en/de templates, no LLM. Rules: stage 08.
- **D10 Executive.** It acts by the slot truth: approve or reject (with reason) drafts, Undo wrong automatic moves, approve reminder sets. No relabel taps, no draft edits. Rules: stage 09.
- **D11 Hours.** Human delays (stages 08, 09) come from `mulberry32` seeded by the run id.
- **D12 Budget.** Cap $1 a day run, $5 a week run, clamped by `runCap` to $20 minus the month ledger minus the caps of active runs. Spend = the run org's `llm.call` rows, priced by `costPerMail`; an unpriced row stops the run. Only the serve loop's `finish` stops a run and writes the ledger line.
- **D13 Runs.** Run id `<day|week>-<YYYYMMDD>-<4 hex>`; one active run per org (lock first); each measured run on a fresh org (`lab reset`); state under `LAB_STATE_DIR`. Tail without new mail: 4 days (week), 1 day (day).
- **D14 Scorer.** Truth = the slot. M1 rows use slot truth; M2–M5 and M7 use the E3a readers with no test senders. It never copies a metric formula. Report `evals/results/sim-<date>-lab-01-<runId>.md` plus JSON counts; slot ids allowed, no mail text.
- **D15 Demo.** Org "Kordelan demo" with its own mailbox, a week run, shadow days 1–3, assist from day 4. A reset deletes only the org whose id and name the lab state holds.
- **D16 Export and import.** A JSON seed of the demo org (no secret, only `.test` addresses); the import makes a new org with new ids, open actions `expired`, no Telegram link, a paused mailbox.
- **D17 Borders.** No migration, no new dependency; module `lab` is a leaf that `main.ts` never starts.
- **D18 Not seeded.** `week/history.json` (E11a seam); the urgency profile only when its store exists (E3b seam).

## Facts checked

- **F1** Scout packets ([scouts.md](scouts.md)), re-read where a decision rests on them; review 1 checked more at HEAD.
- **F2** Week: 855 slots (153/154/155/156/155/42/40 a day), 56 delegations (done 23, late 11, out_of_office 8, silent 8, other_address 6), 15 `sent`.
- **F3** Dates in week texts (probe 2026-11-15): `dd.mm.yyyy` 537, `d.mm` 81, Polish `d <month>` 25, English 19, ISO 0.
- **F4** Agents have no local Docker socket; `docker compose config` runs without it.
- **F5** No HTTP approve or edit route at HEAD; taps use `ap:`, `ar:`, `rw:`, `fu:`, `as:`, `ag:`.

## Not verified

- **N1** GreenMail 2.1.15 does not relay. C1 checks (runbook step 6).
- **N2** The shared namespace survives a `server` restart. C1 checks.
- **N3** An `Auto-Submitted` reply does not close a delegation; the scorer reports it.
- **N4** VPS free disk. C1 checks `df -h /`.

## Done when

The six lines of `ticket.md` § Acceptance, shown by: stage 03 CI check, C3 report, C5 report, C6 log, stage 02 tests.

## Rules for every stage

- Read `CLAUDE.md`, the styleguide, `docs/code-patterns.md`, the ticket, this file, your stage. Build only your stage.
- Never open `evals/sim/*/holdout/`. Lab code reads only `scenario.json` and `week/`.
- `packages/core` stays pure: no `fs`, no `process.env`, no `Date.now()`, no `Math.random()`.
- Logs, events and errors hold ids, codes and counts. Never mail text, a subject, a token or a key. Never read `.env`.
- Integration tests use the shared GreenMail with random addresses and the fake Telegram in-process. No test needs Docker.
- Format only your files. Temp files in `/tmp/f113-sNN/`. Commit by explicit path.
- A stage that lands behaviour updates `docs/capabilities/live-lab.md` (stage 05 creates it).
- A gap or a deviation is a question in your final message, not a choice.

## Proof

```
mkdir -p /tmp/f113-sNN && bun run lint > /tmp/f113-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f113-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f113-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f113-sNN/int.log 2>&1 && echo PROOF_OK
```

## Owner steps

- **O1** Grow the VPS root volume (PD-055: `sudo vgs`, `sudo lvextend -r -l +100%FREE /dev/ubuntu-vg/ubuntu-lv`, `df -h /`). Before C4. Default: the code stages and C1–C3 go on; C1 deploys only with ≥ 2 GB free; C4 waits for O1.

## Coordinator steps (VPS pre-approved; backup first, name the rollback, verify after)

Commands: stage 16 runbook. C1 after stage 16: build and start `ea-sim`, the env file (LLM key lines copied without printing), migrate, check N1, N2, tailnet port 8443. C2: seed, start a day run. C3: score it, commit the report. C4 after O1: `lab reset --org lab`, start a week run on a Monday. C5: score it, commit. C6: demo reset; after day 4, export, import on the dev DB.

## Review

Review job before land (Opus): 03, 07, 08, 10, 15 (`[risky]`). Others land on the proof.

## Stages

01 run plan, date shift · 02 messages, env guard · 03 sim stack `[risky]` · 04 state, corpus · 05 CLI, caps · 06 seed · 07 injector `[risky]` · 08 bots `[risky]` · 09 executive rules · 10 executive driver `[risky]` · 11 serve loop · 12 scorer: triage, M1 · 13 scorer: M2–M7 · 14 org and demo reset · 15 demo export, import `[risky]` · 16 docs, runbook. Files: `stages/`.

## How to run (coordinator)

Spawn per `spec/build.md` TRACK. Order: 01, 02, 04, 03, 05; then 06, 07, 08, 09 in parallel; 10 after 06 and 09; 11 after 07, 08, 10; 12 after 05; 13 after 12; 14 after 11; 15 after 14; 16 last. Drift check before 01.

## Planning progress

Scouts: 4, all answered. Stages 01–16 `[written]`. Words (`wc -w`): plan ≤ 1,500; stages ≤ 700.

## Cold review

Model `claude-opus-5-5` (risky stages; deploy, sending, exactly-once, data delete). Review 1 ([plan-review-1.md](plan-review-1.md)): FAIL, 6 blocking, 12 test gaps, 13 notes. All applied: Each stage header names the findings it took. Notable: env check in each container command (B6), resume over every folder (B3), at-most-once taps (T8), cap clamp (B5), fresh org per run (T10). Rejected: none. Stage 04 split into 04 and 05 (N11).

## Log
