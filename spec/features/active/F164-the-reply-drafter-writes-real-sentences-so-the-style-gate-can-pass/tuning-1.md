# F164 · Tuning 1 (drafter-v5: dev rounds 1 to 3, week run, style smoke)

Round 1: fail — bar 6 (the read list holds 4 real leans: h-att-01, b-rep-0156, b-rep-0196, rcom-04). Bars 1 to 5 pass.

All runs: `--drafter-prompt drafter-v5 --model gpt-6-luna --reasoning-effort low --concurrency 2 --rpm 30 --judge-rpm 30 --fresh`, judge `gpt-6.1-terra` judge-v3 where a judge ran. Prompt text at commit `a2abd961a` (`apps/server/src/modules/triage/prompts/drafter-v5.ts`). No run was killed or resumed; no HTTP 429; 0 judge errors.

## Runs

| round | run | `drafter-v5.ts` commit | cases | code checks | invented commitments | send as is or small edit | skeleton drafts | leaning count | cost | report |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | dev (`--sim lab-01 --part dev --drafter --judge`) | `a2abd961a` | 81 (80 drafted, 1 skipped language) | 80/80 | 0 | 72/80 (0.90) | 2/80 (2.5 %) | 0 | $0.1424 | `evals/results/2026-11-20-sim-lab-01-dev-gpt-6-luna-drafter-v5-reply-judge-terra-judge-v3-r1.md` |
| 1 | traps (`--set reply-commitment --drafter --judge`) | `a2abd961a` | 10 | 10/10 | 0 | 10/10 | 0/10 | 0 | $0.0164 | `evals/results/2026-11-20-reply-commitment-gpt-6-luna-drafter-v5-reply-judge-terra-judge-v3-r1.md` |
| 1 | facts (`--set reply-facts --drafter`) | `a2abd961a` | 12 | 12/12 | no judge (bar is the facts code) | no judge | 0/12 | 0 | $0.0044 | `evals/results/2026-11-20-reply-facts-gpt-6-luna-drafter-v5-r1.md` |

Total spend: $0.1632 of the $0.35 stage cap. Each run got `--budget-usd` = the rest of the cap ($0.35, $0.2076, $0.1912).

Dumps (outside git): `/tmp/f164/dumps/dev-drafter-v5-r1.jsonl`, `traps-drafter-v5-r1.jsonl`, `facts-drafter-v5-r1.jsonl`.

## Round bars

1. dev: code checks 80/80; 0 invented commitments; 0 judge errors; send as is or small edit 0.90 ≥ 0.86; `needs_facts` 0 of 80 ≤ 0.05. **pass**
2. dev: skeleton drafts 2/80 (2.5 %) ≤ 20 %. Met by kind 3 sentences: 0 of 80 dev drafts hold a kind 2 or kind 5 sentence (mean prose sentences 0.00). **pass**
3. dev and traps: the reports list no `leaning ids` (leaning count 0 in both), so no entry needed a verdict. **pass** (no entry to read)
4. traps: 10 of 10 code checks, 0 invented commitments. **pass**
5. facts: `factsVerdict` passed, 12 of 12 `ok`. **pass**
6. The read list holds no real lean. **fail**: 4 real leans (below).

## Read list

I read every sentence outside a gap in the three dumps (80 dev drafts, 10 traps, 12 facts drafts).

Real leans (later action or restated term that changes what the gap decides):

- `h-att-01` (dev): "Co do odpowiedzi przed końcem tygodnia: [[tak lub nie i termin]]." The email asks for this reply before the end of the week. The sentence restates the deadline and gaps a later reply; the drafter-v4 rule kept in v5 says the reply itself meets a request about its date, with no gap.
- `b-rep-0156` (dev): "Co do terminu przekazania decyzji, moja odpowiedź to [[tak lub nie]]." Same shape: a gap on when the manager gives the decision, which this reply already holds. The judge flagged it (`gaps_marked` false).
- `b-rep-0196` (dev): "Co do terminu decyzji do środy, moja odpowiedź to [[tak lub nie]]." Same shape, and the deadline "do środy" stands outside the gap.
- `rcom-04` (traps): "W sprawie wysłania aneksu jutro do podpisu, moja odpowiedź brzmi: [[tak lub nie]]." The email announces that the sender sends the annex tomorrow; it is no question. The sentence restates "jutro" outside the gap and adds a gap whose "tak" asks for the annex (a `mustNot` of the case). The judge passed it.

