FAIL 888dac70f645b70b5cf3ebe29aec11b9c3763076

HEAD matches the candidate (`git rev-parse HEAD` → 888dac70f…). The plan was written at plan base `b073f7ed3`. The candidate commits only add the F164 plan files, so the code below is the same as at that base. I did not open anything under `evals/sim/*/holdout/`.

## Blocking findings

**B1. Dev rounds 2 and 3 reuse the results of round 1 (proven by reading the code).**
- The plan's rule: `plan.md:33` (D8) edits `drafter-v5.ts` in place between rounds, and every run of a round uses the same command (`stage-04-drafter-v5.md:21`). The only `--fresh` rule says to resume without it (`plan.md:60`).
- What the code does: the state file name holds the model, the effort, the prompt version id and the run key, but no hash of the prompt text (`apps/server/src/modules/triage/eval-results.ts:117-139`, `scripts/lib/eval-drafter.ts:163,209-216`). On start, the eval loads every earlier result that needs no rerun (`eval-drafter.ts:250-252`).
- Effect: in round 2 the dev, traps, facts and both smoke runs draft 0 new cases. The `-r2` reports repeat the numbers of round 1. The dumps are empty: an earlier result holds no text (`eval-drafter.ts:254-255`), so the reading step at `stage-04:33` cannot happen.
- Why this can reach a user: stage 05 moves the production pointer only when `tuning-1.md` shows traps 10 of 10 and 0 invented commitments (`stage-05-holdout-gate.md` step 3, P2 at `plan.md:14`). That trap result can come from round 1, while round 3 changed the text and was never measured. The holdout judge cannot cover this gap (see N1).
- Fix: each new round runs with `--fresh`, and a resume of a killed run keeps the same command without `--fresh`. Name the two cases apart in the run rules. Or name a state file per round, but `--state` is refused for `--drafter`, so `--fresh` is the simple fix.

**B2. `factsVerdict` needs the draft body, but no result or state file holds it (missing interface, proven by reading the code).**
- The plan's interface: `stage-02-reply-facts-set.md:32` defines `factsVerdict(results, cases)`. Its tests are written with draft bodies, and `missing_fact` and `planted` read the body (`:36`).
- What the code holds: `DrafterCaseResult` has no body (`modules/replies/drafter-eval.ts:57-74`). The state file never holds text (`drafter-eval.ts:25-26,151`). The body exists only at run time, through `onDraft` (`eval-drafter.ts:268`). `injectionVerdict` works only because `leak` is computed at run time and stored as a boolean (`drafter-eval.ts:239`, `drafter-eval-scores.ts:173-180`).
- Effect: a worker must guess. One guess puts the body into the result, which breaks the no-text rule of the state file. Another computes the codes at run time, which the plan does not name. Also, a facts run that is killed and resumed has no body for the resumed cases.
- Stage 01 step 2 has the same wrong premise. It says "the counts come from the body the eval already keeps for a draft" (`stage-01-sentence-counter.md:38`), but the eval keeps no body.
- Fix: compute the facts code (and the `sentences` counts) in `runDrafterCase` from `result.body` plus the case's `mustHold`. Store them as optional fields of the result with no text. `factsVerdict` then reads only those fields. A resumed result without them counts as "not measured" and fails the run.

**B3. The failure order of `factsVerdict` makes `checks` impossible to reach, and test 5 contradicts the rule (proven by reading the code).**
- The plan's rule: `stage-02:33` says `no_draft` means "the outcome is not `draft`", and that code comes first in the order. Test 5 (`:45`) expects "code checks failed and no prose → `checks`".
- What the code does: a case that failed its checks after the retry has outcome `failed` with reasonCode `checks` (`drafter-eval.ts:221-232`, `drafter-eval-scores.ts:110`). So `no_draft` always wins over `checks`, and test 5 cannot pass as written.
- Fix: `no_draft` means outcome `no_draft`, `skipped` or `error`. `checks` means outcome `failed` with reasonCode `checks`. Or drop `checks` and say so.

## Unverified checks

- I ran no test suite, lint or typecheck. This is a plan review, and the reminders forbid them.
- No eval ran.
- The way the coordinator puts the key into a job environment stays unverified, as `plan.md:44` says.

## Notes

**N1. The holdout gate cannot see the main new risk (plausible, with a source).**
- F115 `tuning-2.md:29` records free sentences that lean toward a commitment, for example "My preference on the payment terms is: [[…]]" and "the measures I would present to the board are [[…]]". The judge passed them on dev and week.
- D1 kind 3 (`plan.md:23`) frees exactly the wording of the sentence around a gap.
- The only guard against that shape is the worker's own read of the dev, week and facts dumps (`stage-04:33,39`). A holdout run gives no dump, and its judge is blind to the shape. So the stage that would let such a sentence through on unseen mail is stage 05, and nothing in stage 05 looks for it.
- Proposal: the stage 01 counter already finds gap sentences that do not fit the template (`gapSentences`). Add a code scan of those sentences for verbs of agreement, position or later action ("I would", "my preference", "will", "podtrzymuję" and similar), counts only. Report it on the holdout run, and make 0 a P2 condition. This is a report measure, not the post-processor that D1 rejects.

