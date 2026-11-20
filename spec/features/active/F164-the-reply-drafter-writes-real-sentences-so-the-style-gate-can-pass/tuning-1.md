# F164 · Tuning 1 (drafter-v5, dev round 1)

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