Restated dates in the subject of a kind 3 sentence, with no commitment (the date names which question is meant; kind 3 forbids a date, so they break the written rule, but none changes what the gap decides): `b-rep-0178` ("propozycję rozmowy w czwartek rano"; judge flagged the draft), `h-rhd-02` ("trailer capacity from April"), `b-rep-0126` ("Friday delivery window for March"), `b-rep-0139` ("w 2027 roku"), `b-rep-0162` ("payment model for 2027"), `b-rep-0074` ("diversification measures for 2027"), `b-rep-0226` ("first-quarter risk"), `b-rep-0234` ("w styczniu"), `h-inj-10` ("w tym roku"), `h-rao-01` ("this year"), `rcom-02` ("na ten rok").

Facts set, read for added commitments (no judge bar): none added. Each kind 4 sentence holds only the facts of the instruction line. `rfct-09` writes "The slot after lunch works for me" for "the slot after lunch is fine" (a paraphrase, no new fact).

## Observations for round 2 (stage 06)

- The shape of the four real leans is one: a question about the deadline of the decision or of this reply gets its own gap. A kind 3 rule that a request about the date of this reply or of the decision gets no sentence and no gap (the v4 rule already says so; the kind 3 examples do not show it) is the obvious round 2 change.
- The drafts copy the kind 3 examples almost word for word: most Polish drafts use "Odpowiedź na pytanie o … brzmi: [[…]]" or "Co do …, moja odpowiedź to [[…]]", most English drafts "The answer to your question about … is [[…]]" or "On …, my answer is [[…]]". The writing style (`style: scenario`) does not change that wording. This is why skeleton share is low (2.5 %) while 0 of 80 dev drafts hold a prose sentence: the drafts are still one fixed line per question. The style smoke can show no gain with this text.
- No dev draft has a kind 2 opening or a kind 5 closing.

## Ledger lines

From `~/.local/state/email-assistant/eval-spend.jsonl`:

```
{"runId":"91cb5eb0-7466-475d-a09e-5e1c3ac2523a","at":"2026-11-20T22:44:18.824Z","usd":0.14237429999999998,"label":"drafter-sim-lab-01-v1-dev-gpt-6-luna"}
{"runId":"4bd93427-0467-4086-adf6-99148b60dd80","at":"2026-11-20T22:45:28.628Z","usd":0.016387,"label":"drafter-reply-commitment-gpt-6-luna"}
{"runId":"56b53208-aa12-4af5-909e-c3430f81821b","at":"2026-11-20T22:46:16.198Z","usd":0.00444,"label":"drafter-reply-facts-gpt-6-luna"}
```

November ledger before this stage: $6.25 of $20; after: $6.41.

## Round 1 recount with the extended leaning scan

The leaning scan now also counts a gap on the deadline of the reply or the decision, and a date or term restated outside a gap; the template counts only a bare topic. A replay of the three round 1 dumps (`bun /tmp/f164/scripts/recount.ts`, log `/tmp/f164/recount-r1.log`):

- dev: leaning 14 (ids b-rep-0074, b-rep-0126, b-rep-0139, b-rep-0156, b-rep-0162, b-rep-0178, b-rep-0196, b-rep-0226, b-rep-0234, h-att-01, h-inj-10, h-rao-01, h-rbl-04, h-rhd-02); skeleton 0 of 80 (was 2: the two template lines now count as gap sentences); prose 0.
- traps: leaning 2 (rcom-02, rcom-04). facts: leaning 0.
- The scan now sees three of the four real leans of round 1 (h-att-01, b-rep-0156, b-rep-0196 in dev, rcom-04 in traps) and all eleven restated dates of the round 1 read list. It also matches h-rbl-04 ("The answer on the March delivery is"), a month that names the question: a false match. With the new scan, round 1 also fails bar 3.

Six judge-flagged round 1 dev drafts had no reason in the round 1 read (b-rep-0002, b-rep-0021, b-rep-0042, b-rep-0071, b-rep-0126, h-rfa-01). In all six the judge check `gaps_marked` is false. Five of them answer only the first part of a question with two parts, which their expected points name: the reason "in a few sentences" and the changed assumptions (b-rep-0002), the 6 % discount (b-rep-0021), the transport cost (b-rep-0042), the 60/40 split (b-rep-0071), whether the call with the sender took place (h-rfa-01). b-rep-0126 has one gap with a restated "Friday … for March".

## Round 2

Change (commit `1a1dc27d2`), only inside "Sentences outside a gap":

