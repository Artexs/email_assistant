# F151 stage 06 — Demo recording on the export `[risky]`

Needs stage 03: `cutPlan`, `stepView`. Needs stage 05: the setup, `deliverToB`, `demoMessage`, the `@record` test tag. Needs coordinator step C1 (export and `*_demo` database).

Part of [`../plan.md`](../plan.md). Decisions P1, P2, P5, D1, D7, D8, D10. Risk: public video.

## Goal

`demo:record --seed <export>` records the eight steps live, cuts the waits and says if the video is an upload candidate (the demo-source spike).

## Step 1 — the eight steps (`record.spec.ts`, `@record`, demo branch)

Remove the `demo_source_recording_not_built` throw. The demo branch reads `DEMO_PLAN_FILE` and signs in as the demo owner off camera. Waits (`DEMO_WAIT_LIMITS_MS`) poll an API or the fake Telegram between cues; a time-out is `demo_wait_timeout <what>`. Live mail: `deliverToB` at the time of delivery.

| Step | On camera | Before the next step (off camera) |
| --- | --- | --- |
| 1 connect | Connect B with the GreenMail password; B shows shadow mode | wait `firstSync`; deliver the 4 shadow mails; wait `shadowTriaged` |
| 2 shadow | Activity filtered to B: the 4 mails with what it would do | wait `historyDone` (check of B `done`) |
| 3 report | `/report?mailbox=<B>` done, with counts | — |
| 4 recommended | tap "Turn on recommended" (`plan.recommended`); B is in assist | `create_draft` on for B (settings route; off by default); deliver urgent, delegation and undo mail; wait `afterTap`: urgent notice in the chat, delegation send waiting with its Drafts copy, undo mail moved |
| 5 urgent | fake Telegram view of chat `9_200_001` with the urgent notice | — |
| 6 approval | `/approvals?id=<that send>`: Edit, Save, Approve | without `plan.overdueDelegation`: wait `delegationSent` |
| 7 delegation | "Remind now" on `plan.overdueDelegation`, else on the step-6 delegation | — |
| 8 undo | Activity: Undo on the undo mail | — |

Text checks use `en` keys and plan values; `publicContentScan` runs on every step. Other product notices may show in the chat.

## Step 2 — the upload line and the model check (`record.ts`)

- `uploadVerdict({ source, gateProvisional, misses, notLive }): string` (pure, `apps/web/e2e/lib/demo/`): `demo_source demo: upload candidate` only for source `demo`, a final gate, 0 misses and no not-live step; else `not for upload: <first reason>` (`e2e_source`, `gate_provisional`, `replay_miss`, `not_live`). It prints after the hashes and before the stage-04 exits; it never sets the exit code.
- Model check (ticket acceptance 2): every server `llm_settings` start line reads `endpoint=own`, host `127.0.0.1`, and `hits` ≥ `history.length + 7`; else exit 1 `demo_llm_unchecked`. Print `demo_llm_checked hits=<n>`.

## Step 3 — the run and the spike table

Run both sources (Proof). Fill the "Demo source" column of `apps/web/e2e/demo/README.md` (live or not, and how) and a result line.

## Decisions

- Stop and ask (commit what works; `stage-06-question.md`: step, cause, options, default) for: a step that cannot be live; a `publicContentScan` hit on demo-week text (no allow-list entry); a wait time-out in two takes.
- No export, video or hash in git.

## Test

1. `uploadVerdict` (`test.each`): demo, final, 0, [] → `demo_source demo: upload candidate`; demo, provisional, 0, [] → `not for upload: gate_provisional`; demo, final, 2, [] → `not for upload: replay_miss`; demo, final, 0, ["shadow"] → `not for upload: not_live`; e2e, final, 0, [] → `not for upload: e2e_source`.
2. Export run log: `demo_source demo`, `demo_setup_done history=` 20–60, `misses=0`, `demo_llm_checked`, empty `not_live`, duration 100–130 s, three files in `tmp/demo`. With today's provisional gate the last line is `not for upload: gate_provisional`.
3. The e2e run: `not_live shadow report urgent` and `not for upload: e2e_source`.

Break check: ignore misses in `uploadVerdict`; test 1 fails.

## Proof

```
mkdir -p /tmp/f151-s06 && flock /tmp/email-assistant-shared-tests.lock bun run demo:record --seed "$HOME/.local/share/email-assistant/demo/demo-seed-day5.json" > /tmp/f151-s06/demo.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock bun run demo:record > /tmp/f151-s06/e2e.log 2>&1 && echo RECORD_OK
```

Then `bun run check:job`. Quote the duration, size, replay, model and verdict lines.

## Done when

- Test 1 passes; tests 2 and 3 show in the saved logs.
- README demo column filled for 8 steps.
- `live-lab.md` rule 24.10 describes the demo source: replay, setup, cut, upload line.

## Out of scope

- G2, G3, shots (stage 07).
