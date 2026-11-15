PASS 9d5aba42e60a085c15df3f41cf9e14a6c9c11533

No finding is blocking. This is a plan-only candidate: no stage is built, so no acceptance bullet can be proven broken yet. Fix notes N1–N6 before stages 03, 11, 13, 14 and 15 build. A Sonnet worker will not catch them on its own, and each one lets a bug through to the user.

Unverified checks: none needed. I ran no test suites, because the candidate changes only `spec/features/planned/F109-e3b-improve/*`, and no suite can tell this plan right from wrong.

## Pre-mortem: which stage lets the bug through

N1 · Stage 03 · plausible (design gap; the mechanism is in the plan text). Phishers can make themselves "known" by frequency.
- `stages/stage-03-suspicious-triage.md:15`: a sender becomes known with "≥ 3 mails in this mailbox in the last 90 days whose latest triage category is not `spam`".
- A known sender gets only `auth_fail` and `risky_attachment` (`stage-01:37`). So from the 4th mail on, `lookalike_domain`, `display_name_spoof`, `reply_to_mismatch` and `link_mismatch` go silent.
- The count does not leave out mail that was itself flagged. The flag matters most for exactly the phishing mail that the LLM did not call `spam`, for example `delegation` (holdout `phishing_delegation` 6/7, `evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v2.md:275`). Those are the mails that make the sender known.
- Stage 05 cannot see this. The sim known-set uses persona groups (`stage-05:15`), not the frequency rule.
- Fix: count only mail with `suspicious_reasons = '{}'`, or never let frequency suppress `lookalike_domain`. Add a test to stage 03: 3 earlier flagged `info` mails, then a 4th mail that is still flagged.

N2 · Stages 08/11 · plausible (mechanism proven by reading the code). Sim sender history is not real sender history.
- In the sim, `byCategory` is the persona group's ideal category mix (`packages/core/src/sim/history-gen.ts:23-80,125-133`, for example marketing `{spam:60, notification:40}`).
- In production, `byCategory` is the model's own past final labels (`stage-10:14`).
- So a dev win of the `history` part (`stage-09`) and the holdout ship (`stage-11`) measure a clean signal. In production, the history feeds back the model's own errors: F1 says `info → spam` is 38 of 243 (`plan.md:88`). Under the rule at `stage-08:36`, a sender wrongly labeled `spam` once stays `spam`.
- History is keyed on the unauthenticated From address. A spoofed known address inherits "rarely spam".
- No decision covers this mismatch. Two fixes are possible:
  - map the sim history through the first-run model labels, or
  - limit `history` to `corrections` plus counts that do not come from the model, and leave history out when `suspicious_reasons` is not empty.

N3 · Stage 14 · plausible (mechanism proven in code). An escalation-only failure stops all triage and uses up the daily cap.
- `stage-14:19`: "soft or config error → pause, the mail back to `pending`". The pause is process-global and covers all mailboxes (`apps/server/src/modules/triage/pause.ts:5`, `jobs.ts:68`).
- `service.ts:526` calls `deps.pause.reset()` after the first call succeeds. So with a bad `LLM_ESCALATION_MODEL` (403/404, config error), the pause never grows: each cycle is 5 min. The stuck mail repeats its classifier call each cycle.
- That is about 288 calls per day against `LLM_DAILY_CAP` 300 per mailbox (`docs/capabilities/triage.md:34`). The mailbox reaches the cap, and its urgent mail (which never needs escalation) waits until the next quota day.
- The config hint names the classifier model (`pause.ts:17`), so the operator is sent the wrong way.
- Missing decision: what a persistent second-call error does. Options:
  - a separate escalation pause that keeps the mail in INBOX as `unsure` and lets classifier triage go on, or
  - after N failures, keep the first answer with a no-hide result.
- Also missing: a test for a repeated config error of the second call (test 4 covers one soft error only).