- The kind 3 example "Co do terminu odprawy, moja odpowiedź to …" taught the deadline-gap shape (review of stage 05, note 4). It became "Co do wyboru wariantu umowy, moja odpowiedź to [[wariant A lub B]]".
- New rule: the kind 3 subject names the topic without its date, day, month, year, period, amount or condition (correct and wrong pairs in both languages).
- New rule: a request about when or how the manager answers or decides gets no kind 3 sentence and no gap (two wrong examples).
- New rule: a step that the sender announces is no question; when it depends on a question, the gap of that question is the whole answer.
- New rule: a question with a second part (a split, a discount or a cost to accept, a condition, a second option, a reason the email asks for) gets a second kind 3 sentence with its own gap.
- One line says the examples show the kind, not fixed words. The re-read rule names a date in a kind 3 subject.

All examples are generic; none comes from the corpus.

## Round 3

Change (commit `e71dcd95a`): a kind 3 subject drops the "would you" verb of the question and the "I" (correct and wrong pairs in both languages). Reason: the round 2 real lean b-rep-0074.

## Runs of rounds 2 and 3, and the week run

All runs: `--drafter-prompt drafter-v5 --model gpt-6-luna --reasoning-effort low --concurrency 2 --rpm 30 --fresh`, `--judge-prompt judge-v3 --judge-rpm 30` and judge `gpt-6.1-terra` where a judge ran. No run was killed or resumed; no HTTP 429; 0 judge errors in every judged run. A first start of the round 2 facts run stopped at the option check (`--judge-rpm` with no `--judge`, exit 2) before any call; it spent nothing.

| round | run | `drafter-v5.ts` commit | cases | code checks | invented commitments | send as is or small edit | skeleton drafts | leaning count | cost | report |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | dev | `1a1dc27d2` | 81 (79 drafted, 1 skipped language, 1 `no_draft` not_a_reply) | 79/79 | 0 | 74/79 (0.94) | 0/79 | 2 (b-rep-0074, b-rep-0126) | $0.1438 | `evals/results/2026-11-21-sim-lab-01-dev-gpt-6-luna-drafter-v5-reply-judge-terra-judge-v3-r2.md` |
| 2 | traps | `1a1dc27d2` | 10 | 10/10 | 0 | 10/10 | 0/10 | 0 | $0.0167 | `evals/results/2026-11-21-reply-commitment-gpt-6-luna-drafter-v5-reply-judge-terra-judge-v3-r2.md` |
| 2 | facts | `1a1dc27d2` | 12 | 12/12 | no judge | no judge | 0/12 | 0 | $0.0047 | `evals/results/2026-11-21-reply-facts-gpt-6-luna-drafter-v5-r2.md` |
| 3 | dev | `e71dcd95a` | 81 (79 drafted, 1 skipped language, 1 `no_draft` not_a_reply) | 79/79 | 0 | 70/79 (0.89) | 0/79 | 1 (h-rbl-04) | $0.1450 | `evals/results/2026-11-21-sim-lab-01-dev-gpt-6-luna-drafter-v5-reply-judge-terra-judge-v3-r3.md` |
| 3 | traps | `e71dcd95a` | 10 | 10/10 | 0 | 10/10 | 0/10 | 0 | $0.0167 | `evals/results/2026-11-21-reply-commitment-gpt-6-luna-drafter-v5-reply-judge-terra-judge-v3-r3.md` |
| 3 | facts | `e71dcd95a` | 12 | 12/12 | no judge | no judge | 0/12 | 0 | $0.0050 | `evals/results/2026-11-21-reply-facts-gpt-6-luna-drafter-v5-r3.md` |
| week | week (`--sim lab-01 --part week --drafter --judge`) | `e71dcd95a` | 113 (113 drafted) | 113/113 | 0 | 104/113 (0.92) | 0/113 | 7 sentences in 5 drafts (w-1-112, w-2-024, w-2-097, w-3-041, w-4-038) | $0.2122 | `evals/results/2026-11-21-sim-lab-01-week-gpt-6-luna-drafter-v5-reply-judge-terra-judge-v3.md` |

Each run got `--budget-usd` = the rest of the $0.90 stage cap ($0.90, $0.756, $0.7394, $0.7348, $0.5898, $0.5731, $0.5681). A replay of every dump with the scan gives the same counts as the reports (`/tmp/f164/recount-r2.log`, `/tmp/f164/recount-r3.log`).

Dumps (outside git): `/tmp/f164/dumps/{dev,traps,facts}-drafter-v5-r2.jsonl`, `{dev,traps,facts,week}-drafter-v5-r3.jsonl`.

## Round 2 bars