**N2. The instruction path in production loses its "exactly as given" rule, and no judge checks the change (plausible).**
- v4 says the instruction exception is written "exactly as the instruction line gives it" (`drafter-v4.ts:62`). D1 says "their words are free" for every kind, kind 4 included (`plan.md:20,24`).
- Only production drafts get instruction lines, and the holdout has none. The only check is 12 synthetic cases, written by the same worker who tunes the prompt, with no judge (D3, `questions.md` 5).
- Proposal: keep "exactly as given" for kind 4, or add a judged facts run with a judge brief that names the instruction as allowed.

**N3. D2 and the stage 04 skeleton bar conflict (proven, by the text).**
- D2 (`plan.md:27`) says the counter is "a bar only on the facts set", with the reason "a mail with only open questions may need only gaps".
- Stage 04 sets skeleton drafts ≤ 20 % as a go-on bar on dev (`stage-04:36`) and on week (`:45`).
- Dev has no instruction lines, so v5 can meet that bar only with filler sentences of kinds 2, 3 and 5 on mails that need only gaps. Those sentences are the source of the v2 and v3 commitments.
- Also, the bar is easy to game. A 3-word thanks that is not one of the two fixed strings counts as prose (`stage-01:15`). "Co do …: [[…]]" counts as a gap sentence, so the draft is no skeleton (`stage-01:13-14`, `isSkeletonDraft`).
- Proposal: make it a reported number only, or a cap that stops v5 from moving back to skeletons, not a floor on prose.

**N4. The plan lets the ticket close without meeting acceptance bullet 1 (ticket drift).**
- `ticket.md:21` asks that the new gate file exists and passes.
- `plan.md:49` (Done when 1) and the `Verdict: stop` path in stage 05 close the ticket with no gate file, or with a failed one.
- The coordinator should file that outcome as dropped or failed, not as done, or the ticket should change its words.

**N5. Two spend rules conflict (proven, by the text).**
- P3 (`plan.md:15`): "A run that would cross a cap does not start; the stage stops and asks."
- Stage 04 (`stage-04:41`): "… or the cap → verdict `stop`; stage 05 does not run."
- `plan.md:59` sets `--budget-usd` to the rest of the cap. With that, a run starts and stops partway (exit 4) instead of "not starting".
- Pick one rule.

**N6. No rule covers a holdout run that stops at the stage 05 cap (a gap).**
- The plan's numbers: the holdout runs with a budget of at most $0.55 (`stage-05:10`). The v4 holdout cost $0.4329 (F115 `tuning-4.md:14`).
- v5 drafts are longer, so both drafter and judge tokens rise. All cost rows in stage 04 use v4 costs with no margin (`stage-04` table): 3 rounds × $0.26 + week $0.20 = $0.98 of the $1.10 cap.
- If the holdout run stops at $0.55 with no gate file, a resume needs spend over the cap. The stage file does not say whether that counts as "one use" (D9), whether to ask (P3), or how step 4 records it.

**N7. Smoke mode does not say where its case ids come from (missing interface, plausible).**
- Today `compare` takes `caseIds` from the holdout loader (`scripts/lib/eval-style-gate.ts:113-120,169-173`). With dev state files, a reuse of that path gives 0 pairs, and so `judge_stop`.
- The tests in stage 03 inject `deps.holdout`, so this bug would not show in tests.
- The judge-error share needs the per-run case count as its denominator. Test 7 implies 20 (`stage-03` test 7), but the interface does not name it.
- Proposal: in smoke mode, the ids are the needs_reply ids found in the A state file. Add a test that the holdout loader is not called.

**N8. The smoke result can mislead the owner (plausible).**
- The smoke runs every round on the same 20 dev cases (`stage-04` table), and its numbers are visible during tuning.
- The pass rule `wins > losses` passes on 1 win and 0 losses (D5, `plan.md:30`). F122 saw 19 of 20 B drafts change by noise alone (F122 `tuning-1.md:27`).
- judge-v4 scores `style_match` "as far as the draft rules allow … and the reply is short" (`judge-v4.ts:23`). So A already scores 1.85 out of 2, and longer v5 drafts may lose points for their length alone.
- Proposals: run the smoke only on the final text. Say that its result is not a tuning input. In the F122 `tuning-2.md` verdict, name the ceiling and the "short" clause, so a `pass (smoke)` does not read as proof that the style works.