N4 · Stage 15 · plausible (code read). The pause signal does not match the real pause.
- `latestLlmPause` is per organization (ctx) and treats a soft pause as over after 10 min (`apps/server/src/modules/audit/llm-pause.ts:8,28-33`).
- The real pause is global and doubles to 20, 40 and 60 min with no `llm.call` row in between (`pause.ts:23-24`).
- Two effects:
  - (a) For most of a long outage the detector sees "no pause", so the notice can be up to about 50 min late.
  - (b) An org whose mail did not trip the pause never sees one, even though its triage is stopped.
- `stage-15:32` test 8 ("Org B's pause does not make rows for org A's mail") writes (b) in as correct behaviour.
- Decide whether the pause source is global (process state or a provider-wide row), and change test 8 to match. The `since` value also slides after 2 h (`llm-pause.ts:10`), so the cap of 5 per pause (`stage-15:16`) resets in long outages. That needs a decision too.

N5 · Stage 13 (from 08) · plausible. The escalation runs measure a base prompt that is not production.
- `stage-08:45`: `--prompt-version` defaults to the production pointer, and "empty list = attachments only".
- After a v3 ship, the stage 13 command (`stage-13:7`) passes no `--prompt-parts`. So the first calls run `classifier-v3[]`, not `CLASSIFIER_V3_PARTS`, while `escalation-v1` is built on the production parts (`stage-12:30`).
- The D16 decision and the gate file would then rest on the wrong base. Decide that the default parts are `CLASSIFIER_V3_PARTS` when the pointer is v3, or pin both flags in the stage 13 command.

N6 · Board drift (E5b, E6a, E4-B) · proven by reading the files.
- `ticket.md:48` names `suspiciousReasonsOf` as the interface for E5b and E6a, and `stage-04:7` adds E4-B unsubscribe.
- None of these rows depends on E3b for the flag:
  - `docs/product/stage-2/05-execution-plan.md:54`: E6a builds after "E2a, E3a, E4-A, E5a, E7-T2".
  - `:55`: E5b builds after "E2a, E3a, E4-A, E5a".
  - `:49`: E4-B depends on E3b only for the urgency command.
- The `## Sequenced` sections of `spec/features/planned/F115-*`, `F116-*` and `F110-*/ticket.md` match those rows.
- So E6a can land first and draft replies to phishing mail. planner.md:36 requires the plan's final message to name this edit for the coordinator; the plan names none.
- Also: E5b's rule is per thread ("no follow-up for a phishing-flagged thread", `E05-open-loops.md:82`), but the reader takes email ids only (`stage-04:11`). Decide whether a thread-level reader is part of the interface.

## Holdout discipline and spend caps

N7 · Stages 11 and 05 · plausible (design). The second holdout run is tuned on the holdout.
- `stage-11:19`: after a holdout fail, "one dev-only change (… dropping one part, decided from the dev reports, never from the holdout report)". The dev reports already chose the parts in stage 09, so the only new information that starts or steers the change is which holdout rule failed.
- `stage-05:31` has the same pattern.
- This conflicts with `stage-13:25`, which rejects any second holdout run ("rejected: tuning the trigger on the holdout").
- Make one rule for the three stages. Recommendation: one holdout run for each decision. A fail ends the line for F109, and a fix goes to a later version with the next corpus.

N8 · Stage 11 ship rule · plausible (numbers proven from the report). The rule is close to a coin flip.
- Rule 2 (`stage-11:14`) is strict `K(v3) < K(v2)` with no noise margin, against one v2 run (the report says "results can change between runs", line 13). The dev rule asks for a margin of max(4, 2s) (`stage-09:27`). So v3 can ship to all orgs with K lower by 1.
- Rule 1 (`stage-11:13`) hangs on `info`. Its go is on the edge: 189 kept, 100.0% precision, Wilson lower bound exactly 98.0% (report, sim-gate table). One more info false positive turns it no-go.
- `stage-13:23` has the same edge.
- Add a margin to rule 2 (for example max(4, 2s) from stage 09). For rule 1, compare Wilson intervals, not the go/no-go label.

