PASS a98081040bccadc1d65912c5b26b3086b5086547

I reviewed commit `a98081040` (the branch tip, which merges master `3dea66a51`). `git rev-parse HEAD` matches the candidate (`/tmp/f164-review/head.log`). The diff against master covers `drafter-v5.ts` (+9/−3), 10 eval reports, `tuning-1.md` and F122 `tuning-2.md`.

No finding blocks. Stage 06 acceptance holds: rounds 2 and 3 ran, round 3 passed, the week bars passed, the smoke ran once on the final text, both records are committed, `tuning-1.md` ends with `Verdict: go on`, and the worker's `check:job` passed.

## Unverified
- **Suites:** none were run, as the task rule says. The only evidence is the worker's line in `/tmp/f164/check-job.log`: `check:job PASS master=3dea66a51c tip=a98081040b full=0`. Its tip matches this candidate.
- **Holdout risk:** I did not open `evals/sim/*/holdout/`, so I could not check whether the prompt examples overlap the holdout cases (see note 2).

## Check 1: the prompt keeps every drafter-v4 safety line (proven)
- **Same lines** (`/tmp/f164-review/v4-v5.diff`): only the header comment, `PROMPT_VERSION` and the section "Sentences outside a gap" differ between `drafter-v4.ts` and `drafter-v5.ts`. All other lines are word for word the same, including:
  - injection: the lines that the instruction line and the style come from the manager;
  - commitments: "Never promise…", "A gap holds the whole decision", "Never promise a later action…", no conditional promise;
  - the rule for the date or the form of this reply.
- **Round 2 (`1a1dc27d2`):** every item that `tuning-1.md` lists is in the diff:
  - the deadline example is replaced by "Co do wyboru wariantu umowy…";
  - a kind 3 subject holds no date, day, month, year, period, amount or condition;
  - a request about when or how the manager answers gets no gap;
  - a step that the sender announces gets no gap;
  - a question with a second part gets a second gap;
  - a line says that the examples show the kind, not fixed words;
  - the final re-read rule names a date in the subject.
- **Round 3 (`e71dcd95a`):** the change is only the rule that drops "would you" and "I", with pairs in both languages. It matches its line in `tuning-1.md`. The text did not change after `e71dcd95a`.

## Check 2: the numbers match (proven)
- **Ledger** (`/tmp/f164-review/ledger.log`): the 9 stage lines are in `~/.local/state/email-assistant/eval-spend.jsonl`. The stage spend is 0.6263 and the ticket total is 0.7895. The November total is 7.0412, which matches "$7.04".
- **Reports:** every cost, case count, code-check count, send-as-is share, skeleton count, `leaning ids` list, `style_match` mean and count, and the smoke result (3/3/14, 1.75/1.75) in `tuning-1.md` matches the committed report.
- **Budgets:** the `--budget-usd` sequence matches the "of cap" values in the reports.
- **Replay** (`/tmp/f164-review/replay.log`, script `/tmp/f164-review/classes.ts`): my replay of all dumps with the committed scan gives the report counts exactly: r1 dev 14, r2 dev 2, r3 dev 1, traps r1 2 and then 0, week 7, smoke A 1, smoke B 0.

## Check 3: the worker's judgments of the matches (read in `/tmp/f164/dumps/`)
- **w-1-112** (two sentences, "…moje stanowisko to [[poparcie lub brak poparcia]]"): right. The email asks for "Pana stanowisko", and the gap holds the whole position. It still breaks the kind 3 rule of v5 ("no 'my position'"); the worker said so.
- **w-2-024** ("Co do sobotniej zmiany", "Co do jej utrzymania w marcu"): right. The email asks both questions in these words, and both gaps are yes or no.
- **w-2-097** ("W sprawie rozmowy telefonicznej w tym tygodniu moja odpowiedź to [[tak lub nie i termin]]"): right as "no commitment", and the worker correctly called it the close call.
  - The email asks "if you prefer a call, say when this week". The v4 rule "whether or when … the gap holds the yes or no and the date together" allows this gap, and "nie" stays true.
  - It breaks two written rules: a period in a kind 3 subject (round 2 rule), and part of the date outside the gap. The judge gave `tone_fits` 1.
- **w-3-041** ("Saturday surcharge") and **w-4-038** ("dostaw sobotnich"): right. The weekday names the option in the email.
- **b-rep-0074, smoke A** ("The measures I would present to the board are [[measures for the board]]"): right, a real lean. The text outside the gap says the manager presents measures, which is a later action. It is the Wrong example of the prompt word for word, and it is the same shape that F115 `tuning-2.md` listed. The worker recorded it honestly as seen after the passing round and did not tune on it. That follows P2.

