FAIL b6d85180276fccbcd4e526233a165973e0aa14a8

This is a cold review of the F151 plan: the demo video and the docs screenshots come from the synthetic demo-week export. HEAD is `b6d85180`, which matches the candidate. The commit adds only plan files on top of the plan base `e8f6f2b1`. I ran no test suite, lint or typecheck, because this is a plan review. All evidence comes from reading the code at HEAD and the gate files in `evals/results/gate/`.

## Blocking

**B1 · A replayed delegation answer can never produce the step-6 send (proven by code reading, not run).**
- **Plan:** `stages/stage-01-replay-model.md:23` says: "Category, confidence and reason code come from the newest `triage_results` row … Other schema fields take their empty value (null, empty list)." So `fields.task` and `fields.clarification` are null.
- **Code:** `packages/core/src/triage/planners.ts:91` plans the delegation draft and send only `if (delegateId && delegateName && to && task)`. The clarification branch also needs a non-null `clarification`. Otherwise `planDelegation` returns `[]`.
- **Result:** the delegation mail of step 4 plans no `create_draft` and no `send`. The D7 wait "delegation send waiting with its Drafts copy" (`plan.md:29`) times out, and step 6 has nothing to approve. Acceptance bullet 1 (an MP4 with no not-live step) cannot hold.
- **Fix:** the seed has the data. `triage_results` exports `reason` and `fields` (`apps/server/src/modules/privacy/export-map/tables-t-z.ts:14-15`). The replay must return `fields` (task, clarification, due_date, language) and `reason` from the seed row. Stage 01 test 5 must assert a non-null `task`.

## Findings (not blocking)

**F1 · A replayed hard-rule row fails the product schema (proven conflict; impact depends on the seed).** `stage-01:23` says "A seed row of a hard rule (no model) is replayed too, with confidence 1". Those rows carry `reason_code` `blocklist`, `triage_error` or `llm_blocked` (`packages/core/src/triage/categories.ts:29`). The classifier schema accepts only `reasonCodes` (`packages/core/src/triage/analysis.ts:13`). That conflicts with stage 01 test 6 ("every 200 body parses"). Stage 02 candidates (`stage-02:36`) do not exclude these rows. If such a row is picked as a shadow mail, its triage fails silently: the replay counts a hit, but the product refuses the answer. The plan must decide: drop rule and error rows from the table and from the candidates, or map them.

**F2 · The undo pick ignores the gate threshold (plausible, strong).** At base the production prompt is `classifier-v2` (`apps/server/src/modules/triage/prompts/index.ts`, `prompts.classifier`). Its only gate file says `go` only for `info`, with `threshold: 0.95` (`evals/results/gate/classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json`). "Turn on recommended" stores that threshold (`apps/server/src/modules/trust/recommended.ts:69`). `decideCategory` turns a mail below it into `unsure` (`packages/core/src/triage/threshold.ts:9`). `stage-02:36` picks "the newest candidate in `recommended`" with no confidence check. An info mail at 0.70–0.94 becomes `unsure`, is not auto-moved to AI/Info, and the "undo mail moved" wait times out.
- Shadow and history picks need the same filter against B's default threshold of 0.7 (`packages/core/src/triage/settings.ts:8`).
- Stage 02 test 1 uses a `notification`/`spam` gate, which is the v3 file and not the running v2. Add a v2-shaped case with an info threshold of 0.95.

**F3 · The wait limits conflict with the Playwright test timeout (plausible, strong; arithmetic on code constants).** `apps/web/e2e/demo/demo.config.ts:33` sets `timeout: 10 * 60_000`. D7 (`plan.md:29`) allows 3 + 3 + 8 + 4 = 18 min of waits, plus 116 s of steps.
- An expected run without timeouts is about 10–11 min. The first sync takes up to 2 min, because the connect does not start a sync (`apps/server/src/modules/mail/connect.ts:238` runs only the history hook).
- The history check usually first hits `never_synced` and waits `HISTORY_RETRY_MS` = 5 min (`apps/server/src/modules/trust/history-queue.ts:26`). Then come the step-4 sync, triage, notifier and committer cycles.
- The plan must set the test timeout from the D7 budget. The styleguide lists "a longer timeout as a fix" under Avoid, so a worker will not change it without a decision.

**F4 · History mail is triaged as new mail, so D5 dates do not count (plausible; GreenMail behaviour unverified).** The first sync of a folder is `initial` and searches the last 24 h (`apps/server/src/modules/mail/sync.ts:29`, `:76`). `searchSinceIn` (`apps/server/src/modules/mail/imap/client.ts:396`) uses IMAP SINCE, which matches INTERNALDATE. `received_at` is INTERNALDATE (`apps/server/src/modules/mail/sync-run.ts:115`). Mail delivered by SMTP gets the delivery time as INTERNALDATE, so the shifted `Date:` header of D5 (`plan.md:27`) changes nothing.
- The first sync of B stores and triages all 20–60 history mails in shadow mode. Step 2 ("Activity filtered to B: the 4 mails") then shows 24–64 rows, all dated now.
- Decide: either deliver the history set by IMAP APPEND with an internal date, or accept the result and change the step-2 caption.

