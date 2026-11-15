# Live lab

> Checked against the code at `1f53da2b`, 2026-11-15.

## What it does now

The live lab plays the frozen week of made-up mail (`lab-01`) through the real pipeline on a separate sim stack (ADR 0021). Today the code has the guard, the run plan, the executive rules (pure, not yet driven), the injector (one tick function; the serve loop that calls it is not built), the state files and the `lab` CLI: `seed`, `start`, `status` and `stop` work; `reset`, `serve`, `score` and the demo commands exit 1 with `not built` until their stages land. `seed` makes the lab organization from the scenario. A run belongs to one lab organization (`lab` or `demo`). `start` plans the run, clamps its cost cap to what is left of the month budget, and writes the run folder under `LAB_STATE_DIR`. `status` prints the counts of each run. `stop` ends a run and writes one spend line in the ledger. The lab sends no mail and no tap to a real person: every command refuses on an env that is not the sim stack.

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
7. **Seed.** `bun run lab seed [--org lab|demo]` calls the module functions behind `org:create`, `mailbox:connect`, `delegates:add`, `rules:add`, `mailbox:settings mode`, `org:flag` and `telegram:link` (no CLI process). It makes: the org (name `Kordelan lab` or `Kordelan demo`, plan `active`, Warsaw), the owner (the executive name; the email is the mailbox address, because `users.email` is unique), the mailbox, one delegate per `scenario.delegates`, one `vip` rule per VIP persona, the mode (`lab`: `assist` with its default switches; `demo`: `shadow`), every flag of `LAB_FLAGS_ON` and the fake Telegram link (chat 5550001 for `lab`, 5550002 for `demo`). A key of `features.ts` that is in neither `LAB_FLAGS_ON` nor `LAB_FLAGS_OFF` fails the lab test.
   1. **Mailbox host.** The host of a lab mailbox is always `127.0.0.1` (`LAB_MAIL_HOST`; IMAP 3143, SMTP 3025, password `greenmail-test`) and nothing else. In the sim stack GreenMail shares the network namespace of `fake-telegram`, like `server` and `lab` (`deploy/compose.sim.yaml`), so it is on `127.0.0.1`; the server opens plain IMAP and SMTP only to a loopback host. The env guard does not check mailbox hosts; seed takes no host from an argument, the env or a file. GreenMail has no name on the network and publishes no port (rule `greenmail_port_published` of `sim:check`). The injector and the delegate bots (later stages) run in the `lab` container, in the same namespace, and use the same host.
   2. **Order.** `orgs.json` is written after the mailbox exists and before the Telegram step. A crash in the Telegram step leaves one org; the next `seed` tries the link again.
   3. **Repair.** A second `seed` (the key is in `orgs.json`) makes nothing twice. It adds a missing mailbox, delegate, rule or flag, and prints `seed: exists` with the added counts. The mode changes only when it differs, so a repair keeps the switches. An org id that is gone exits 1 `org_gone`; seed never makes a new org for it.
   4. **Link.** Seed sends `/start <token>` as the owner through the fake's control routes and waits up to 60 s for the server to link the chat; else exit 1 `telegram_link_timeout`. The link check covers the DB and the fake: a DB link whose chat the fake does not know (a restarted fake) counts as a restart, and seed sends `/help` from that chat (no `/start`).
   5. **Urgency profile.** `start` stores the scenario topics and the shifted plan deadlines as the urgency profile of the lab mailbox after it wrote the run (`storeRunUrgencyProfile`). A refused start changes nothing; a failed store stops the run with `error:urgency_profile`.
8. **Injector.** `runInjectorTick(deps, runId)` puts the planned slots into the mailbox of the run. One call is one tick.
   1. **Once per slot.** A tick takes the plan items with `at` ≤ now that have no `inject_done` and no `skip`, in plan order, at most 20 per tick. For each it writes `inject_intent` (slot id, Message-ID) to the event file, sends, then writes `inject_done`. `smtp` slots go by SMTP: envelope from = the sender address, envelope to = the run mailbox only (the other `to` and `cc` personas get no copy). `append_sent` slots (mail of the executive) are APPENDed into `Sent` of the run mailbox with `\Seen`; the folder is created when it is missing.
   2. **Resume.** An item with `inject_intent` and no `inject_done` is looked up by Message-ID in **every folder** of the mailbox before any send: the sim server moves mail out of the INBOX in assist mode, so an INBOX-only search would send the mail a second time. Found: write `inject_done`, no send. Not found: send.
   3. **Late.** A slot that goes out more than 120 s after its `at` gets `lateBySec` (now − at) in its `inject_done`. A slot due while the loop was down goes out at once.
   4. **Errors and skip.** A send or search error writes `inject_error` (slot id, code) and no `inject_done`; the next tick tries again. The fifth `inject_error` of one slot (counted from the events, so a restart keeps the count) writes `skip` with code `smtp_failed` or `append_failed`. A skipped slot is never selected again. The scorer counts skips. A skipped parent still gives its Message-ID to its replies (the id comes from the plan, not from the delivery).
   5. **Budget.** When the run spend is at or above the run cap, the tick sends nothing and returns `stopped: "budget"`. It writes no `stopped` event: the serve loop calls `stopRun`, so the ledger line is written once.
   6. **Mail client.** `createGreenMailClient` (SMTP by nodemailer, IMAP by ImapFlow, no logger) talks to the sim GreenMail only. Its errors are `LabMailError` with a code (`smtp_failed`, `imap_connect`, `imap_list`, `imap_search`, `imap_append`, `imap_fetch`) and never the server text or the mail text. The folder search uses `SEARCH HEADER Message-ID`, which is fine on GreenMail and is not a product path.
