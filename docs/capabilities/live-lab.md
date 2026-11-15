# Live lab

> Checked against the code at `8a6d2c17`, 2026-11-15.

## What it does now

The live lab plays the frozen week of made-up mail (`lab-01`) through the real pipeline on a separate sim stack (ADR 0021). Today the code has the guard, the run plan, the state files, the delegate bots (a function, not yet called by a loop) and the `lab` CLI frame: `start`, `status` and `stop` work; `seed`, `reset`, `serve`, `score` and the demo commands exit 1 with `not built` until their stages land. A run belongs to one lab organization (`lab` or `demo`). `start` plans the run, clamps its cost cap to what is left of the month budget, and writes the run folder under `LAB_STATE_DIR`. `status` prints the counts of each run. `stop` ends a run and writes one spend line in the ledger. The lab sends no mail and no tap to a real person: every command refuses on an env that is not the sim stack.

## Rules

1. **Env guard.** Every `bun run lab` command except `demo-import` first runs `checkSimEnv` with the scenario addresses (`labAddresses`). Any issue code exits 1 with the codes and no change on disk. The codes are in `packages/core/src/sim/live/env-guard.ts`.
2. **Run plan.** `planLiveRun` shifts the week by whole weeks and keeps the Warsaw wall time of each slot. A `week` run starts on a Monday (`not_monday`), a run that crosses a DST change is refused (`dst_change`), a bad date is `bad_date`. The default `--date` is tomorrow in Warsaw; for `week` it is the next Monday. The run id is `<day|week>-<YYYYMMDD>-<4 hex>`.
3. **Start checks**, in this order; the first failure exits 1 and writes nothing:
   1. `not_seeded`: the org is not in `orgs.json`.
   2. `cap_too_high`: `--cap-usd` is above the default of the mode ($1 for `day`, $5 for `week`).
   3. the run plan refusals of rule 2.
   4. `month_cap`: the cap left is zero or less (rule 4).
   5. `model_unpriced`: a model the lab roles call (every role but `judge`) has no price in `llmPrices`. A call with no price would count $0 toward the cap, so the stack is refused.
   6. `org_not_fresh`: the org already holds mail and `--reuse` is not set. A run on a used org mixes the metrics of two runs; `lab reset` (not built) makes a fresh org.
   7. `run_active`: the org has an active run. The lock is taken before any file is written, so a refused start leaves no run folder.
4. **Cap.** `capFor(request)` = `min(request, 20 − spend of the month in the ledger − caps of the active runs)`, never below 0 (`runCap` of `apps/server/src/platform/eval-ledger.ts`). The ledger gets a line only when a run ends, so the cap of an active run counts as spent. The ledger is `<LAB_STATE_DIR>/eval-spend.jsonl`.
5. **Run spend.** `runSpend` sums the run organization's `llm.call` rows from the start of the plan, priced with `costPerMail`. A row whose model has no price makes the result `unpriced` (never $0); the priced part is a lower bound. The serve loop (not built) stops such a run with `error:unpriced`.
6. **Stop.** `stop --run <id>` writes `stopped: operator` (the only writer of `stopped` is `stopRun`), frees the org lock, and writes one ledger line with the run spend. A second `stop`, or a ledger line that exists already for the run id, adds no second line.
7. **Status.** One line per run: org, cap, planned, injected, late, replies, taps, skips, spend and the stop reason. The serve heartbeat comes with the serve loop.