**F5 · Step 7 has two unchecked paths (proven preconditions; impact plausible).** `remindNow` refuses with `drafts_off` unless the mailbox is `assist` with `create_draft` on (`apps/server/src/modules/delegation/remind.ts:51`). It refuses with `not_open` unless the status is `sent` or `overdue` (`remind.ts:44`).
- D8 (`stage-02:38`) does not check the mode and switches of imported mailbox A, so step 7 can get 409 `drafts_off` on camera.
- The fallback, the step-6 delegation, is still in planning right after the Approve in step 6. D7 has no wait for its send to reach `sent`.
- Add both conditions to D8, and a D7 wait before step 7.

**F6 · The urgent notice in the public video can show an empty reason (plausible).** The urgent view carries `ai.reason` (`packages/core/src/notices/views.ts:99`). Stage 01 replays no `reason`, and the info `summary` is also null. Both are visible in steps 2, 5 and 8. B1's fix covers `reason`. For `summary`, decide its source: the seed `save_summary` action payload, or none.

**F7 · No test checks that the server uses the gate copy (missing test).** `loadGateEvidence` reads only files named `classifier-*.json` (`apps/server/src/modules/triage/evidence.ts:89`). The key must equal `runningEvidenceKey`: own endpoint, effort null, `promptParts` null for v2, host without the port (`evidence.ts:120-133`). `stage-02:39` gives two sources for the parts ("parts of the source" and "from the running-key builder"). Stage 02 test 9 checks only the copy's fields.
- Add one unit test that loads the written copy and checks the result of `globalEvidenceFor(loadGateEvidence(dir), runningEvidenceKey(llmRoleTable(loadConfig(demoServerEnv(...)))))`. Without it, a key or file-name mismatch shows up only in the stage-05 recording, as `no_global` and 409 `nothing_recommended`.
- Also say which file to copy when several match the model and prompt (use the `rank` order in `evidence.ts`).

**F8 · `assertLoopbackLlm` does not check the provider (pre-mortem: a call to a paid model; hardening).** `stage-04:14` and test 2 check only the `OPENAI_BASE_URL` host and the scope. Every role runs on `LLM_PROVIDER` (`apps/server/src/platform/config-llm.ts:222`). The server env includes the whole repo `.env` (`apps/web/e2e/env.ts`, `...runEnv()`), and that file can hold real provider keys. Assert `LLM_PROVIDER === "openai"` too, or better, assert that every role row of `llmRoleTable(loadConfig(env))` has endpoint `own` on a loopback host. Add a test case with `LLM_PROVIDER: "deepseek"`.

**F9 · Nothing proves the "no call to a non-loopback model host" acceptance (missing check).** Ticket acceptance bullet 2 says the run makes no such call. Stage 05 checks only `misses=0` from the replay. Add a check after the run: every `llm.call` audit row of the run has endpoint `own`, or the `hits` count equals the classifier calls. Also require `hits > 0`.

**F10 · The sync cadence is not pinned (plausible).** P5 and D7 assume a 2-min sync. `MAIL_SYNC_EVERY_MIN` (2, 3 or 5, `docs/capabilities/sync.md` rule 6; key in `.env.example:73`) comes from the developer `.env` through `runEnv()`. With 5 min, the 3-min first-sync wait fails. D3 should set `MAIL_SYNC_EVERY_MIN=2`.

**F11 · The Telegram chat shown on camera can hold unplanned notices (plausible; depends on the seed).** The re-gate job runs every 5 min (`docs/capabilities/trust.md:64`, rule 9). It pauses imported `auto` grants of mailbox A whose key is not the running key, and sends `autonomy_paused` to each linked owner. By then setup has linked the owner to chat 9 200 001, which step 5 shows. Q5 accepts only the welcome texts. Decide whether other notices in the chat are allowed, or clear the `auto` grants of A through the settings route during setup.

**F12 · The delegate-line parse ignores tags (proven code fact; impact depends on the worker).** The prompt line is `- <id>: <name> (<tags>)` (`apps/server/src/modules/triage/prompts/classifier-v2.ts:90`). `stage-01:24` and test 5 show only `- <id>: <name>`. A worker that matches exactly gets 500 `delegate_missing` for every delegate with tags. Add a test 5 case with tags.

## Notes

