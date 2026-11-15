# F113 plan review 1 (job `2026-11-15-f113-plan-review-15a4d87a`, claude-opus-5-5, thinking high; final message filed whole)

FAIL d1b1aa8752f49792fc86220223fbb088b12990c0

HEAD matches the candidate (`git rev-parse HEAD` → d1b1aa87). The code did not drift from the plan base: `git diff --stat 2e2451be..HEAD -- apps packages tools deploy db` printed nothing. This is a plan review, so no unit or integration suite applies. The checks I ran are listed at the end. A full copy of this message is in `/tmp/f113rev/review-final.md`.

## BLOCKING

**B1. Ticket acceptance bullet 1 cannot pass in CI as planned (proven by reproduction).**
- `ticket.md:28` and `stage-03:33` run `docker compose … config --quiet`. `stage-03:25` gives `server` and `lab` the line `env_file: sim.env`. `stage-03:11` gitignores `deploy/sim.env`, so CI has no such file.
- Reproduction in `/tmp/f113rev`: a service with `env_file: sim.env` and no file gives `env file … not found`, exit 1.
- With `--no-env-resolution` the command exits 0. That flag is what `deploy/check-logging.sh:37` uses. With `env_file: [{path: sim.env, required: false}]` it also exits 0.
- The decision is missing: choose `required: false`, or a CI step that copies the example, or the acceptance command with `--no-env-resolution`. Also say what a missing `sim.env` does on the VPS.

**B2. Stage 09 never sees the reject-reason buttons, so test 2 cannot pass and M3 "wrong person" stays 0 (proven by code).**
- `stage-09:25` reads "after the last seen message id". `stage-09:28` waits for "the reason card for that action" to "appear".
- At HEAD a reject tap does not send a new message. It edits the approval message in place: `channels/approval-taps.ts:148-158` calls `edit("approval:<id>", "rejected", {reasonButtons})`, and `packages/core/src/digest/approvals.ts:408-412` puts the `rw:` buttons on that edited message.
- The fake changes the stored message in place (`tools/fake-telegram/src/state.ts:207`).
- Decision needed: after an `ar:` press, read the same message id again. Also store the planned reason in the event: `stage-04:18` `tap_planned` has no `then` field, so `pendingReason` is lost on a restart (`stage-08:26`).

**B3. The exactly-once resume checks only INBOX, but the sim server moves mail out of INBOX (stage 06 and stage 07 are `[risky]`).**
- `stage-06:35` checks "`hasMessageId` on its folder". `stage-07:39` checks "the run mailbox INBOX".
- The lab org runs in `assist` with `ACTIONS_SCOPE=all` (`stage-05:44`, `stage-02:59`), and the plan itself has the executive Undo "automatic moves out of the INBOX" (D10, `stage-08:22`).
- Example: the lab crashes after SMTP and before `inject_done`, and restarts more than about 2 min later (`MAIL_SYNC_EVERY_MIN` 2). By then the server has moved the spam or newsletter mail. The INBOX search misses, and the slot is sent a second time.
- Bot auto-replies (likely triaged as notifications) have the same risk.
- Decision needed: search every folder of the mailbox, or check the sim DB `emails` row by Message-ID. Add a test with a moved mail.

**B4. `start` writes the run before it takes the lock, so a refused second start leaves an active run (proven by plan text).**
- `stage-04:61`: "writes the run, takes the lock". `stage-10:29`: "Active run = a run folder without a `stopped` event".
- A second `start` for the same org gets `run_active` and leaves `runs/<id>/run.json`. `serve` then drives two runs for one org, and every count doubles.
- `stage-04` test 2 checks only `lock()`.
- Decision needed: lock first, or write `stopped` on refusal. Add a test: two `start` calls → one active run.

