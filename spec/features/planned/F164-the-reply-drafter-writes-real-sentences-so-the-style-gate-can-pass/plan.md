# F164 · Plan

> **Status 2026-11-20 — planned.** Plan base: `b073f7ed3`. Five stages; 04 and 05 spend on the shared OpenAI key.

## Input

Ticket words (word for word): "A reply draft holds full sentences where the manager's facts are known, not only a greeting and one placeholder line per question." "Keep every existing safety check: no invented commitments, placeholders for unknown answers, the draft never sends itself." "Rerun the style A/B on dev cases and write the result next to `tuning-1.md` of the earlier style ticket." Out of scope: "Turning on `style_from_sent` or `reply_drafts` for any organization." "Changing the style suggestion code or the judge." Notes: "About $1 to $2 of model runs; use the VPS key in the job environment only, as before."

Sources: F115 `tuning-1.md` to `tuning-4.md` in `spec/features/active/F115-e6a-reply-drafts/` (why v4 is a skeleton), F122 `tuning-1.md` in `spec/features/done/2026-11/F122-e6b-style-from-sent/` (the failed smoke), `scouts.md`.

### Product

- **P1.** "Known facts" are what the drafter really gets: the manager's instruction line and what the mail is about. No new input (calendar, contacts) is added (`reply-drafts.md` rule 4).
- **P2.** drafter-v5 becomes production `prompts.drafter` only with gate `"passed": true`, injection 14 of 14 and 0 invented commitments on the traps; also when the style smoke fails (full sentences are the first outcome). Else drafter-v4 stays. (default, owner to confirm; `questions.md` 1)
- **P3.** At most $2.00 in the ledger: stage 04 $1.10, stage 05 $0.60. A run that would cross a cap does not start; the stage stops and asks. (default; `questions.md` 3)
- **P4.** The style A/B stays a 20-case dev smoke, as in F122 run 4. No style holdout run and no `eval:style-gate` gate file in this ticket. (default; `questions.md` 4)

### Design

- **D1. The safety envelope of drafter-v5.** drafter-v5 holds every line of drafter-v4 word for word, except the section "Sentences outside a gap", which it replaces. Outside a gap, only these kinds of sentence may stand; their words are free, in the writing style:
  1. the greeting (rules unchanged);
  2. at most one opening sentence: thanks for the mail, or what the mail is about, in neutral words;
  3. for each question, one full sentence that holds its gap and names only its subject;
  4. sentences that give a fact or a decision of the instruction line, every fact as the line gives it, nothing added;
  5. at most one closing courtesy sentence that holds no promise, request, offer or next step and is no sign-off.
  No sentence of kinds 2, 3 and 5 holds an amount, price, percentage, date, deadline, term, the position of the manager, a verb of agreement or a later action. The final re-read rule of v4 stays, with the new kinds. Reason: every invented commitment of v2 and v3 came from a free sentence around a gap or a restated term (F115 `tuning-2.md`); kind 3 keeps the neutral frame and frees only the wording. Rejected: restating facts of the mail (the v2/v3 failure); a judge change (out of scope); a code post-processor.
- **D2. Sentence counter.** A pure `@ea/core` function (stage 01) classifies a body's sentences. A measure in the eval report, a bar only on the facts set (D3); never a production check or a gate bar: a mail with only open questions may need only gaps, and the gate file stays comparable with v1–v4.
- **D3. A dev-only facts set** `reply-facts` (stage 02): 12 synthetic mails with an instruction line each. Corpus cases have no instruction. Its bars are code bars, with no judge: the judge does not see the instruction and would flag the manager's own decisions as invented. Rejected: instruction lines on corpus cases (changes the frozen corpus).
- **D4. Smoke mode of `eval:style-gate`** (stage 03): the F122 futility and judge stops become code, not hand pairing. Eval tooling, not style suggestion code.
- **D5. Futility line.** The smoke passes when B's mean `style_match` is above A's, or B has more wins than losses (the negation of F122 `questions.md` 13). Judge stop: judge errors above 5 % of the cases of either run, or one `style_match` value in every case of both runs.
- **D6. Smoke sample.** `--part dev --limit 20`, `--judge-prompt judge-v4`; A `--style none`, B the style file `evals/results/styles/lab-01-sent-holdout-stylist-v1-gpt-6-luna-low.json`: the same cases and style as F122, so v4's 1.85 / 1.85 is the base.
- **D7. Judges.** Dev rounds, traps, week, holdout and injection use `judge-v3`, as the v4 gate file. Only the smoke uses `judge-v4`.
- **D8. Dev tuning edits `drafter-v5.ts` in place** until its holdout run (evals README: a change after a holdout run is a new version). Each round's report gets the suffix `-r<n>`; `tuning-1.md` names the commit of each round. At most 3 rounds.
- **D9. One holdout run,** the fifth drafter use of lab-01 holdout; no limit exists (scout 4). A failed gate ends the tuning: v4 stays; a drafter-v6 is a new ticket.
- **D10. Production pointer.** Stage 05 sets `prompts.drafter` to v5 under P2; the next normal release carries it. `reply_drafts` is off everywhere, so no user sees it before the F115 pilot. (`questions.md` 2)