8. **Delegate bots.** `runDelegateBotsTick(deps, runId)` plays the delegates (the personas of group `delegate`) through their GreenMail inboxes. The bots send only fixed templates (no LLM), only from scenario addresses, only to the address of the run's mailbox, and only through GreenMail: a send to an address outside the allowed set is refused (`address_refused`, in the client and again before the send).
   1. **Read.** For each delegate, the INBOX mail after the last seen UID (`seen` event `uid:<persona key>`). The first tick of a run sets the cursor to the newest UID and reads nothing, so older mail and the mail of another run never count. Mail from a bot address (a delegate or its `other_address` alias) is skipped with no event.
   2. **Map.** The last lab Message-ID of this run in `References` / `In-Reply-To` gives the slot (`parseLabMessageId`; a bot reply id `<r.<hex>@…>` never parses as a lab id). Only ids of another run: ignored, no event. No lab id or an unknown slot: `skip unmapped`. A slot sent by this delegate persona (a clarification reply to its own mail): `skip reply_to_own_mail`, no reply. A slot with no `delegateBehaviour`, or whose `expectedDelegate` is another persona: `skip unexpected_delegation`, no reply.
   3. **Classify.** Mail that references a delegation mail this bot saw before for the same slot is a `reminder`; else a `delegation`.
   4. **Plan** (`botReplyPlan`, pure, Warsaw time). The start point is the receipt time inside Mon–Fri 08:00–18:00, else the next working day 08:00; the reply may fall after 18:00. `done`: delegation → reply at the start point plus 30–240 min; reminder → none. `late`: delegation → none; the first reminder, when no `done` was planned for the slot → `done` at the start point plus 30–120 min. `out_of_office`: every event → `auto_reply` one minute after receipt, any hour, header `Auto-Submitted: auto-replied`, back-on date = receipt day plus 7 days. `other_address`: like `done`, from `otherAddressOf(delegate)` (the same local part on `poczta-prywatna.test`). `silent`: none. The delay comes from `mulberry32` seeded by the run id and the received Message-ID.
   5. **Send.** `bot_planned` (key `<received Message-ID>:<kind>`, once per key) is written when the mail is read. A reply whose time has come gets `bot_intent`, SMTP, `bot_done`. From = the delegate address (or the alias), To = the `From` of the received mail, which must be the run mailbox. Subject `Re: <subject>`, `In-Reply-To` = the received id, `References` = its `References` plus that id, Message-ID `<r.<12 hex of sha256(key)>@<sender domain>>`. Text: fixed per persona language (pl, en, de).
   6. **Resume.** A `bot_intent` with no `bot_done` is checked first: the reply Message-ID is searched in every folder of the run mailbox (the sim server moves mail out of the INBOX). Found → `bot_done`, no send; not found → send. A send that fails keeps the intent and counts `failed`; the next tick tries again.
   7. **Logs.** The bots write run events only: ids, keys, codes and counts. No subject, text or address.
   8. `other_address` replies are not matched to the delegation by the server (the reply detection needs the delegate address); the scorer reports them.

## Entry points

| Kind     | Name                                                                           | Where                                        |
| -------- | ------------------------------------------------------------------------------ | -------------------------------------------- |
| CLI      | `bun run lab start`, `status`, `stop` (the other commands exit 1: `not built`) | `apps/server/src/scripts/lab.ts`             |
| CLI      | argument parser and the 10 usage lines                                         | `apps/server/src/scripts/lab-args.ts`        |
| function | command dispatch with the env guard                                            | `apps/server/src/scripts/lab-run.ts`         |
| function | `startLabRun`, `stopLabRun`, `writeRunLedgerLine`                              | `apps/server/src/modules/lab/start.ts`       |
| function | `orgHasMail` (the fresh-org check; counts the mail rows)                       | `apps/server/src/modules/lab/org-mail.ts`    |
| function | `runSpend`                                                                     | `apps/server/src/modules/lab/run-spend.ts`   |
| function | `runDelegateBotsTick`                                                          | `apps/server/src/modules/lab/bots.ts`        |
| function | `createLabMailClient` (GreenMail SMTP, IMAP read and APPEND; address guard)    | `apps/server/src/modules/lab/mail-client.ts` |
| function | `botReplyPlan`, `botReplyText`, `otherAddressOf`, `backOnText`                 | `packages/core/src/sim/live/bot.ts`          |
| function | run state, locks and `capFor`                                                  | `apps/server/src/modules/lab/state.ts`       |
| function | `checkSimEnv`, `planLiveRun`                                                   | `packages/core/src/sim/live/env-guard.ts`    |

## Data

Files under `LAB_STATE_DIR` (an absolute path): `orgs.json`, `runs/<runId>/run.json`, `runs/<runId>/events.jsonl`, `locks/<org>.lock`, `eval-spend.jsonl`. Events hold ids, codes and counts only. Bot events: `seen` (`uid:<persona key>` cursor; `mail:<slot id>:<delegation|reminder>` handled mail), `bot_planned`, `bot_intent`, `bot_done`, `skip`. The lab reads the `llm.call` rows of `audit_log` and counts the rows of `emails`; it writes no table.

## Limits

- Seed, reset, injector, the loop that calls the bot tick, executive, serve loop, scorer and the demo commands: F113 stages 06 to 15 (`bun run lab` exits 1 with `not built`).
- The month cap is checked at `start` only. Two `start` calls for two orgs at the same moment can both read the same state. Stage 11 (F113) stops a run at its own cap.
- The ledger is per machine: offline evals on another machine use their own file.
- The sim stack files and `lab:env-check` come with F113 stage 03.

## Decisions

ADR 0021 (simulator stack). F113 decisions: caps $1 a day run, $5 a week run, $20 a month (PD-023); one active run per org; each measured run on a fresh org.

## Tests

- `apps/server/src/scripts/lab-args.test.ts`
- `apps/server/src/scripts/lab-run.test.ts`
- `apps/server/src/modules/lab/state.test.ts`
- `apps/server/test/integration/lab-run-spend.test.ts`
- `apps/server/test/integration/lab-bots.test.ts`
- `packages/core/src/sim/live/bot.test.ts`
