# F151 stage 06 — Demo recording on the export `[risky]`

Needs stage 03 (landed): `cutPlan`, `stepView`. Needs stage 05: setup, `deliverToB`, `demoMessage`, `readDemoPlan`, `@record` tag. Needs stage 08: `uploadVerdict`, `modelCheck`, the output order of `record.ts`. Needs C1a: an export of an ended run day 1 or later (D12) and the `*_demo` database.

Part of [`../plan.md`](../plan.md): P1, P2, P5, D1, D7, D8, D10, D12, D13, D14; [`../notes-for-stages-05-06.md`](../notes-for-stages-05-06.md). Risk: public video. Final-only (C3): the day-5 Proof run and its README result line.

Goal: `demo:record --seed <export>` records eight live steps, cuts the waits, says if the video is an upload candidate.

## Step 1 — eight steps (`record.spec.ts`, `@record`)

Remove the `demo_source_recording_not_built` throw. The demo branch reads `DEMO_PLAN_FILE` (`readDemoPlan`), signs in as the demo owner off camera. Waits (`DEMO_WAIT_LIMITS_MS`) poll an API or the fake Telegram (time-out: `demo_wait_timeout <what>`). Live mail: `deliverToB`, time of delivery.

| Step | On camera | Off camera, before the next |
| --- | --- | --- |
| 1 connect | Connect B (GreenMail password); B in shadow mode | wait `firstSync`; deliver 4 shadow mails; wait `shadowTriaged` |
| 2 shadow | Activity of B: the 4 mails with what it would do | wait `historyDone` |
| 3 report | `/report?mailbox=<B>` done, counts | — |
| 4 recommended | tap "Turn on recommended"; B in assist | `create_draft` on for B (settings route); deliver urgent, delegation, undo mail; wait `afterTap`: urgent notice in chat, delegation send waiting with Drafts copy, undo mail moved |
| 5 urgent | fake Telegram chat `9_200_001`, urgent notice | — |
| 6 approval | `/approvals?id=<send>`: Edit, Save, Approve | wait `delegationSent` |
| 7 delegation | "Remind now" on the step-6 delegation (D8) | — |
| 8 undo | Activity: Undo on it | — |

Text checks use `en` keys and plan values; `publicContentScan` on every step.

## Step 2 — wire the stage 08 checks

The demo branch passes the real `notLive`, `misses` and the captured server lines to the stage 08 code. Do not move or reorder the last lines (D14): the verdict stays the last line.

## Step 3 — run and spike table

Run both sources (Proof). Fill the "Demo source" column of `apps/web/e2e/demo/README.md` (live or not, how) and a result line with the seed day.

## Decisions

- Stop and ask (commit what works; `stage-06-question.md`: step, cause, options, default, seed day) for: a step that cannot be live; a `publicContentScan` hit on demo-week text (no allow-list entry); a wait time-out in two takes.
- No export, video, hash in git.
- Step 7 never uses `plan.overdueDelegation` (D8): no seed of this run can fill it. Build no branch for it.

## Test

1. A unit test for each new pure helper of the steps (the step-7 pick of the step-6 delegation, the wait targets), with fixed values.
2. Export log: `demo_source demo`, `demo_seed_day <n>`, `demo_setup_done history=` 20–60, `misses=0`, `demo_llm_checked`, empty `not_live`, 100–130 s, three files in `tmp/demo`; `tail -n1` is `not for upload: trial_seed` on a trial seed with exit 0, and `not for upload: run_failed` after any exit 1.
3. e2e log: `not_live shadow report urgent`; `tail -n1` is `not for upload: e2e_source`.

Break check: make step 7 pick no delegation; test 1 fails.

## Proof

```
SEED=$(ls -1 "$HOME"/.local/share/email-assistant/demo/demo-seed-day*.json | sort -V | tail -1)
mkdir -p /tmp/f151-s06 && flock /tmp/email-assistant-shared-tests.lock bun run demo:record --seed "$SEED" > /tmp/f151-s06/demo.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock bun run demo:record > /tmp/f151-s06/e2e.log 2>&1 && echo RECORD_OK
```

Then `bun run check:job`. Quote seed day, duration, size, replay, model and verdict lines.

## Done when

- Test 1 passes; tests 2 and 3 show in the saved logs (trial or final seed).
- README demo column: 8 steps.
- `live-lab.md` rule 24.10: replay, setup, cut, the eight live steps.

Out of scope: G2, G3, shots (stage 07).
