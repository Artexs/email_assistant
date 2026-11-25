---
opened: 2026-11-23
landed: 2026-11-26
---

# F171 · The docs site, the user docs, the screenshots and the demo video show the Pebble look

## Outcome

Everything outside the panel shows the same product: the docs site has the teal accent, the mark and the font; the user docs name the buttons and pages as the panel now does; the docs screenshots and the demo video are made again from the new look.

## Scope

- The docs site theme (`apps/docs`): accent, mark, favicon, font.
- User docs pages in English and Polish that name a changed button, heading or flow.
- The docs shots run and the demo recording (plan, captions, takes) on the new pages.
- `README.md` pictures, if any show the panel.

## Out of scope

- Publication gates of the docs site and the video (they stay with the owner).
- New docs pages for features that have none.

## Acceptance

- `bun run docs:test` passes, and the docs site passes its a11y check with the new accent.
- No docs page quotes a panel text that no longer exists (the docs text check passes).
- `bun run docs:shots` writes its shots from the new look.
- `bun run demo:record` records all steps on the new approvals queue.

## Slices

Five stages, one worker job each: [`plan.md`](plan.md) § Stages and § How to run. The docs accent and font stage can start now; the mark stage waits for the panel's brand mark; the text check, the shots and the video wait for the page stages they name. No owner checkpoint.

## Sequenced

- Plan after: F166 (tokens, fonts, the unused-key test), F167 (the brand mark), F168, F169, F170 (their plans name the changed texts and flows).
- Build after: none. Gate: the docs site theme stage needs only F166 stage 03 (tokens, font) and builds next to the page tickets; the user docs stage of a page needs that page's stages; the shots and the video need the page stages that their Needs lines name.

## Notes

Programme page: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). The demo video and docs shots ticket (F151) owns the recording tools; this ticket only makes the takes again.