**B5. The $20 month cap (P4, "do not reopen") can be exceeded, and a run can stop without writing its ledger line.**
- `stage-04:62` refuses only at "≥ $20". A run that starts at $19.50 still gets a $5 cap. A lab week and a demo week (`stage-13:28`) can run at the same time, each with $5.
- The ledger line is written only at `finish` (`stage-10:37`), so the spend of active runs is invisible to `start`.
- `apps/server/src/scripts/eval-ledger.ts` already has `runCap({requested, monthSpent, monthCap})`, which clamps the run cap. The plan does not use it.
- `stage-04` does not name the ledger path. `stage-10:37` sets `<LAB_STATE_DIR>/eval-spend.jsonl`. `defaultLedgerPath` is under `$HOME/.local/state`, which is not on the volume. Stage 04 is built first and can read the wrong file.
- `stage-06:32` makes the injector append `stopped: budget` itself. The next serve tick skips a stopped run (`stage-10:29`), so `finish` never runs and no ledger line is written. Two parts write `stopped`.
- Decisions needed:
  - the cap is `min(request, 20 − month spend − caps of active runs)`;
  - one path for the ledger;
  - only `finish` writes `stopped`.

**B6. The env guard protects the `lab` process only. The `server` container, which polls Telegram and sends mail, starts with any `sim.env`.**
- D3 (`plan.md:72`) and `stage-02:45` describe the guard as a stack guard. D3's example is "a real bot token would steal the production bot's updates". The poller is `server`, not `lab`.
- At HEAD an empty `TELEGRAM_API_ROOT` means "the real Telegram" (`platform/config.ts:125`). With a real token and no root in `sim.env`, the `lab` refuses but `server` (`restart: unless-stopped`) polls production.
- Acceptance bullet 5 holds in its exact words, but the ticket outcome "No sim mail or tap can reach a real person" does not.
- Decision needed: run `checkSimEnv` before `main.ts` in the sim image or in the `server` and `fake-telegram` commands. Add a stage 03 test-3 guard that the `server` command runs it.

## TEST GAP

**T1. The stage 01 corpus test cannot hold (proven by a corpus probe).**
- `stage-01:69` says the count of `dd.mm.yyyy` forms within ±90 days equals "the number the function shifted".
- `stage-01:41` shifts every full date with no window, and `shifted` counts all forms (`:66`).
- Probe over `week/texts`: 528 `dd.mm.yyyy` within ±90 days, 9 outside (`04.02.2028`, `31.12.2027`, …). There are also 81 `d.mm` and 44 month-name forms (F3).
- Restate the test per form, or give `shifted` per form.

**T2. One Telegram message can hold buttons for many mails, but the plan models one mail per card.**
- `packages/core/src/digest/digest.ts:178-187` puts `fr:`, `fe:` and `fu:` buttons for every listed mail on one digest message.
- `ExecCard` (`stage-08:20`) has one `emailId` and one `moved`. Rule 8 and test 7 assume a card for one mail.
- Decide how the driver splits one message into one card per email id. Add a digest test.

**T3. Stage 08 rule 2 gives the wrong reject reason when no delegation was expected.**
- `stage-08:34` rejects every delegation draft whose recipient differs from `expectedDelegateAddress` with `reason_wrong_person`.
- For a mail whose truth is not `delegation`, `expectedDelegateAddress` is undefined. The tap then records "wrong person" instead of "not needed", and M3 inflates.
- Add the rule and a test.

**T4. After a fake restart, the chats stay dead, and runbook step 11 does not fix them.**
- The fake holds a chat only after a user message (`state.ts:252`, `hasChat`), and sends to an unknown chat fail with 400 (`server.ts:84-86`). The server never unlinks: grep found no "chat not found" handling in `channels`.
- `stage-05:36` makes a second `seed` check the link in the DB and add nothing. `stage-15:29` says "run `lab seed` again to link the chats".
- `stage-09:31` compares the newest id with the last seen id, but a missing chat reads as `[]` and the plan does not say what that means.
- Decide that seed checks the fake chat as well as the DB, and that a missing chat counts as a restart.

**T5. The expected outcomes in the delegates table ignore the tail length.**
- `stage-12:22` expects "≥ 1 reminder" for `late`, `out_of_office` and `silent`.
- Due is send time + 3 days (`actions/constants.ts:15`), and the chaser runs at 07:30 local (scout 3 §7).
- A day run (1-day tail) can never reach a reminder. In a week run, the day-7 delegations (3 slots: done 1, out_of_office 2) are due on day 10 after 07:30, and the next chaser run is after `tailEndsAt`.
- The table would flag planted mismatches. Make the expected outcome depend on whether `due_at` plus the next chaser run falls before `tailEndsAt`.