9. **Status.** One line per run: org, cap, planned, injected, late, replies, taps, skips, spend and the stop reason. The serve heartbeat comes with the serve loop.
10. **Executive rules.** `executiveDecision` (core) says which button the scripted executive presses on a Telegram card. First match wins: no lab truth for the mail = no press (`unmapped`); a delegation draft to the expected delegate (case-insensitive) = `ap:`; a delegation draft for a mail that is not a delegation = `ar:` with reason "not needed"; a delegation draft to another person = `ar:` with reason "wrong person"; a clarification draft = `ap:` only when the truth expects one, else `ar:` with "not needed"; a reason card = the planned reason `rw:p` or `rw:n` (none planned = no press, `no_rule`); a reminder set = `as:`; a failed send = `ag:` once; a feedback card that reports a move of an urgent, needs-reply or delegation mail = `fu:` (Undo). No rule presses a relabel, edit, check, review, `gw:`, `dd:` or `mk:` button. An approval card with no read draft gets no press. A reject edits the approval message in place, so the reason buttons come on the same message id; `cardsOf` splits one message into one card per id in its buttons (a digest holds many mails). `executiveTapAt` gives the tap time: Warsaw weekdays 08:00-18:00 and weekends 10:00-11:00, the card time or the next window start plus 5 to 90 minutes (seeded); the longest gap is 23 h, inside the 48 h approval time. The driver (stage 10) reads the fake Telegram and the DB.

## Entry points

| Kind     | Name                                                                                   | Where                                      |
| -------- | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| CLI      | `bun run lab seed`, `start`, `status`, `stop` (the other commands exit 1: `not built`) | `apps/server/src/scripts/lab.ts`           |
| CLI      | argument parser and the 10 usage lines                                                 | `apps/server/src/scripts/lab-args.ts`      |
| function | command dispatch with the env guard                                                    | `apps/server/src/scripts/lab-run.ts`       |
| function | `startLabRun`, `stopLabRun`, `writeRunLedgerLine`                                      | `apps/server/src/modules/lab/start.ts`     |
| function | `seedLabOrg`, `LAB_TARGETS`, `LAB_FLAGS_ON`, `LAB_FLAGS_OFF`                           | `apps/server/src/modules/lab/seed.ts`      |
| function | `createFakeTgClient` (HTTP client of the fake's `/_fake/*` routes)                     | `apps/server/src/modules/lab/fake-tg.ts`   |
| function | `storeRunUrgencyProfile`                                                               | `apps/server/src/modules/lab/urgency.ts`   |
| function | `orgHasMail` (the fresh-org check; counts the mail rows)                               | `apps/server/src/modules/lab/org-mail.ts`  |
| function | `runSpend`                                                                             | `apps/server/src/modules/lab/run-spend.ts` |
| function | `runInjectorTick`                                                              | `apps/server/src/modules/lab/injector.ts`    |
| function | `createGreenMailClient` and `LabMailClient` (stages 08 and 14 reuse it)        | `apps/server/src/modules/lab/mail-client.ts` |
| function | run state, locks and `capFor`                                                          | `apps/server/src/modules/lab/state.ts`     |
| function | `checkSimEnv`, `planLiveRun`                                                           | `packages/core/src/sim/live/env-guard.ts`  |
| function | `executiveDecision`, `executiveTapAt`, `cardsOf`                                       | `packages/core/src/sim/live/executive.ts`  |

## Data

Files under `LAB_STATE_DIR` (an absolute path): `orgs.json`, `runs/<runId>/run.json`, `runs/<runId>/events.jsonl`, `locks/<org>.lock`, `eval-spend.jsonl`. Events hold ids, codes and counts only. Events of the injector: `inject_intent`, `inject_done`, `inject_error`, `skip`. The lab reads the `llm.call` rows of `audit_log` and counts the rows of `emails`; it writes no table.

## Limits

- Reset, bots, executive driver, serve loop, scorer and the demo commands: F113 stages 08 to 15 (`bun run lab` exits 1 with `not built`).
- A crash between the creation of the org and the mailbox, before `orgs.json` is written, leaves an org that `orgs.json` does not name: the next `seed` fails on the owner email (`users.email` is unique). Delete that org by hand.
- The month cap is checked at `start` only. Two `start` calls for two orgs at the same moment can both read the same state. Stage 11 (F113) stops a run at its own cap.
- The ledger is per machine: offline evals on another machine use their own file.
- The sim stack files and `lab:env-check` come with F113 stage 03.

## Decisions

ADR 0021 (simulator stack). F113 decisions: caps $1 a day run, $5 a week run, $20 a month (PD-023); one active run per org; each measured run on a fresh org.

## Tests

- `packages/core/src/sim/live/executive.test.ts`
- `apps/server/src/scripts/lab-args.test.ts`
- `apps/server/src/scripts/lab-run.test.ts`
- `apps/server/src/modules/lab/state.test.ts`
- `apps/server/test/integration/lab-run-spend.test.ts`
- `apps/server/test/integration/lab-injector.test.ts` (shared GreenMail; a fake client for budget, late, cap and skip)
- `apps/server/test/integration/lab-seed.test.ts`
- `tools/fake-telegram/test/lab-client.test.ts`
