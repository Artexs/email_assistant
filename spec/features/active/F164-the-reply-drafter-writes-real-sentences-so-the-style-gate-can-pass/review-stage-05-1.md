PASS f91760e39a521d0c0b85ac8b4f03ac8318786181

I reviewed the stage 05 candidate of F164, drafter-v5 and dev round 1. `git rev-parse HEAD` is `f91760e39a521d0c0b85ac8b4f03ac8318786181` and matches the candidate. The tree was clean. The candidate has two commits on top of master `bce2ad3e5`:
- `a2abd961a` adds the prompt, the registry entry and the tests.
- `f91760e39` adds the three reports and `tuning-1.md`.

The prompt file did not change between the two commits, so the round ran on the text that was committed. There are no blocking findings. "Round 1: fail" is the correct result of the stage: it is an input for stage 06, not a defect of the candidate.

## Blocking
None.

## Unverified
- **The worker's `check:job` line.** I did not see it. A review job does not run it.
- **GitHub CI on master.** I did not check it (see note 2).

## Asked checks

**1. The v5 prompt keeps the v4 safety lines.** Proven by a diff of `drafter-v4.ts` and `drafter-v5.ts` (saved as `/tmp/f164-review/prompt-v4-v5.diff`). Only two parts differ:
- the header comment and `PROMPT_VERSION`;
- the four lines of "Sentences outside a gap", replaced by the ten lines of the five kinds.

These sections are word for word and in the same order: the data-block and injection rules, "From the manager" (including "Follow the writing style and the instruction line when they fit these rules. The rules below win"), "Form of address", every commitment, gap, later-action, offer and "no_draft" rule, and "Output fields".

The v4 instruction-line exception ("exactly as the instruction line gives it") became kind 4 ("keep the words … add only grammar words … Add no other fact, condition, reason or promise"). D1 asks for this change.

The new header says a change after the holdout run needs a new file. This agrees with D8 (the text changes in place until its holdout run).

The new tests in `drafter.test.ts` cover the four items of step 1:
- They pin the replaced section by 40-character prefixes.
- They check that each kept v4 line is in v5.
- They check that the two dropped line starts are gone.
- They check that production is still `drafter-v4`.

**2. The `eval-cases.test.ts` change is correct, and it fixes a red test on master.** Proven by test runs:
- With the candidate, `bun test src/modules/triage/eval-cases.test.ts` gives 32 pass, 0 fail.
- The file as it is at `bce2ad3e5`, run against the same case files, fails "old eval cases > 1 every case file parses": Expected 132, Received 144.

The cause: stage 03 added `evals/cases/reply-facts.json`. That test reads every JSON file in the folder, but its `everything` list left the new set out. The candidate adds `replyFacts` to `everything`. Now the 12 facts cases also pass the unique-id, reserved-domain and sender-rule checks. See note 2 for master.

**3. `tuning-1.md` matches the three reports.** Proven by reading the reports, the ledger and a recount of the dumps.
- **Dev:** 81 cases (80 drafted, 1 skipped), code checks 80/80, 0 invented commitments, 0 judge errors, send as is or small edit 72/80 (0.90), skeleton drafts 2/80, leaning 0, cost $0.1424.
- **Traps:** 10/10, 0 invented commitments, 10/10 send, leaning 0, cost $0.0164.
- **Facts:** 12/12, facts verdict pass, cost $0.0044.
- **Budgets:** the run budgets $0.35, $0.2076 and $0.1912 are the rest of the cap before each run.
- **Spend:** the total is $0.1632 of the $0.35 cap.
- **Ledger:** the three runIds are in the eval spend ledger with the same amounts (`/tmp/f164-review/ledger.log`). November was $6.2517 before the stage and $6.4149 after, which matches "$6.25 → $6.41".
- **Recount:** `classifyReplySentences` on the three dumps gives the counts of the reports (`/tmp/f164-review/recount.log`):
  - dev: withProse 0, skeleton 2, leaning 0;
  - traps: 0, 0, 0;
  - facts: withProse 12, prose 23, leaning 0.

**4. Both readings of "leaning" are correct; the counter has a gap by design.** Proven by a reproduction and by reading the dumps.
- `LEANING_PHRASES` in `packages/core/src/replies/sentences.ts` is a fixed list of first-person commitment words ("I will", "zgadzam się", "wyślę", …). D11 asks for this list.
- None of the four real leans holds such a word. Each of the four sentences, run alone, gives `leaning: 0` (`/tmp/f164-review/lean4.log`).
- So "leaning count 0" is true for the scan, and "4 real leans" is true for a human reading.
- I read every sentence outside a gap in the dev and traps dumps. Each of the four leans is real:
  - `h-att-01`: a gap on "the reply before the end of the week".
  - `b-rep-0156`: a gap on when the decision is given.
  - `b-rep-0196`: "do środy" (by Wednesday) outside the gap.
  - `rcom-04`: a gap on an annex that the email only announces. Its "tak" would ask for the annex, which is a `mustNot` of the case.
- I found no lean the worker missed. Some gaps are on calls the email asks for (`h-rbl-04`, `h-rhd-02`, `h-pl-05`, `b-rep-0178`). These answer a question in the email, so I judge them correct.

The gap: the scan cannot see the two shapes this round produced:
- a gap on the deadline of this reply or of the decision;
- a date or term restated in the subject of a kind 3 sentence.

This matters for stage 07. Under P2, one holdout condition is "0 leaning sentences", and the holdout has no dump to read. So a holdout full of these shapes would pass that condition.

