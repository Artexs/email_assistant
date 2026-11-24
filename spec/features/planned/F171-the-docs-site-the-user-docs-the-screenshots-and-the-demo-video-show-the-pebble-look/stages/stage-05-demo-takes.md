# F171 stage 05 — Demo takes on the new pages

Needs the final look of the pages the eight steps show: F167 stages 02, 03, 04 (frame); F170 stage 07 (step 1, Mailboxes and the connect dialog), 01, 02 (step 2, Settings), 09 (steps 3 and 4, the report and "Turn on recommended"); F168 stages 06, 07 (steps 2 and 8, Activity) and 05 (the locators of steps 6 and 8 on the approvals queue); F169 stage 03 (the locators of step 7). May run next to 01–04 (it owns `apps/web/e2e/demo/`, `apps/web/e2e/lib/demo/steps.ts` and its test). Runs `demo:record` on the shared demo DB, under the shared lock.

Part of [`../plan.md`](../plan.md). Decisions P4, P5, D10, D11. Opus review before the land (Polish caption).

## Step 1 — All eight steps run on the new pages

- **Files:** `apps/web/e2e/demo/record.spec.ts` (any step whose locator no longer finds its target, D10), `apps/web/e2e/demo/README.md` (the "How" column of a step whose button or page name changed).
- **Do:** run the recording on the e2e source (P5): `flock /tmp/email-assistant-shared-tests.lock bun run demo:record` with no `--seed`. The log must name the e2e source; if it names the demo source (a `DEMO_SEED_FILE` in the env), stop and ask. Each step keeps its story, its planned `seconds` and its `live` flags; only locators change. Step 6 runs on the one-draft queue (F168): it opens `/approvals?id=<edit send>`, changes the text, waits until the approve button is on, approves, and sees the outcome text.
- An F151 stage that is open at the same time owns the demo source; this stage changes no demo-source branch. A land conflict: merge `master`, prove again.

## Step 2 — Captions

- **Files:** `apps/web/e2e/lib/demo/steps.ts`, `steps.test.ts`.
- **Do:** set the e2e caption of step `report` to P4: en `"Day 3: what it would have done.\nEvery move is a plan, with its evidence."`, pl `"Dzień 3: co zrobiłby asystent.\nKażdy ruch to plan, z dowodami."`. Read every other caption against PB-8 (no first-person past tense, no gendered form for the reader) and against the new pages; a caption that is no longer true is a question in the final message, not a change.

## Test

1. `steps.test.ts`: the e2e `report` caption equals the two P4 strings exactly.
2. `steps.test.ts`: no caption of either source, in either language, holds `"I would"`, `"bym "` or `"I "` as a word (a table over all 8 steps × 2 sources × 2 languages).
3. Break check: put back the old English text of the `report` caption; tests 1 and 2 fail; restore.
4. The recording log has a `demo_step <id> end` line for each of the 8 step ids in `DEMO_STEPS` order, the line `not_live shadow,report,urgent` (the e2e source), and a last `[demo-record]` line that starts with `not for upload:` (P5: the e2e video is never an upload candidate).
5. `tmp/demo/demo.en.vtt` and `demo.pl.vtt` hold 8 cues each, and the `report` cue holds the P4 text.

## Look

With `ffmpeg`, take one still per step at the middle of its cue (times from `demo.en.vtt`) into `/tmp/f171-05/step-<n>-<id>.png`. Open the 8 stills. Each shows the Pebble look (teal, Nunito, the new frame) and the page of its step; step 6 shows the queue card. Give the paths and one line per step.

## Out of scope

The demo-week source and its take, the upload, the hash pins of `apps/docs/src/demo-video.ts` (F151 and the owner gate G3). The recording tools (`record.ts`, cut, encode: F151). Panel code.

## Done when

- Tests 1–5 pass; test 3 failed when broken.
- `mkdir -p /tmp/f171-05 && bun run check:job > /tmp/f171-05/check.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock bun run demo:record > /tmp/f171-05/demo.log 2>&1 && echo PROOF_OK` prints `PROOF_OK`.