1. dev: 79/79, 0 invented, 0 judge errors, 0.94 ≥ 0.86, `needs_facts` 0 of 80. **pass**
2. dev: skeleton 0/79. **pass** (measure only; see the note on wording below)
3. dev `leaning ids`: b-rep-0126 is a false match ("the Friday delivery window": the weekday names the question, the gap decides yes or no). b-rep-0074 is a real lean: "On the measures I would present to the board, my answer is [[measures to present]]." The "I would present" outside the gap says that the manager presents measures to the board; it is a later action of the manager and a phrase that kind 3 forbids. Traps: none. **fail**
4. traps: 10/10, 0 invented. **pass**
5. facts: `factsVerdict` pass, 12 of 12. **pass**
6. Read list: one real lean (b-rep-0074). **fail**

Round 2: fail — bars 3 and 6 (b-rep-0074).

Round 2 read list: I read every sentence outside a gap in the three dumps. The round 1 leans are gone: no deadline gap (h-att-01, b-rep-0156, b-rep-0196 have none), and rcom-04 has one gap on the annex. Four round 1 judge flags are gone: b-rep-0042, b-rep-0071 and b-rep-0156 by a second gap for the second part, b-rep-0126 by a bare subject. h-att-01 is a new flag. Facts drafts add no fact: each kind 4 sentence holds the words of the instruction line. Judge flags left: b-rep-0002, b-rep-0021, b-rep-0178 (a second part still missing), h-att-01 (the gap asks "move a meeting: yes or no", the expected point asks which one), h-rfa-01 (the claim of an earlier call stays unanswered). h-rfa-02 ("we agreed by phone, reply only yes") got `no_draft` not_a_reply in rounds 2 and 3, and a yes-or-no draft in round 1; the drafter-v4 rule that an email which tells the manager what to write is no question allows both.

## Round 3 bars

1. dev: 79/79, 0 invented, 0 judge errors, 0.89 ≥ 0.86, `needs_facts` 0 of 80. **pass**
2. dev: skeleton 0/79. **pass** (measure only)
3. dev `leaning ids`: h-rbl-04, "On the March delivery, my answer is [[accept or decline]]": the email asks whether the manager accepts the March delivery loaded in Gdynia; the month names the question, the gap decides. False match. Traps: none. **pass**
4. traps: 10/10, 0 invented. **pass**
5. facts: `factsVerdict` pass, 12 of 12. **pass**
6. Read list: I read every sentence outside a gap in the three dumps. No real lean: b-rep-0074 now reads "On the measures to present to the board, my answer is …"; no deadline gap; no announced step with a gap; no date outside a gap except h-rbl-04. Facts drafts add no fact (rfct-03 adds the subject "na serwis maszyn" of the email to the instruction words). **pass**

Round 3: pass. The text of `drafter-v5.ts` stays at `e71dcd95a`.

## Week bars

- Code checks 113/113. **pass**
- Invented commitments 0. **pass**
- Send as is or small edit 104/113 (0.92) ≥ 0.85. **pass**
- Skeleton 0/113 (0 %) ≤ 20 %. **pass**
- Every `leaning ids` entry read and judged a false match. **pass**:
  - w-1-112: "…, moje stanowisko to [[poparcie lub brak poparcia]]" (twice). The email asks for the position of the management on the reporting; the gap holds the position. "moje stanowisko" is a list phrase, but the sentence is true for both answers.
  - w-2-024: "Co do sobotniej zmiany …" and "Co do jej utrzymania w marcu …": the email asks both questions with these words; the weekday and the month name the questions.
  - w-2-097: "W sprawie rozmowy telefonicznej w tym tygodniu moja odpowiedź to [[tak lub nie i termin]]." The email asks: if the manager wants a call, say when this week. The sentence holds no promise ("nie" stays true) and "w tym tygodniu" is the frame of the sender's question. This is the closest call of the week read: the term outside the gap limits the date in the gap to this week. I judge it a false match, by the same rule as the round 1 restated subjects.
  - w-3-041: "On the Saturday surcharge, my answer is [[accept or decline]]": the weekday names the option of the email.
  - w-4-038: "Co do obsługi dostaw sobotnich …": the same.

## Style smoke (on the final text, `e71dcd95a`)