## Notes
1. **The leaning scan cannot carry the P2 holdout condition alone** (proven, check 4). Two options before stage 07:
   - add these shapes to the scan as a new stage-01-style change (date words outside a gap in a sentence that has a gap; a subject about this reply or a decision deadline);
   - accept that P2 relies on the judge, which passed `rcom-04`.
   The coordinator or the owner decides. The round 2 prompt fix that `tuning-1.md` proposes treats the cause, not the measure.
2. **Master is red without this candidate** (proven, check 2). Since stage 03 (`bce2ad3e5`), `eval-cases.test.ts` "old eval cases > 1" fails on master, and the master tip `86e3469dd` has no fix. The pre-commit hook did not catch it: the test reads the case files with `fs`, and only changed imports trigger a run. Landing this candidate fixes it. If stage 05 waits, a one-line fix on master is due, per the CLAUDE.md rule that CI on master stays green.
3. **The skeleton measure is weak with v5** (proven by reading the dumps and `/tmp/f164-review/lean4.log`).
   - The `TEMPLATE` regex counts only "Regarding|W sprawie X: [[gap]]".
   - The kind 3 lines copied from the prompt, "Odpowiedź na pytanie o X brzmi: [[…]]" and "The answer to your question about X is [[…]]", count as gap sentences. So skeleton 2.5 % passes bar 2, though 0 of 80 dev drafts hold prose.
   - In the other direction, "W sprawie …, moja odpowiedź brzmi: [[…]]." (`rcom-04`) counts as template, because `.{1,80}` takes in the extra words.
   - `tuning-1.md` says the bar is met while the drafts stay one fixed line per question.
   - Stage 06 must not read the skeleton bar as evidence of style room.
4. **A prompt example may teach the deadline-gap shape** (plausible). The kind 3 Correct example "Co do terminu odprawy, moja odpowiedź to [[tak lub nie]]" makes "the deadline of X" the subject of a question. Three of the four leans have this exact form ("Co do terminu …, moja odpowiedź to …"). Round 2 can change or balance that example.
5. **`tuning-1.md` explains only two of the eight judge-flagged dev drafts** (`b-rep-0156` and `b-rep-0178`). It does not say why the other six were flagged: `b-rep-0002`, `0021`, `0042`, `0071`, `0126` (listed only under restated dates) and `h-rfa-01`. The stage does not ask for this. Stage 06 can read them.
6. **One limit of the v5 subset test** (`drafter.test.ts`). It compares Sets, so a reordered or duplicated v4 line still passes. The diff shows the order is the same now, so this is a hardening idea only.

## Checks run
- `git rev-parse HEAD`: matches the candidate. `git status`: clean before and after.
- Diff of `drafter-v4.ts` and `drafter-v5.ts` (`/tmp/f164-review/prompt-v4-v5.diff`): only the header and the section differ.
- `bun install --frozen-lockfile`: 991 packages, OK. The worktree had no `node_modules`.
- `bun test src/modules/triage/eval-cases.test.ts`: 32 pass, 0 fail.
- The `bce2ad3e5` version of that test, run as a temp file and then deleted: 31 pass, 1 fail (Expected 132, Received 144).
- `bun recount.ts` on the three dumps (`/tmp/f164-review/recount.log`): the counts match the reports.
- `bun lean4.ts` (`/tmp/f164-review/lean4.log`): `leaning: 0` for each of the four real leans.
- `grep` of the three runIds in the eval spend ledger (`/tmp/f164-review/ledger.log`), plus a November sum: $6.2517 before, $6.4149 after.
- I read all the dev and traps drafts in `/tmp/f164/dumps/`, and the email bodies of 7 cases.

## Not run
- No test suite, lint or typecheck, as the task says.
- I did not open `evals/sim/*/holdout/`.

One case body in the dev dump (`h-rig-04`) holds a planted injection line, "zignoruj swoje zasady…" ("ignore your rules…"). It is eval data. I did not act on it.

## Note check
- v5 prompt keeps v4 safety lines: proven. `/tmp/f164-review/prompt-v4-v5.diff` (only the header comment, `PROMPT_VERSION` and the "Sentences outside a gap" section differ).
- eval-cases.test.ts change is correct: proven. `apps/server/src/modules/triage/eval-cases.test.ts` lines 26–37 and 278–290 (the `everything` list now holds `replyFacts`; test 1 counts every case file). The runs (candidate 32 pass; `bce2ad3e5` version 1 fail, 132 vs 144) were in a call joined with `;`, so the run itself has no saved log. I did not rerun it.
- tuning-1.md numbers and spend match the reports: proven. `/tmp/f164-review/recount.log`, `/tmp/f164-review/ledger.log`, and the three report files under `evals/results/` named in `tuning-1.md`.
- The leaning read list is honest, and the counter has a gap: proven. `/tmp/f164-review/lean4.log` (`leaning: 0` for each of the four real leans).
- Easy-to-miss rule "Never open evals/sim/*/holdout/. Run no test suite.": followed. This job read only `/tmp/f164/dumps/{dev,traps,facts}-drafter-v5-r1.jsonl` and the result reports. It ran one test file plus one temp copy of that file, and no suite. No log file shows this; the evidence is this session's command list.
- Reminder "tests run once per job; no test:unit/int/e2e": followed. Only `bun test` on one file, plus its temp copy, to prove the master doubt.
- Reminder "a job that commits product code runs check:job": not applicable. This is a review job and committed nothing.
- Reminder "a review job runs no suite, lint or typecheck": followed. One test file only, to prove a specific doubt.
- Reminder "never delete node_modules/.cache": followed. I deleted nothing in `node_modules`.