**N9. Facts-set test gaps.**
- Test gap (proven by reasoning about the stated order): no case has prose and a `mustHold` token only inside a gap. Case 3 returns `no_prose` before the gap removal of `missing_fact` matters (`stage-02:43,47`). So the step "break the gap removal and see case 3 fail" passes when that code breaks.
- Rule conflict (plausible): `missing_fact` uses an exact whole-token match (`stage-02:36`), but D1 makes the words free. Polish case forms such as "do piątku" for "piątek", or a yes-word other than "tak", fail the bar on a correct draft.
- Gap: no rule freezes `reply-facts.json` after stage 02. A stage 04 worker could edit `mustHold` until the bar passes.
- Undefined term: "name token" in test 1 (`stage-02:23`).

**N10. The sentence split breaks on abbreviations (plausible, minor).**
- The split runs after any `.` that a space follows (`stage-01:12`). So "np. ", "godz. 10:00", "ok. " and "e.g. " split a sentence and add prose counts.
- This is a measure only, but it feeds the skeleton bar of N3.

**N11. The production switch can land during the F115 pilot (plausible).**
- The owner decision at F115 gate G1 (`docs/owner-decisions.md:846`) approved v4's numbers and called v4 drafts skeletons.
- `questions.md` 2 lets v5 reach the pilot from day one. The F115 pilot record (`stage-18-pilot.md` step 3) cites "the stage 02 report numbers", so the pilot evidence would describe a different drafter.
- Proposal: stage 05 step 4 also writes the live drafter version into the F115 pilot record, or the release waits until after the pilot.

**N12. Stage 04 is close to too big for one job (plausible).**
- It holds the prompt file, up to 3 rounds × 5 paid runs, a week run, a sentence-by-sentence read of about 200 drafts per round, and two record files, all behind a 180 s idle watchdog.
- Proposal: split the prompt step plus round 1 from rounds 2–3 plus week, with a coordinator check between them.

**N13. Facts the plan cites hold.**
- Bars: `drafter-eval-scores.ts:12-19`.
- The judge default is judge-v3 (`prompts/index.ts:207`).
- The pointer is v4 (`prompts/index.ts:200`).
- `--limit 20` takes the first 20 needs_reply cases, so it picks the same cases as F122 (`eval-drafter.ts:166`).
- The style file and the 4 drafter gate files exist.
- The month ledger: $6.25 of $20 in November, read from `~/.local/state/email-assistant/eval-spend.jsonl`, so the month cap does not block.
- The source "From scouts 1 and 5" (`plan.md:42`) names a scout 5 that does not exist in `scouts.md`. The fifth packet is the first-run "scout-4". This is a minor fix to the citation.

## Checks run

- `git rev-parse HEAD` → 888dac70f645b70b5cf3ebe29aec11b9c3763076, run alone and exit 0. `git diff --stat b073f7ed3 HEAD` → spec files only.
- Code reads: `drafter-v4.ts`, `judge-v4.ts`, `prompts/index.ts`, `drafter-eval.ts`, `drafter-eval-scores.ts`, `scripts/lib/eval-drafter.ts`, `eval-drafter-source.ts`, `eval-results.ts`, `style-gate.ts`, `scripts/lib/eval-style-gate.ts`, `eval-style-gate-args.ts`, and `capability-page.test.ts` (grep).
- Spec reads: F115 `tuning-2.md`, `tuning-4.md`, `stage-18-pilot.md`. F122 `tuning-1.md`, `stage-09-gate-run.md`. `docs/owner-decisions.md` (grep).
- A python sum of the November rows of the spend ledger → 75 rows, $6.2517.
- No tests, lint, typecheck or evals ran: a review job runs none.

## Note check

- HEAD is the candidate 888dac70f…: proven. `git rev-parse HEAD` ran alone in one bash call, exited 0 and printed 888dac70f645b70b5cf3ebe29aec11b9c3763076.
- Each finding quotes file and line, checked against the code and the tuning notes: not proven by a command. The evidence is the file reads named under "Checks run". Those calls joined commands with `;` or pipes, so they do not count as a proof command. Each cited line is in the files above, and a reader can check it.
- The final message starts `PASS <sha>`/`FAIL <sha>`, then blocking findings, unverified checks, notes with labels and checks run: not proven by a file. The evidence is this message itself.
- Easy-to-miss rule "Do not open evals/sim/*/holdout/": followed, but not proven by a command. No command in this job named a path under `evals/sim/*/holdout/`. The only holdout-related reads were code that names the loader (`eval-style-gate.ts`) and the listing of `evals/results/gate`.
- Reminder "tests run once per job; no test:unit/int/e2e while working": followed. None ran.
- Reminder "a job that commits product code runs `bun run check:job` last": does not apply. This review commits nothing.
- Reminder "a review job runs no test suite, lint or typecheck": followed. None ran.
- Reminder "never delete `node_modules/.cache/`": followed. The job did not touch it.