N9 · Spend caps · proven (arithmetic). One stage cap conflicts with its run budgets; another run count is unclear.
- Stage 11's run budgets add up to more than its stage cap: 2 × $0.60 + 2 × $0.30 = $1.80 > $1.50 (`stage-11:3`).
- `plan.md:118` says "if the stage cap … would pass, stop". A worker who reads that by budget stops before the second holdout run; a worker who reads it by actual spend goes on. Real costs are low (the v2 holdout cost $0.27, report line 15), so name which rule applies.
- `stage-09:20` says "Up to 4 more runs", but D12 allows at most 2 rewrites with one run each (`stage-09:28`), and the header says "at most 14 runs" while the listed runs add up to 9 + 2. Make these agree.
- The month cap check is fine: `--budget-usd` above $1 is accepted (`apps/server/src/scripts/eval-args.ts:166`, `runCap` in `eval-ledger.ts`).

## Stage 11 production switch

N10 · plausible. Nothing ties the parts list to the gate file.
- The gate-evidence test checks only the `classifier-${version}-` prefix (`apps/server/src/modules/triage/gate-evidence.test.ts:11-13`).
- `stage-11:36` test 2 compares the pointer with `CLASSIFIER_V3_PARTS`, its own constant. That test is circular.
- So a later edit of `CLASSIFIER_V3_PARTS` without `classifier-v4` passes CI silently. Record the parts in the gate file and test that they equal `CLASSIFIER_V3_PARTS`.

N11 · plausible. There is no real-mail check and no rollback decision after the switch, which has no flag (`stage-11:31`). The gap tool covers only `notification` and `spam`. Decide what real-mail signal (gap report, M1) triggers a revert to v2, and who reverts.

## Stage 14: trigger and second call

N12 · plausible. It is not clear which parts of the second answer win.
- `stage-14:15` says "Its answer passes `decideCategory` and wins". It does not say that `delegation` input, `reason`, `summary` and `confidence` also come from the second analysis.
- A first `spam` that becomes `delegation` needs `delegationInputOf(second)`, and stage 03's suspicious check must run on the final category.
- Add one test (second answer `delegation`, delegate picked from the second analysis).

N13 · plausible. The escalation reasoning effort is not decided.
- The role row falls back to the classifier `reasoningEffort` when `LLM_ESCALATION_REASONING` is unset (`apps/server/src/platform/config.ts:380`).
- The gate file name in `stage-13:23` fixes `none`, and O2 sets only the model (`plan.md:134`). Pin the effort in the eval and in O2 so that production matches the gate.

N14 · plausible. Nothing guards the escalation share in production. D16 measures a triggered share ≤ 30% on the sim (`stage-13:14`), but real Polish newsletters without `List-Id` would trigger. Only the daily cap limits spend, and the escalation calls count against it. Add an M7 tripwire or a stage 16 note.

## Tenant scope and private data

- Org scope is stated for every new reader (stage 03 test 9, stage 04 test 2, stage 10 test 5, stage 15 test 8), and the test-mail split is in stage 10 test 4. The history reader returns counts only (`stage-10:14`). I found no tenant hole.

N15 · Conflict · proven (text). The known-sender rule says two different things.
- `plan.md:74` (D4): "senders with ≥ 3 non-`spam` mails".
- `stage-03:15` and `questions.md:198`: "≥ 3 mails … whose latest category is not `spam`".
- Example: 3 spam mails then 1 info mail. D4 says not known; stage 03 says known. Stage 03 test 6 does not tell the two apart.

N16 · plausible. The rules miss some phishing patterns.
- Mail that spoofs the user's own address or `@<org domain>` counts as a known sender (`stage-03:15-16`), so it gets only `auth_fail`, which stays silent without a trusted header (N1 not verified, `plan.md:98`).
- `protectedNames` holds delegates and VIPs, not the user or executive name (`stage-03:18`), so a CEO-fraud display name is not caught.
- Say whether these are accepted limits (stage 16 page) or rules.

N17 · plausible. The sim and production use different known domains. Stage 05 adds the whole free-mail list to `knownDomains` (`stage-05:15`). Production adds a free-mail domain only from a known address (`stage-03:16-17`, test 8). So the stage 05 recall and false-positive numbers do not describe production for free-mail look-alikes.

