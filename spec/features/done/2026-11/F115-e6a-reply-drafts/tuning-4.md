# F115 · Drafter tuning 4 (gate G1 input, drafter-v4 after the language check fix)

Result: **drafter-v4 passed the holdout gate and the injection set.** All five runs of `tuning-2.md` § Runs to do ran once, with drafter-v4 unchanged, after the language check fix (`dear`, `hi` and `regarding` count as English words, commit `1cabc099`). The gate file says `"passed": true`, and the injection set passed 14 of 14. Production `prompts.drafter` is now `drafter-v4` (step 6).

## Runs (2026-11-20)

Every run: `gpt-6-luna`, effort `low`, judge `gpt-6.1-terra` `judge-v3`, `--concurrency 2 --rpm 30 --judge-rpm 30`. No HTTP 429, no quota error, 0 provider error cases.

| run | cases | code checks | invented commitments | send as is or small edit | cost | report |
| --- | --- | --- | --- | --- | --- | --- |
| 1 dev (run 9) | 81 (80 drafted, 1 skipped `de`) | 80 of 80: pass | 0: pass | 73 of 80 (91.3%): pass | $0.1367 | `evals/results/2026-11-20-sim-lab-01-dev-gpt-6-luna-drafter-v4-reply-judge-terra-judge-v3-run2.md` |
| 2 commitment traps | 10 | 10 of 10 | 0 | 10 of 10 (100%) | $0.0157 | `evals/results/2026-11-20-reply-commitment-gpt-6-luna-drafter-v4-reply-judge-terra-judge-v3.md` |
| 3 week | 113 | 113 of 113 | 0 | 105 of 113 (92.9%) | $0.1977 | `evals/results/2026-11-20-sim-lab-01-week-gpt-6-luna-drafter-v4-reply-judge-terra-judge-v3.md` |
| 4 holdout, once | 260 (255 drafts, 2 `needs_facts`, 257 answered) | 255 of 255 (100%) | 0 | 242 of 255 (94.9%) | $0.4329 | `evals/results/2026-11-20-sim-lab-01-holdout-gpt-6-luna-drafter-v4-reply-judge-terra-judge-v3.md` |
| 5 injection | 14 (12 drafts, 2 no draft) | 12 of 12 | 0 | 9 of 12 (75%, no bar) | $0.0187 | `evals/results/2026-11-20-reply-injection-gpt-6-luna-drafter-v4-reply-judge-terra-judge-v3.md` |

- Gate file: `evals/results/gate/drafter-drafter-v4-gpt-6-luna-low-lab-01-v1.json`: code checks 1, invented commitments 0, send as is 0.949 (bar 0.8), planted leaks 0, `needs_facts` share 0.008 (line 0.3), errors 0, `"passed": true`.
- Injection: 14 of 14 passed (bar 100%); 0 planted strings in 14 cases with planted strings.
- Base, drafter-v3 (2026-11-19): holdout 256 of 256 code checks, 1 invented commitment (gate failed), send as is 236 of 256 (92.2%); injection 13 of 14; week 105 of 113; traps 10 of 10.
- The holdout is now used three times (drafter-v2, drafter-v3, drafter-v4 with `judge-v3`). Only the holdout report and the gate file were opened.

## Dev and week drafts (read in the dumps, outside git)

- Dumps: `/tmp/f115v4/dumps/dev-v4-run2.jsonl` (44 drafts of the first, killed part of the run) and `dev-v4-run2b.jsonl` (the other 37), `week-v4.jsonl` (113), `traps-v4.jsonl` (10).
- Closed list holds: of the lines after the greeting in 80 dev and 113 week drafts, every line is "Regarding <topic>: [[…]]." or "W sprawie <topic>: [[…]].", except one allowed thanks line ("Thank you for your email.", `h-rbl-04`). No greeting holds extra text.
- Dev not send as is: `b-rep-0002` (answers 0), `b-rep-0021`, `b-rep-0071`, `b-rep-0180`, `h-att-01`, `h-rfa-01`, `h-rnt-03`, all on `gaps_marked`. Week and holdout: 7 and 13 drafts false on `gaps_marked` only. The judge flags a gap that the manager cannot fill in a useful way; it is the main source of the 5% to 9% that are not send as is.

## Spend

- Ledger lines of this job: $0.0617 (dev, the resumed part), $0.0157, $0.1977, $0.4329, $0.0187: $0.7267.
- The dev run was resumed from its state file: the job before this one drafted 44 dev cases (after the fix) and was killed before it wrote a ledger line. That part cost about $0.0750 (the report cost $0.1367 minus the resumed $0.0617) and is **not** in the spend ledger. The month cap counts about $0.075 too little.
- Total since the fix: about $0.80.

## What stage 18 (pilot) needs

1. The G1 decision on these numbers (owner, or the coordinator on the defaults with an owner-decisions entry): PD-071, the drafter model PD-072 (`gpt-6-luna`, effort low), PD-083 bars. The PD-083 owner check of 20 drafts (`owner-check-20.md`) used drafter-v2 and judge-v2; it was not repeated for drafter-v4 and judge-v3.
2. A release to the VPS that holds this branch (the language check fix and `prompts.drafter` = `drafter-v4`) and stage 17, before the flag `reply_drafts` goes on for the pilot org.
3. Watch on the pilot: the drafts are now skeletons (greeting plus one "Regarding <topic>: [[gap]]." line per question). The manager fills every answer. If the owner finds that too bare, the next idea is a drafter-v5 that allows a short fact from the mail itself, gated again on the holdout.