**T6. The M7 monthly figure is wrong for a range that is not 7 days.**
- `packages/core/src/metrics/m7.ts:43` computes `perMailboxMonthUsd = llmUsdWeek*30/7`. The range of `stage-12:19` is 11 days (week) or 2 days (day).
- `stage-12` test 6 passes, but the number is about 1.6× too high for a week run.
- Decide the normalisation, for example scale to 7 days, or report the week part only.

**T7. Skipped slots come back on every tick.**
- `stage-06:31` selects items "with no `inject_done`". `stage-06:36` writes no `inject_done` after a skip, so the slot is selected again on every tick.
- `LabEvent` (`stage-04:15-23`) has no event for the error count, so "the fifth error" cannot survive a restart.
- Test 8 would not catch it if the fake keeps failing. Add "and no `skip`" and an error event.

**T8. The tap resume rule covers only some buttons.**
- `stage-09:30` names approve, reject and Undo. It says nothing about `as:`, `rw:` and `ag:` taps, so a worker has to guess.
- Add the rule for each and a test.

**T9. The demo import keeps old ids inside JSON columns.**
- `audit_log.data->>'mailbox_id'` is what the M7 reader filters on (`audit/metrics-repo.ts:28`). `actions.payload.delegation_id` is another example (`core/triage/payloads.ts:47`).
- `stage-14:28` maps foreign-key columns only, and test 4 checks only those.
- The imported org shows no LLM cost, and its delegation links break. List the JSON id paths and test them.

**T10. Metrics from one run can leak into the next run on the same lab org.**
- The readers filter by mailbox and range only (`stage-12:19`). C2 (day run) and C4 (week run) use the same lab org (`plan.md:131`).
- Day-run delegations that fall due in the week range enter the week's M2. Their reminders reach week-run bots as `unmapped`.
- Decide: a fresh org per measured run, a minimum gap between runs, or filters on the run's emails. Status: plausible.

**T11. The env-guard cases leave out an unset Telegram root and auth mail.**
- `stage-02:59` says only "passes the loopback rule". An unset `TELEGRAM_API_ROOT` (= the real Telegram) must give `telegram_root_not_loopback`, and test 7 should name that case.
- There is no rule for `AUTH_SMTP_*`, a third path for outgoing mail (`platform/auth-mail.ts`).

**T12. The lab state volume is probably not writable (plausible).**
- `deploy/Dockerfile` ends with `USER bun`. A named volume on `/var/lib/ea-lab` (`stage-03:17`), a path that does not exist in the image, is created owned by root. The lab then gets EACCES at C1.
- Decide to create and chown the folder in `Dockerfile.sim`.

## NOTE

**N1. Two rules conflict.**
- `docs/code-patterns.md:276` says `reports/metrics.ts` "is the only service that joins the readers". `stage-12:20` calls the readers directly with its own range. `weekStats` accepts only a 7-day `weekStart`.
- Decide: add a range entry in `reports`, or record an exception.

**N2. Some interfaces are needed before the stage that defines them.**
- `LabCorpus` is defined in `stage-06:24`, but stage 11 (`stage-11:17`) runs "after 04" (`plan.md:143`).
- The choice of fake client is made in `stage-09:21`, but stage 05 uses the client first. `apps/server/package.json` does not depend on `@ea/fake-telegram`, and adding it changes `bun.lock`, which the ticket forbids.
- `checkSimEnv` (core) must use "the same rule" as `isLoopbackApiRoot`, which lives in `apps/server/src/platform/config.ts:49`. Packages may not import apps.

**N3. Runbook step 7 is wrong at HEAD (proven).**
- `stage-15:25` says the invite mail lands in GreenMail. `platform/auth-mail.ts:41-53` always uses TLS with a cert check unless the host is loopback, and `greenmail` is not loopback.
- Use auth mail off and `web:invite --print` (`deploy/README.md:195`).