- **N1 · Rule conflict.** `stage-04:21` makes misses above 0 exit 1 `demo_replay_miss`. Stage 05's `uploadVerdict` has a `replay_miss` reason for the same run. State whether the verdict prints before the exit.
- **N2 · Rule conflict.** "The e2e video stays as it is now" (`stage-03:9`), but the cut rule applies to both sources. Any e2e gap of 1 s or more between cues changes the e2e video.
- **N3 · Stage 04 has no run (oversize risk for stage 05).** Stage 04 builds the setup (Telegram link, quiet hours, IMAP purge, SMTP delivery) but never runs it, because no export exists before C1. Its Done when ("e2e source behaves as before") has no Proof command. Every setup fault therefore lands in stage 05, which is already the eight-step spike plus two locked recordings and a docs edit. Consider a stage-04 run against a fixture seed exported in a test DB, or split stage 05.
- **N4 · Unstated C1 precondition.** The export must come from a sim run on the gate file's provider, model and prompt: `openai`, `gpt-6-luna`, `classifier-v2`. Otherwise D4 refuses with `demo_gate_missing` or `demo_prompt_mismatch`. The scouts note that the sim stack may run gemini or deepseek (`scouts.md:191`). Put this in C1.
- **N5 · Edge cases for stage 02 candidates.** Exclude mail whose sender equals mailbox B (`office@<domain>`): own-mail checks would skip it. Exclude mail with a null `from` or `subject`: the prompt prints `(unknown)` or `(no subject)`, so `replayKey` would not match.
- **N6 · Off-camera settings change.** `create_draft` is off by default and the switch to assist keeps it off (`packages/core/src/triage/settings.ts:14`, `:96`). The stage-05 fallback will always run. Move this from "Not verified" to a decision. The video then relies on a switch changed off camera.
- **N7 · Field with no empty value.** `language` must be `pl`, `en` or `other` (`analysis.ts:21`). "Empty value" does not exist for it; B1's fix (replay the seed `fields`) covers it.
- **N8 · Checked and correct at base.** These plan facts hold:
  - An own endpoint gets the dummy key and the one own model (`apps/server/src/platform/llm/providers/openai-env.ts`).
  - A loopback http URL is `own` (`apps/server/src/platform/llm/providers/endpoint.ts`), and `costPerMail` is 0 for `own` (`packages/core/src/triage/cost.ts:75`).
  - The v2 user prompt ends with "The email to classify:" and a `Subject:` line.
  - The history check reuses `triage_results` rows of the same model and prompt and counts reused items, so it does not end `no_history`.
  - The planned step seconds sum to 116.
  - `record.spec.ts` throws `demo_source_recording_not_built`.

## Checks run

- `git rev-parse HEAD` printed `b6d85180276fccbcd4e526233a165973e0aa14a8` (matches the candidate). `git show --stat` shows that the diff holds only the plan folder files.
- The gate file decisions were read with `python3 -I`. v2: info go at threshold 0.95, all other categories no-go, provisional. v3: notification go at 0.5, spam go at 0.9, provisional, `promptParts` `["list"]`.
- No test, lint, typecheck or recording ran (review job rule). Every runtime consequence above is labelled plausible unless the code path alone settles it.

## Note check

- **HEAD matches the candidate, and the first line is FAIL with the sha:** proven. `git rev-parse HEAD` (a standalone call; it printed b6d85180276fccbcd4e526233a165973e0aa14a8). The verdict is saved in `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-20-f151-plan-review-f5d64b10/review.md`.
- **Each finding quotes the plan and the code at base file:line (classifier prompt and schema, the openai own endpoint, the trust history check and evidence key, the demo import, demo:record, the sync cadence):** proven. Findings B1 and F1–F12 in `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-20-f151-plan-review-f5d64b10/review.md`.
- **Pre-mortem answered (gaps, rule conflicts, guess steps, unsourced facts, oversize stages, each labelled):** proven. Gaps: F2, F4–F7, F9–F11. Conflicts: F1, F3, N1, N2. Guess steps: F12, N7. Unsourced fact: N4. Oversize: N3. All are in `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-20-f151-plan-review-f5d64b10/review.md`.
- **Easy-to-miss rule (missing code detail is not a finding):** followed. Every finding in `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-20-f151-plan-review-f5d64b10/review.md` names a missing decision, edge case, test or interface. None asks for line numbers, edit text or file lists. This is a self-check; no tool proves it.
- **Reminder "tests run once per job; no test:unit, test:int or test:e2e while working":** followed. No test command ran in this session.
- **Reminder "a job that commits product code runs check:job last":** followed. It does not apply: this review job made no commit.
- **Reminder "a review job runs no test suite, lint or typecheck":** followed. None ran; only `grep`, `sed`, `cat`, `git` and one `python3 -I` read of the gate files.
- **Reminder "never delete node_modules/.cache":** followed. This session did not touch it.
