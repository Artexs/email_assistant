---
opened: 2026-11-19
---

# F151 · The demo video and the docs screenshots come from the synthetic demo-week export

## Outcome

The demo video and the docs screenshots come from the synthetic demo-week export.

<!-- Two to four sentences: what becomes true for a user or operator. -->

## Scope

- <!-- Boundary and starting seam, not an edit list. -->

## Out of scope

- <!-- Nearby work that is not part of this ticket. -->

## Acceptance

- <!-- One observable result or check per line. -->

## Notes

<!-- Optional decisions or open questions; no progress log. -->

Detail: after C1 (F121 demo week export at `~/.local/share/email-assistant/demo/demo-seed-day5.json`), the F121 stage 09 spike is done for the demo source (its column in `apps/web/e2e/demo/README.md`), `DEMO_STEPS` live flags and captions are fixed for it, and `bun run demo:record --seed <C1 file>` logs `demo_source demo` and writes an MP4 of 100–130 s with en and pl captions. Owner gates G2 (commit the seed) and G3 (upload, pin `DEMO_VIDEO_SHA256`) of F121 move here; default: prepare, do not publish. Build after: F121 stages 07, 10, 11 landed and the C1 export exists. Drops the `f121_demo` DB (C3) when it closes.