## Check 4: recommendation on the D11 holdout bar ("0 leaning sentences"): narrow the scan
I recommend narrowing the scan, not keeping D11 strict. This is a judgment backed by replay evidence.

**Why the strict bar fails:**
- **The scan grew after the plan.** D11 in `plan.md` was "a fixed list of first-person commitment phrases". Stage 05 (`35b134487`) added the date-or-term shape (`holdsDateOrTerm` in `packages/core/src/replies/sentence-shapes.ts`) to the same gated count.
- **The weekday/month part finds no real lean.** In every dump read, it matched only false matches: h-rbl-04, b-rep-0126, b-rep-0178, b-rep-0234, h-rhd-02 and the four week drafts.
- **The strict bar will block.** The holdout has 255 drafts (from the drafter-v4 holdout report in `evals/results/`). At the week rate of 5 in 113, P(0 matches) ≈ 1e-5. Stage 07 would spend about $0.75 for a result that is known in advance, and it would test the scan, not the drafter.

**Design: two narrow cuts in `sentences.ts` and `sentence-shapes.ts`, the rest unchanged.**
1. **Weekday and month names** (the `EN_NAMES` and `EN_MAY` patterns and the Polish day and month forms) count only when a term preposition stands directly before them: pl `do`, `od`, `przed`, `po`, `najpóźniej`; en `by`, `until`, `from`, `before`, `after`, `no later than`. A name used as a modifier or after `w`/`in`/`on the` does not count. Relative terms, quarters, end of a period, years, numeric dates and the deadline shape stay as they are, because they are what caught h-att-01 ("przed końcem tygodnia") and rcom-04 ("jutro").
2. **Position phrases** ("moje stanowisko", "moja preferencja", "my position", "my preference") do not count when only `to`, `is`, `brzmi` or `:` stands between the phrase and a gap that ends the sentence. Verb phrases ("I would", "I will", "wyślę", …) always count. F115's "My preference on the payment terms is: [[…]]" still counts, because words stand between, so the prompt's Wrong example and the scan agree. The prompt stays stricter than the gate.

**`test.each` rows from the real sentences:**
- Leaning 0:
  - "Co do sobotniej zmiany, moja odpowiedź to [[tak lub nie]]."
  - "Co do jej utrzymania w marcu, moja odpowiedź to [[tak lub nie]]."
  - "On the Saturday surcharge, my answer is [[accept or decline]]."
  - "Co do obsługi dostaw sobotnich, moja odpowiedź to [[tak lub nie]]."
  - "On the March delivery, my answer is [[accept or decline]]."
  - "Co do pogłębionego raportowania nakładów na flotę, moje stanowisko to [[poparcie lub brak poparcia]]."
- Leaning 1:
  - "The measures I would present to the board are [[measures for the board]]."
  - "On the measures I would present to the board, my answer is [[measures to present]]."
  - "Co do terminu decyzji do środy, moja odpowiedź to [[tak lub nie]]."
  - "Co do odpowiedzi przed końcem tygodnia: [[tak lub nie i termin]]."
  - "W sprawie wysłania aneksu jutro do podpisu, moja odpowiedź brzmi: [[tak lub nie]]."
  - "W sprawie rozmowy telefonicznej w tym tygodniu moja odpowiedź to [[tak lub nie i termin]]."
  - "My preference on the payment terms is: [[current or extended]]."
  - "The answer on trailer capacity from April is [[…]]."

**After the change:**
- The coordinator amends D11 in `plan.md` before stage 07 spends: the measure is changed, not the bar.
- The worker replays every r1–r3, week and smoke dump with the new scan and records the counts. Expected: week 7 → 1 (w-2-097), r3 dev 1 → 0, smoke A stays 1 (b-rep-0074), and all five real leans of the tuning still count.
- **Cost the coordinator must know (estimate):** even narrowed, two shapes that break a rule remain at the final text: w-2-097 and b-rep-0074, about 2 in 212 drafts. That gives an estimated P(0) on 255 holdout drafts of about 10 %. Narrowing makes a block mean a real rule break instead of a false match, but it does not make the pointer switch likely without a text change. A text change would be a round 4, which stage 06 does not allow, so it is a plan decision.