## Facts checked (2026-11-20, at `b073f7ed3`)

- Read: `drafter-v4.ts` (closed list, instruction exception, "rules below win over the writing style"); `judge-v4.ts` (`style_match` against the corpus voice, not in "send as is"); `eval-judge.ts` and `drafter-eval.ts` (the judge sees no instruction; eval `instruction` is `null`); `eval-drafter-source.ts` (reply sets are `evalCaseSchema` arrays); `runPairRefusal` (holdout only); F122 `stage-09-gate-run.md` and `questions.md` 13.
- From scouts 1 and 5, not re-read: drafter bars, gate file shape, `STYLE_GATE_BARS`.

## Not verified

- How the coordinator puts the key into a job environment (F115 `tuning-4.md` does not say).
- That dev state files hold per-case `style_match` scores in the shape `compareStyleRuns` reads: stage 03 checks it first.

## Done when

1. `evals/results/gate/drafter-drafter-v5-gpt-6-luna-low-lab-01-v1.json` exists with its report; `"passed": true` and injection 14 of 14, or this folder's `tuning-1.md` or `tuning-2.md` names the failed bar.
2. The `reply-facts` run of the final v5: 12 of 12 drafts with a full sentence and every fact of the line.
3. The smoke report of `eval:style-gate --smoke` with v5 is committed; the verdict is in `spec/features/done/2026-11/F122-e6b-style-from-sent/tuning-2.md`.
4. `reply-drafts.md` names the live drafter and the smoke result.

## Rules for every stage

- A gap or a deviation from a decision is a question in the final message, not a choice.
- Tune only on `evals/sim/lab-01/dev/`, `week/` and the dev-only sets. Never open `holdout/` or `sent-holdout/`; from a holdout run open only its report and gate file.
- No key in a file, log, report, commit or final message. Dumps go to `/tmp/f164/dumps/`, never into git.
- Runs: `--concurrency 2 --rpm 30 --judge-rpm 30`. Stop at the first HTTP 429 or quota error: the key also serves production triage. Check the ledger before each run; set `--budget-usd` to the rest of the stage cap.
- Watchdog: a bash call that is CPU-idle for 180 s kills the job. Start an eval with `nohup … > /tmp/f164/<run>.log 2>&1 &`; poll in calls with `sleep` of at most 50 s. A killed run resumes from its state file (same command, no `--fresh`); write the lost spend into the tuning file (F115 `tuning-4.md`).
- Prompt files hold no mail, address or draft. No bare ticket codes in code, comments or docs pages.
- Format only the stage's files.

## Proof

The last line of `bun run check:job` (`check:job PASS master=… tip=…`), run once, after the last commit.

## Owner checkpoints and steps

- Coordinator check before stage 05: the verdict line of `tuning-1.md`. `go on` → stage 05 with the key; `stop` → stage 05 step 4 only, no key.
- Owner step: none; the key in the job environment is the coordinator's step.

## Review

Opus review before the land of 04 and 05 (prompt, spend, production drafter); 01–03 land on the proof.

## Stages

| # | Stage | Needs | Mark |
| --- | --- | --- | --- |
| 01 | [Sentence counter and report lines](stages/stage-01-sentence-counter.md) | — | May run next to 03 |
| 02 | [The reply-facts set](stages/stage-02-reply-facts-set.md) | stage 01 | |
| 03 | [Smoke mode of eval:style-gate](stages/stage-03-style-smoke.md) | — | May run next to 01, 02 |
| 04 | [drafter-v5 and dev tuning](stages/stage-04-drafter-v5.md) | 01, 02, 03; key | `[risky]` |
| 05 | [Holdout gate and production pointer](stages/stage-05-holdout-gate.md) | 04; key | `[risky]` |

## How to run (coordinator)

Board worker flags, `--prepare 'bash scripts/limen-prepare.sh'`. 01 and 03 at once; 02 after 01; 04 after 01–03, with the key; 05 after 04 and the coordinator check. `--keep-open` except on 05.

## Planning progress

- Scouts: 4 (plus 1 kept from the killed first run), packets in `scouts.md`.
- [written] plan.md, stages 01–05, questions.md, ticket `## Sequenced`. Words before review: plan 1480, stages 675 / 698 / 685 / 693 / 547.

## Cold review

Model `claude-opus-5-5`: stages 04 and 05 are `[risky]` (LLM prompt, spend). Pending.

## Log

- 2026-11-20: plan written at `b073f7ed3`.
