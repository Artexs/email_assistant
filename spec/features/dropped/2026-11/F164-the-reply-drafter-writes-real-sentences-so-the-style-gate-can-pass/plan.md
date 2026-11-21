# F164 · Plan

> **Status 2026-11-20 — planned.** Plan base: `b073f7ed3`. Seven stages; 05–07 spend on the shared OpenAI key.

## Input

Ticket words: "A reply draft holds full sentences where the manager's facts are known, not only a greeting and one placeholder line per question." "Keep every existing safety check." Out of scope: "Changing the style suggestion code or the judge." "About $1 to $2 of model runs; use the VPS key in the job environment only, as before."

Sources: F115 `tuning-1.md` to `tuning-4.md` (`spec/features/active/F115-e6a-reply-drafts/`, why v4 is a skeleton), F122 `tuning-1.md` (`spec/features/done/2026-11/F122-e6b-style-from-sent/`, the failed smoke), `scouts.md`.

### Product

- **P1.** "Known facts" are what the drafter really gets: the manager's instruction line and what the mail is about. No new input is added (`reply-drafts.md` rule 4).
- **P2.** drafter-v5 becomes production `prompts.drafter` only with gate `"passed": true`, injection 14 of 14, 0 invented commitments on the traps and at most 2 drafts with a leaning sentence on the holdout (D11); also when the style smoke fails (full sentences are the first outcome). Else drafter-v4 stays. (default; `questions.md` 1)
- **P3.** At most $2.00: stage 05 $0.35, stage 06 $0.90, stage 07 $0.75. Spend rule: before each run, when the rest of the stage cap is below the run's estimate in the stage file, do not start; stop and ask. Each run gets `--budget-usd` = the rest; a run that stops at it (exit 4) stops the stage and asks. Estimates: F115/F122 costs plus 50 %. (default; `questions.md` 3)
- **P4.** The style A/B is the 20-case dev smoke of F122 run 4; no style holdout run here. (default; `questions.md` 4)
- **P5.** When no v5 gate passes, acceptance bullet 1 of the ticket is not met: the coordinator records the outcome as failed, with the reason from the tuning files, not as done. (`questions.md` 8)

### Design

- **D1. Safety envelope of drafter-v5.** Every drafter-v4 line stays word for word, except the section "Sentences outside a gap", which v5 replaces. Outside a gap only these kinds stand, in the writing style:
  1. the greeting (rules unchanged);
  2. at most one opening sentence: thanks, or what the mail is about, in neutral words;
  3. per question, one full sentence that holds its gap and names only its subject;
  4. sentences that give a fact or decision of the instruction line, with the line's own words for each fact (day, time, amount, name, yes or no), adding only grammar words;
  5. at most one closing courtesy sentence with no promise, request, offer or next step, and no sign-off.
  Kinds 2, 3 and 5 hold no amount, price, percentage, date, deadline, term, position of the manager, verb of agreement or later action. Kinds 2 and 5 are optional. The re-read rule covers the five kinds. Reason: v2 and v3 commitments came from free sentences around a gap or restated terms (F115 `tuning-2.md`); kind 3 frees only the wording. Rejected: restating mail facts; a judge change; a post-processor.
- **D2. Sentence counter** (stage 01): a pure `@ea/core` measure, computed at run time and stored text-free (stage 02). Bars from it: prose on the facts set (D3), skeleton share and leaning on dev and week during tuning, leaning on the holdout for P2. Never a production check, never a gate-file bar: the gate file stays comparable with v1–v4.
- **D3. Dev-only facts set** `reply-facts` (stage 03): 12 synthetic mails with an instruction line each; corpus cases have none. Code bars only: the judge does not see the instruction and would flag the manager's own decisions. Frozen after stage 03. Rejected: instruction lines on corpus cases (the corpus is frozen).
- **D4. Smoke mode of `eval:style-gate`** (stage 04): the F122 futility and judge stops as code. Eval tooling, not style suggestion code.
- **D5. Futility line.** The smoke passes when B's mean `style_match` is above A's, or B wins more pairs than it loses (the negation of F122 `questions.md` 13). Judge stop: a judge error share above 5 % in either run, or one `style_match` value in every case.
- **D6. Smoke sample.** `--part dev --limit 20`, judge-v4; A `--style none`, B `lab-01-sent-holdout-stylist-v1-gpt-6-luna-low.json`: F122's cases and style, so v4's 1.85 / 1.85 is the base. Run once, on the final text; not a tuning input.
- **D7. Judges.** Dev, traps, week, holdout and injection use judge-v3, as the v4 gate. Only the smoke uses judge-v4.
- **D8. Rounds.** At most 3 dev rounds; `drafter-v5.ts` changes in place until its holdout run (evals README). The state file name has no hash of the prompt text, so every first start of a run uses `--fresh`; a killed run resumes without it. Reports get `-r<n>`.
- **D9. One holdout run,** the fifth drafter use of lab-01 holdout; no limit exists (scout 4). A failed gate ends the tuning; a drafter-v6 is a new ticket.
- **D10. Pointer.** Stage 07 moves `prompts.drafter` under P2; the next normal release carries it. `reply_drafts` is off everywhere. (`questions.md` 2)
- **D11. Leaning scan.** A fixed list of first-person commitment phrases (stage 01) counts leaning sentences: the judge passed such sentences before (F115 `tuning-2.md`), and the holdout has no dump. Dev and week: each match is read and must be false. Holdout: at most 2 drafts of the run hold a match (changed after stage 06 review: the scan was narrowed for weekday, month and position phrases, and about 2 matches in 200 drafts remain real rule breaks, so a bar of 0 blocks almost surely; a draft is only ever sent after the owner approves it).