N18 · plausible. The stage 05 target cannot tell good rules from bad ones.
- `evals/sim/lab-01/scenario.json` has one phishing persona (`billing@paliwa-fiota.test`). All 21 holdout phishing cases come from it, and stage 01 test 1 is that exact domain. Recall ≥ 90% (ticket acceptance line 28) holds for any working look-alike rule.
- Marketing mail with tracking links (link text `www.shop.pl`, link target a click-tracking host) fires `link_mismatch` for unknown senders (`stage-01:41`, no `isList` exemption). The sim probably has no such links, so the ≤ 2% false-positive target may not describe real mail.

## Steps a Sonnet worker cannot do without guessing

N19 · proven (text). Stage 02 test 7 cannot be done as written.
- `stage-02:33` asks the `EXPLAIN` output to name the new index. On a small test DB, Postgres usually picks a seq scan, so the assert needs `SET enable_seqscan = off` or a seeded table. The plan decides neither.
- `stage-02:37` "Done when" lists tests 1–6 only, so test 7's status is unclear.

N20 · plausible. Stage 11 needs `--prompt-parts` with an empty list when no part wins (`stage-09:30`), but `stage-11:9` does not say how to pass an empty list (`""`?).

## Stage size

N21 · plausible. Stage 04 is the largest. It spans a server reader, the Telegram urgent and digest renderers, core texts in two languages, the activity API schema and the web panel row (3 steps, 9 tests), which may not fit one 90-min job. Stages 03, 08 and 12 are dense but fit. All stage files are ≤ 700 words.

N22 · proven (`wc -w`). `plan.md` is 1515 words against the 1500 limit (`.agents/limen/planner.md:47`). `plan.md:172` states 1498, so the count is out of date.

N23 · proven. `ticket.md:37` lists the `[risky]` stages as "09, 11, 13 and 14". `plan.md:146` also marks stage 02 `[risky]`.

## Focus areas checked

- Spend caps: N9 (the month cap logic is sound).
- Holdout discipline: N7, N8.
- Stage 11 switch rule: N8, N10, N11.
- Stage 14 trigger and errors: N3, N12, N13, N14; the daily cap answer (Q11) matches `docs/capabilities/triage.md:34`.
- Tenant scope and private data: N1, N15, N16; no cross-org hole found.
- Later-ticket interfaces: N5, N6.
- Stage size: N21, N22.

## Checks run

- `git rev-parse HEAD && git status --short && test "$(git rev-parse HEAD)" = 9d5aba42… && echo HEAD_OK` → `9d5aba42e60a085c15df3f41cf9e14a6c9c11533`, clean tree, `HEAD_OK`.
- `git diff --stat b9261659..HEAD` → 20 files, all under `spec/features/planned/F109-e3b-improve/` plus `ticket.md`.
- `wc -w` → `plan.md` 1515.
- I read code to check facts: `eval-args.ts`, `eval-ledger.ts`, `pause.ts`, `audit/llm-pause.ts`, `service.ts` (cap, reset), `config.ts` (role rows), `gate-evidence.test.ts`, `prompts/index.ts`, `sender-history.ts`, `history-gen.ts`, `scenario.json`, the v2 holdout and gap reports, `docs/capabilities/triage.md`, the execution plan rows 15–22, and the F110/F115/F116 tickets.
- I ran no test suite (the candidate changes only plan files).

## Note check

- HEAD equals the candidate: proven. `git rev-parse HEAD && git status --short && test "$(git rev-parse HEAD)" = 9d5aba42e60a085c15df3f41cf9e14a6c9c11533 && echo HEAD_OK` printed `HEAD_OK`.
- Every finding quotes file:line and has a label: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-15-f109-plan-review-8b5a922f/final-message.md` (N1–N23).
- The eight focus areas are each checked: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-15-f109-plan-review-8b5a922f/final-message.md` § Focus areas checked.
- Easy-to-miss rule ("Missing code detail … is not a finding; a missing decision, edge case, test or interface is"): followed. In `final-message.md`, each of N1–N23 names a missing decision, a rule conflict, a test or an interface. None asks only for line numbers, edit text or file lists.