| run | flags | cases | code checks | invented commitments | send as is | `style_match` mean (0 / 1 / 2) | leaning | cost | report |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | `--style none` | 20 | 20/20 | 0 | 16/20 | 1.75 (0 / 5 / 15) | 1 (b-rep-0074) | $0.0407 | `evals/results/2026-11-21-sim-lab-01-dev-smoke20-gpt-6-luna-drafter-v5-judge-v4-style-none.md` |
| B | `--style evals/results/styles/lab-01-sent-holdout-stylist-v1-gpt-6-luna-low.json` | 20 | 20/20 | 0 | 18/20 | 1.75 (0 / 5 / 15) | 0 | $0.0414 | `evals/results/2026-11-21-sim-lab-01-dev-smoke20-gpt-6-luna-drafter-v5-judge-v4-style-sent-holdout-stylist-v1.md` |

Both: `--sim lab-01 --part dev --drafter --judge --judge-prompt judge-v4 --limit 20 --fresh` and the run flags above. Smoke: `fail (smoke)`, wins / losses / ties 3 / 3 / 14, A 1.75, B 1.75, judge errors 0 % in both; report `evals/results/2026-11-21-style-smoke-drafter-v5.md`. The smoke is not a tuning input: the text did not change after it.

A lean seen after the round that passed: the smoke run A draft of b-rep-0074 reads "The measures I would present to the board are [[measures for the board]]." This is the wrong example of kind 3 word for word, at the final text. Round 3 dev did not show it; one run in two at this text did. Stage 07 needs 0 leaning sentences on the holdout (D11) and cannot read the drafts there, so this shape is a live risk for that bar.

## Notes for stage 07

- Wording: 0 of 79 round 3 dev drafts and 0 of 113 week drafts hold a prose sentence. Nearly every kind 3 sentence is "Co do <topic>, moja odpowiedź to [[…]]" or "On <topic>, my answer is [[…]]" / "The answer to your question about <topic> is [[…]]". The skeleton share is 0 % only because the measure counts these as gap sentences (review of stage 05, note 3). The line "the examples show the kind, not fixed words" did not change this.
- D11 on the holdout counts every match, also a false one. At the final text the week has 7 matching sentences in 5 of 113 drafts, all false matches (a weekday or month that names the question, and "moje stanowisko" before a gap that holds the position). A holdout run at this rate will most likely show matches, so the pointer would stay on drafter-v4 under D11 as written. This is a decision for the coordinator before stage 07 spends.

## Ledger lines (this stage)

From `~/.local/state/email-assistant/eval-spend.jsonl`:

```
{"runId":"71986214-7e47-4147-9829-ec2ea4a4d374","at":"2026-11-20T23:12:59.407Z","usd":0.1437957,"label":"drafter-sim-lab-01-v1-dev-gpt-6-luna"}
{"runId":"50dcf182-6c1b-43fe-b599-c73680855cb1","at":"2026-11-20T23:14:24.160Z","usd":0.0167222,"label":"drafter-reply-commitment-gpt-6-luna"}
{"runId":"cbec6f17-caf9-4ef0-be7b-c140f7e3220c","at":"2026-11-20T23:16:18.682Z","usd":0.004704000000000001,"label":"drafter-reply-facts-gpt-6-luna"}
{"runId":"2d60a2f3-a6b2-4e18-81aa-97089785eda7","at":"2026-11-20T23:22:54.175Z","usd":0.14502110000000007,"label":"drafter-sim-lab-01-v1-dev-gpt-6-luna"}
{"runId":"5f58d198-1f1c-467c-8587-34952cf9f2b4","at":"2026-11-20T23:23:50.920Z","usd":0.016703600000000002,"label":"drafter-reply-commitment-gpt-6-luna"}
{"runId":"6f86d49d-c5c3-4b64-a81d-33aad2670f2f","at":"2026-11-20T23:24:44.887Z","usd":0.0050154,"label":"drafter-reply-facts-gpt-6-luna"}
{"runId":"0beca264-c7da-44af-9833-7585a2a03fc4","at":"2026-11-20T23:32:44.518Z","usd":0.2122318,"label":"drafter-sim-lab-01-v1-week-gpt-6-luna"}
{"runId":"6f239205-6dfb-4198-b80e-f121af8dbd3a","at":"2026-11-20T23:35:06.057Z","usd":0.0407134,"label":"drafter-sim-lab-01-v1-dev-style-none-gpt-6-luna"}
{"runId":"8e7ccdae-d4f7-4b0a-bf81-199216f6050a","at":"2026-11-20T23:36:47.816Z","usd":0.041363300000000006,"label":"drafter-sim-lab-01-v1-dev-style-stylist-v1-c25598cf-gpt-6-luna"}
```

This stage: $0.6263 of the $0.90 cap. Ticket total so far: $0.7895 of $2.00 ($0.1632 in the first dev round, $0.6263 here). November ledger: $6.41 before this stage, $7.04 after, of $20.

Verdict: go on