## Facts checked (2026-11-20, at `b073f7ed3`)

- Read: `drafter-v4.ts`; `judge-v4.ts` (`style_match` against the corpus voice, "the reply is short"); `eval-judge.ts`, `drafter-eval.ts` (judge sees no instruction; eval `instruction` `null`; no body in the result); `runPairRefusal` (holdout only); F122 `stage-09-gate-run.md`.
- From scouts 1 and first-run 4 and review N13: bars, gate file shape, `--limit 20` = first 20 needs_reply cases, November ledger $6.25 of $20.

## Not verified

- How the coordinator puts the key into a job environment (F115 `tuning-4.md` does not say).
- That dev state files hold per-case `style_match`: stage 04 checks first.

## Done when

1. The v5 gate file and report exist with `"passed": true` and injection 14 of 14, or this folder's `tuning-1.md` / `tuning-2.md` names the failed bar (P5).
2. The final v5 `reply-facts` run: 12 of 12 `ok`.
3. The smoke report with v5 is committed; its verdict is in F122 `tuning-2.md`.
4. `reply-drafts.md` names the live drafter and the smoke result.

## Rules for every stage

- A gap or a deviation from a decision is a question in the final message, not a choice.
- Tune only on lab-01 `dev/`, `week/` and the dev-only sets. Never open `holdout/` or `sent-holdout/`; from a holdout run open only its report and gate file.
- No key in a file, log, report, commit or message. Dumps go to `/tmp/f164/dumps/`, never into git.
- Runs: `--concurrency 2 --rpm 30 --judge-rpm 30`; P3 spend rule. Stop at the first HTTP 429 or quota error: the key also serves production triage.
- Watchdog: a bash call CPU-idle for 180 s kills the job. Start an eval with `nohup … > /tmp/f164/<run>.log 2>&1 &`; poll with `sleep` ≤ 50 s per call. Record spend lost by a killed run (F115 `tuning-4.md`).
- Prompt files hold no mail, address or draft. No bare ticket codes in code, comments or docs pages. Format only the stage's files.

## Proof

The last line of `bun run check:job` (`check:job PASS master=… tip=…`), once, after the last commit.

## Checkpoints and owner steps

- Coordinator check before stage 07: the `Verdict:` line of `tuning-1.md`. `go on` → with the key; `stop` → step 4 only, no key.
- Owner step: none; the key in the job environment is the coordinator's step.

## Review

Opus review before the land of 05, 06 and 07 (prompt, spend, production drafter); 01–04 land on the proof.

## Stages

| # | Stage | Needs | Mark |
| --- | --- | --- | --- |
| 01 | [Sentence counter and leaning scan](stages/stage-01-sentence-counter.md) | — | next to 04 |
| 02 | [Sentence counts in every drafter run](stages/stage-02-eval-sentences.md) | 01 | next to 04 |
| 03 | [The reply-facts set](stages/stage-03-reply-facts-set.md) | 02 | next to 04 |
| 04 | [Smoke mode of eval:style-gate](stages/stage-04-style-smoke.md) | — | next to 01–03 |
| 05 | [drafter-v5 and dev round 1](stages/stage-05-drafter-v5.md) | 02, 03; key | `[risky]` |
| 06 | [Rounds 2–3, week, style smoke](stages/stage-06-rounds-week-smoke.md) | 04, 05; key | `[risky]` |
| 07 | [Holdout gate and pointer](stages/stage-07-holdout-gate.md) | 06; key unless `stop` | `[risky]` |

## How to run (coordinator)

Board worker flags, `--prepare 'bash scripts/limen-prepare.sh'`. 01 and 04 at once; then 02, 03; 05–07 in order with the key. `--keep-open` except on 07.

## Planning progress

- Scouts: 4, plus 1 kept from the killed first run (`scouts.md`).
- [written] plan.md, stages 01–07, questions.md, ticket `## Sequenced`. Words: plan ≤ 1,500; stages 642 / 475 / 700 / 693 / 698 / 527 / 591.

## Cold review

Model `claude-opus-5-5`: stages 05–07 are `[risky]` (prompt, spend). Job `2026-11-20-f164-plan-review-494d9de0`, verdict FAIL, 3 blocking, 13 notes; filed whole as `plan-review-1.md`. Dispositions: `plan-review-1-fixes.md` (all fixed, none rejected).

## Log

- 2026-11-20: plan at `b073f7ed3`; cold review 1 fixed.
