# F151 stage 05 — Demo recording on the export `[risky]`

Needs stage 03: `cutPlan`, `stepView`. Needs stage 04: `demo-plan.json`, the replay env and the setup. Needs coordinator step C1: the export at `~/.local/share/email-assistant/demo/demo-seed-day5.json`, and the `*_demo` database (F121 C3) in the main `.env`.

Part of [`../plan.md`](../plan.md). Decisions P1, P2, P5, D1, D7, D8, D10. Risk: the public video.

## Goal

`demo:record --seed <export>` records the eight steps live, cuts the waits and says whether the video is an upload candidate. This stage is the demo-source spike.

## Step 1 — the eight steps (`record.spec.ts`, demo branch)

Remove the `demo_source_recording_not_built` throw. The demo branch reads `DEMO_PLAN_FILE` and signs in once as the demo owner, off camera. Waits (D7) poll an API or the fake Telegram between cues and fail with `demo_wait_timeout <what>`.

| Step | On camera | Before the next step (off camera) |
| --- | --- | --- |
| 1 connect | Mailboxes, Connect, address B and the GreenMail password; B shows shadow mode | wait first sync of B (3 min); deliver the 4 shadow mails; wait until they are triaged (3 min) |
| 2 shadow | Activity filtered to B: the 4 mails with what it would do | wait the history check of B `done` (8 min) |
| 3 report | `/report?mailbox=<B>` done, with counts | — |
| 4 recommended | tap "Turn on recommended" for `plan.recommended`; B is in assist | if `create_draft` is off, turn it on (settings route); deliver urgent, delegation and undo mail; wait: urgent notice in chat `9_200_001`, a waiting delegation send with its Drafts copy, the undo mail moved (4 min) |
| 5 urgent | fake Telegram read-only view of chat `9_200_001` with the urgent notice | — |
| 6 approval | `/approvals?id=<that send>`: Edit, Save, Approve (as on the e2e source) | — |
| 7 delegation | Delegations: "Remind now" on `plan.overdueDelegation`, else on the step-6 delegation (Open tab) | — |
| 8 undo | Activity: Undo on the undo mail | — |

Text checks come from `en` keys and plan values. `publicContentScan` stays on every step.

## Step 2 — the upload line (`record.ts`)

`uploadVerdict({ source, gateProvisional, misses, notLive }): string` (pure, `apps/web/e2e/lib/demo/`), printed last: `demo_source demo: upload candidate` only for source `demo`, a final gate, 0 misses and no not-live step; else `not for upload: <first reason>` (`e2e_source`, `gate_provisional`, `replay_miss`, `not_live`).

## Step 3 — the run and the spike table

Run both sources (Proof). Fill the "Demo source" column of `apps/web/e2e/demo/README.md` for each step (live or not, and how) and add a result line.

## Decisions

- Stop and ask (commit what works, write `stage-05-question.md`: step, cause, options, default) for: a step that cannot be live; a `publicContentScan` hit on demo-week text (no allow-list entry); a wait time-out in two takes. The F121 limit of 3 not-live steps was for the e2e video only.
- No export, video or hash goes into git.

## Test

1. `uploadVerdict` (`test.each`): demo, final, 0, [] → `demo_source demo: upload candidate`; demo, provisional, 0, [] → `not for upload: gate_provisional`; demo, final, 2, [] → `not for upload: replay_miss`; demo, final, 0, ["shadow"] → `not for upload: not_live`; e2e, final, 0, [] → `not for upload: e2e_source`.
2. Export run log: `demo_source demo`, `demo_setup_done history=` 20–60, `misses=0`, empty `not_live`, duration 100–130 s, three files in `tmp/demo`. With today's provisional gate the last line is `not for upload: gate_provisional`.
3. The e2e run: `not_live shadow report urgent` and `not for upload: e2e_source`.

Break check: make `uploadVerdict` ignore misses; test 1 row 3 must fail.

## Proof

```
mkdir -p /tmp/f151-s05 && flock /tmp/email-assistant-shared-tests.lock bun run demo:record --seed "$HOME/.local/share/email-assistant/demo/demo-seed-day5.json" > /tmp/f151-s05/demo.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock bun run demo:record > /tmp/f151-s05/e2e.log 2>&1 && echo RECORD_OK
```

Then `bun run check:job`. The final message quotes the duration, size, replay and verdict lines of both logs.

## Done when

- Test 1 passes; tests 2 and 3 show in the saved logs.
- README demo column filled for 8 steps.
- `docs/capabilities/live-lab.md` rule 24.10 describes the demo source: replay model, cut, upload line.

## Out of scope

- G2, G3, shots (stage 06).