**N4. Runbook step 3 can move the production image tag.**
- `stage-15:21` uses `ea-server:<sha>`, but production tags plain `ea-server` (`deploy/compose.yaml:34`).
- Building "as usual" for a later sim update moves the production `latest` tag. Use a sim-only base tag.

**N5. The demo export has two rules for secrets, and `--replace` breaks the transaction promise.**
- The column regex (`stage-14:25`) duplicates `EXPORT_MAP` `export: false` (`docs/code-patterns.md:171`). It also drops `triage_results.tokens_in` and `tokens_out` (`platform/db/schema.ts:492`).
- `--replace` deletes the org with `deleteOrganization`, which runs its own transaction (`privacy/delete.ts:46`). That conflicts with "any error leaves nothing" (`stage-14:35`).

**N6. Old messages become `unmapped` noise.**
- A new run starts with seen id 0, so the old cards in the reused chat count as `unmapped`.
- With lab and demo runs at the same time, both send delegations to the same three delegate inboxes. Each run then counts the other run's mail as `unmapped`.
- Start the seen id at the newest id when the run starts.

**N7.** `stage-08:44` says the longest gap is 16 h. The real longest gap is Sat 11:00 → Sun 10:00 = 23 h. It is still under 48 h.

**N8.** LLM calls with no price (`costPerMail` gives null, `triage/cost.ts:28`) count $0 toward the cap. Decide whether they refuse or stop the run.

**N9.** The report name doubles the mode: `sim-<date>-lab-01-day-day-20261127-xxxx.md` (`stage-11:34`).

**N10.** `LLM_DAILY_CAP` (300 calls per mailbox per Los Angeles day) is not decided in `sim.env.example`. A hit would show as `not_triaged`. Status: plausible.

**N11.** Stages 04, 07 and 09 are at the 700-word limit (`wc -w`). Most fixes above land there, so expect splits.

**N12.** The bot reply id `<r.<hex>@…>` (`stage-07:37`) could parse as a lab id unless `parseLabMessageId` checks the run-id format. Add that to `stage-02` test 1.

**N13.** A clarification reply to a delegate persona (4 delegate-sent slots in the corpus) is read as a delegation and counted `unexpected_delegation`, which feeds M3.

## Checks run
- `git rev-parse HEAD` → d1b1aa8752f49792fc86220223fbb088b12990c0.
- `git diff --stat 2e2451be..HEAD -- apps packages tools deploy db` → no output.
- Compose reproduction in `/tmp/f113rev`: `env_file: sim.env` with no file gives exit 1; with `--no-env-resolution`, exit 0; with `required: false`, exit 0.
- Corpus probe over `evals/sim/lab-01/week/texts`: 528 full dates inside ±90 days, 9 outside. The total of 537 matches F3.
- Corpus probe over the slots: delegate personas send 4 slots (urgent 3, info 1); no slot falls at 23:xxZ.
- `wc -w` on the plan and stages: plan 1,499 words; every stage ≤ 700 words.
- Not run: unit, integration and e2e suites. This review covers plan files only, and no candidate code exists.

## Note check
- HEAD is the candidate: proven. `git rev-parse HEAD` (a bash call by itself, exit 0) printed d1b1aa8752f49792fc86220223fbb088b12990c0.
- Each finding quotes a file and line, and facts I call wrong are checked against HEAD: proven. `/tmp/f113rev/review-final.md` gives a file and line for each finding. The code reads behind them are in this session's tool output. The compose reproduction files are `/tmp/f113rev/c.yaml` and `/tmp/f113rev/d.yaml`.
- First line `FAIL <sha>`, findings sorted BLOCKING / TEST GAP / NOTE: proven. `/tmp/f113rev/review-final.md`.
- Easy-to-miss rule ("Missing code detail … is not a finding"): followed. In `/tmp/f113rev/review-final.md`, each finding names a missing decision, edge case, test, interface, rule conflict or wrong fact. No finding asks for line numbers, edit text or file lists. This is my own check; no independent check confirms it.