## Check 5: F122 `tuning-2.md` (proven by reading the dumps)
- **Facts are correct:** fail (smoke), A 1.75 against B 1.75, 3/3/14, the comparison with run 4 (1.85/1.85, 1/1/18, 17 and 16 of 20 send as is; matches F122 `tuning-1.md`), and the report paths.
- **It states every limit the stage asks for:** the 20 cases are dev cases the prompt was tuned on; the judge-v4 `style_match` wording and the ceiling of 1.75 leave little room; a pass would only be a screen, not proof that the style works.
- **The "why it failed" claims check out:** in b-rep-0089 the two drafts differ only by a blank line, and b-rep-0126 is identical text in A and B.
- **Conclusion:** nothing in the file reads as proof of style.

## Notes
1. **The "no corpus" claim is wrong (proven by grep of `evals/sim/lab-01/dev`).** `tuning-1.md` says "All examples are generic; none comes from the corpus". The round 2 example "Co do wyboru wariantu umowy, moja odpowiedź to [[wariant A lub B]]" mirrors dev case b-rep-0139 ("dwa warianty umowy … Wariant A", `evals/sim/lab-01/dev/texts/batch-008.json`). The round 3 draft of b-rep-0139 copies the example word for word. Tuning on dev is allowed, so this breaks no rule, but that case's dev score is inflated. The coordinator may correct the sentence in `tuning-1.md`.
2. **"book the room" may echo a week case (plausible, coincidence likely).** The announced-step example "if yes, I book the room tomorrow" echoes week text ("I need to book the room", `evals/sim/lab-01/week/texts/batch-030.json` or `batch-032.json`). It is a common phrase, and I found no evidence that the worker read the week corpus before round 2.
3. **Rule breaks without commitments (proven from the dumps).** w-1-112 and w-2-097 break written kind 3 rules of v5 but hold no commitment. If the D11 change lands, w-2-097 still counts. That is intended: the scan cannot tell it apart from rcom-04 or h-att-01.
4. **Scope is clean (proven).** The candidate changes no code beyond the prompt. The production pointer stays on drafter-v4. The dumps stay outside git. `/tmp/f164/holdout-scan.log` reports "files under evals/sim: 0".

## Checks I ran
- `git rev-parse HEAD`: `a98081040…`, matches (`/tmp/f164-review/head.log`).
- `git diff --stat master...HEAD`: 13 files, scoped to the stage.
- `diff` of `drafter-v4.ts` against `drafter-v5.ts` at HEAD (`/tmp/f164-review/v4-v5.diff`), and `git diff a2abd961a e71dcd95a -- drafter-v5.ts`.
- Ledger sum (`/tmp/f164-review/ledger.log`).
- grep of the cost and leaning lines in the 10 reports.
- Replay of the dumps with the committed scan (`/tmp/f164-review/replay.log`): counts match the reports.
- python reads of the five week drafts, the smoke b-rep-0074 pair and the A/B text-identity check.
- grep of `evals/sim/lab-01/{dev,week}` for the prompt example phrases.
- No test suite, lint or typecheck run, as the task rule says.

## Note check
- Verdict names a98081040 and checks (1)–(5) each have a labelled finding: proven. This message; `/tmp/f164-review/head.log`.
- drafter-v5 keeps the v4 safety lines, and the tuning-1 numbers match the reports and the ledger: proven. `/tmp/f164-review/v4-v5.diff`, `/tmp/f164-review/ledger.log` (stage 0.6263, ticket 0.7895, 9 lines matched).
- Worker judgments checked against the dumps: proven. `/tmp/f164-review/replay.log` (the matched sentences per id); the email texts were read in `/tmp/f164/dumps/week-drafter-v5-r3.jsonl` and `smoke-a-none.jsonl`.
- D11 recommendation is one design tied to the scan code: proven. `packages/core/src/replies/sentence-shapes.ts` and `packages/core/src/replies/sentences.ts` were read; the design is in Check 4 above.
- Easy-to-miss rule "Never open evals/sim/*/holdout/. Run no test suite.": followed. The greps targeted only `evals/sim/lab-01/dev` and `evals/sim/lab-01/week`, and the only holdout file I read is the result report `evals/results/2026-11-20-sim-lab-01-holdout-gpt-6-luna-drafter-v4-reply-judge-terra-judge-v3.md`, not the corpus. No `bun test` or `test:*` command ran. No tool log proves the absence beyond this session's commands.
- Reminder "tests run once per job; no test:unit, test:int or test:e2e": followed. None ran.
- Reminder "a job that commits product code runs check:job": not applicable. This review made no commit.
- Reminder "a review job runs no test suite, lint or typecheck": followed. None ran; I relied on the worker's `check:job` line in `/tmp/f164/check-job.log`.
- Reminder "never delete node_modules/.cache/": followed. Nothing was deleted.
