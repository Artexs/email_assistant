# F151 stage 06 — Demo recording on the export `[risky]`

Needs stage 03 (landed): `cutPlan`, `stepView`. Needs stage 05: setup, `deliverToB`, `demoMessage`, `readDemoPlan`, `@record` tag. Needs C1a: an export of day 1 or later (D12) and the `*_demo` database.

Part of [`../plan.md`](../plan.md): P1, P2, P5, D1, D7, D8, D10, D12, D13; [`../notes-for-stages-05-06.md`](../notes-for-stages-05-06.md). Risk: public video. Final-only (C3): the day-5 Proof run and its README result line.

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
| 6 approval | `/approvals?id=<send>`: Edit, Save, Approve | no `plan.overdueDelegation`: wait `delegationSent` |
| 7 delegation | "Remind now" on `plan.overdueDelegation`, else the step-6 one | — |
| 8 undo | Activity: Undo on it | — |

Text checks use `en` keys and plan values; `publicContentScan` on every step.

## Step 2 — upload line, model check (`record.ts`)

- `DemoPrepared` gets `seedDay: number` (the seed's `day`); `record.ts` prints `demo_seed_day <n>`. The e2e source passes `null`.
- `uploadVerdict({ source, seedDay, gateProvisional, misses, notLive }): string` (pure, `apps/web/e2e/lib/demo/`): `demo_source demo: upload candidate` only for `demo`, day ≥ 5, final gate, 0 misses, no not-live step; else `not for upload: <first reason>`, order `e2e_source`, `trial_seed`, `gate_provisional`, `replay_miss`, `not_live`. It prints after the hashes, before the stage-04 exits; never sets the exit code.
- Model check (acceptance 2): every server `llm_settings` line `endpoint=own`, host `127.0.0.1`, and `hits` ≥ `history.length + 7`; else exit 1 `demo_llm_unchecked`. Print `demo_llm_checked hits=<n>`.

## Step 3 — run and spike table

Run both sources (Proof). Fill the "Demo source" column of `apps/web/e2e/demo/README.md` (live or not, how) and a result line with the seed day.

## Decisions

- Stop and ask (commit what works; `stage-06-question.md`: step, cause, options, default, seed day) for: a step that cannot be live; a `publicContentScan` hit on demo-week text (no allow-list entry); a wait time-out in two takes.
- No export, video, hash in git.

## Test

1. `uploadVerdict` (`test.each`; source, day, gate, misses, notLive): demo, 5, final, 0, [] → `demo_source demo: upload candidate`; demo, 1, final, 0, [] → `…trial_seed`; demo, 1, provisional, 0, [] → `…trial_seed`; demo, 5, provisional, 0, [] → `…gate_provisional`; demo, 5, final, 2, [] → `…replay_miss`; demo, 5, final, 0, ["shadow"] → `…not_live`; e2e, null, final, 0, [] → `…e2e_source` (`…`: `not for upload: `).
2. Export log: `demo_source demo`, `demo_seed_day <n>`, `demo_setup_done history=` 20–60, `misses=0`, `demo_llm_checked`, empty `not_live`, 100–130 s, three files in `tmp/demo`; on a trial seed the last line is `not for upload: trial_seed`.
3. e2e log: `not_live shadow report urgent`, `not for upload: e2e_source`.

Break check: ignore misses; test 1 fails.

## Proof

```
SEED=$(ls -1 "$HOME"/.local/share/email-assistant/demo/demo-seed-day*.json | sort -V | tail -1)
mkdir -p /tmp/f151-s06 && flock /tmp/email-assistant-shared-tests.lock bun run demo:record --seed "$SEED" > /tmp/f151-s06/demo.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock bun run demo:record > /tmp/f151-s06/e2e.log 2>&1 && echo RECORD_OK
```

Then `bun run check:job`. Quote seed day, duration, size, replay, model and verdict lines.

## Done when

- Test 1 passes; tests 2, 3 show in the saved logs (trial or final seed).
- README demo column: 8 steps.
- `live-lab.md` rule 24.10: replay, setup, cut, trial seed, upload line.

Out of scope: G2, G3, shots (stage 07).
