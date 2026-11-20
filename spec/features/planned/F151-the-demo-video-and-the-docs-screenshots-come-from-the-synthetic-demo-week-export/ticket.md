---
opened: 2026-11-19
---

# F151 · The demo video and the docs screenshots come from the synthetic demo-week export

## Outcome

The demo video and the docs screenshots come from the synthetic demo-week export. The public pages work (F121) left the recording unable to use a demo seed, and three of its eight steps showed only seeded rows. After this ticket the recording runs all eight steps live in the one demo organization, with the demo week's own model answers replayed on loopback at no cost. The docs screenshots come from the same export.

## Scope

- A loopback replay of the demo week's classifier answers for the recording.
- The demo-source path of `demo:record`: setup, server env, the eight steps, the cut of the waits between steps.
- Per-source live flags and captions; the spike table column for the demo source.
- One shots run from the export; capability page, release checklist and owner gate texts.

## Out of scope

- The publication: commit of the seed (G2), upload of the video and the hash pins (G3), the docs hold (F121 G1).
- The owner audit of the classifier gate files.
- Changes to the lab export or import, or to product behaviour.
- Parallel Playwright runs (F136).

## Acceptance

- `bun run demo:record --seed <export>` logs `demo_source demo`, prints `not_live` with no step, and writes an MP4 of 100–130 s with `demo.en.vtt` and `demo.pl.vtt`.
- The same run ends with 0 replay misses and makes no call to a non-loopback model host.
- With an e2e seed, `bun run demo:record` still records, and its not-live steps are 2, 3 and 5.
- `DEMO_SEED_FILE=<export> bun run docs:shots` logs `shots_source demo` and writes the 20 shots.
- `apps/web/e2e/demo/README.md` has the demo-source column filled for all eight steps.
- The owner gate texts say when a video is an upload candidate.

## Slices

Six stages, one worker job each: [`plan.md`](plan.md) § Stages and § How to run. Stages 01–04 need no export; 05–06 need the C1 export.

## Sequenced

- Plan after: none. The public pages and demo ticket (F121) is in `done/`. The parallel Playwright ticket (F136) has stages and changes the same e2e env files; this plan uses none of its interfaces.
- Build after: F121 (in `done/`). Gate: the C1 demo-week export at `~/.local/share/email-assistant/demo/demo-seed-day5.json` and the `*_demo` database of F121 C3, for stages 05–06 only. Owner gates G2 and G3 (default: prepare, do not publish).

## Notes

Follow-up of `spec/features/done/2026-11/F121-e10b-public-pages-and-demo/` (stage 09 question, option 1). Open questions: [`questions.md`](questions.md).
