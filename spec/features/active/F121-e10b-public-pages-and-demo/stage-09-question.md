# F121 stage 09 — question for the coordinator: 3 demo steps cannot run live

Part of [`plan.md`](plan.md). The spike table is in `apps/web/e2e/demo/README.md`. Rule D7: more than 2 steps not live = stop and ask.

## Finding

On the e2e seed and the e2e servers (`TRIAGE_LLM_SCOPE=off`) three of the eight steps cannot be done by the recording:

- **2 `shadow` (days passed):** time does not pass in a recording. Shown from the seed state of the trust organization.
- **3 `report` ("what I would have done"):** the history check that builds it runs in the history job, which follows the triage scope. With the scope off the job never claims a check. The report shows a seeded check row.
- **5 `urgent` (mail arrives, Telegram notice):** no worker triages a delivered mail with the model off, so no `urgent` triage row exists and the urgent detector queues no notice. A VIP rule only changes the classifier's input. I could not confirm the plan's statement that a VIP rule makes a mail urgent with the model off (`plan.md` carry-over note in the stage file); the code reads the other way.

Steps 1, 4, 6, 7, 8 are live.

## Options

1. **Accept 3 not-live steps (my pick for time).** Raise the D7 limit to 3 for the e2e-seed video. The `live` flags stay as they are in `steps.ts`; captions already name the day. The e2e-seed video is never a G3 candidate (D10) and the follow-up ticket on the C1 seed redoes the spike, where the sim stack has real triage.
2. **Run the recording server with `TRIAGE_LLM_SCOPE=synthetic` and a loopback model stub** (`OPENAI_BASE_URL` accepts `http` to loopback). Steps 3 and 5 become live. Costs a new test tool (a stub that answers the classifier schema) and a change of the e2e server env for the demo run only; no product change.
3. **Cut step 5 and merge 2 and 3** into one seed-state step (7 steps, 2 not live). Changes the decision-12 script and the 8-cue check of stage 10.

## What the stage built meanwhile

The pure parts do not depend on the answer: `toVtt`, `ffmpegArgs`, `demoDbProblem` and `DEMO_STEPS` (with the provisional `live` flags). Only `live`, the captions of the not-live steps and the step count change with the answer.
