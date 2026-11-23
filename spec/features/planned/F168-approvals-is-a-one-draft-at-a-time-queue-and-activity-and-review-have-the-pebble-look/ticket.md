---
opened: 2026-11-23
---

# F168 · Approvals is a one-draft-at-a-time queue, and Activity and Review have the Pebble look

## Outcome

Approvals shows one draft at a time: the user reads it, taps "Yes, send it", "Change" or "No", and the next draft comes. A double tap cannot send a second mail, and a link from Telegram to a draft that is already sent, expired or replaced shows that state. Activity and the review page ("Was I right?") have the Pebble look, with category pills in place of emoji and real empty states.

## Scope

- The approvals page and its components: the focus card, the waiting list, the decision bar (fixed on a phone), the edit dialog, the reply-draft controls, every draft state and end reason.
- Queue safety of programme decision PB-6.
- The activity page: filters as chips, day groups, row actions, three empty states.
- The review page: cards, progress, the correction picker.
- The e2e specs, the demo recording spec and the capability and user docs of these pages.

## Out of scope

- Any change of the approve, reject or edit API, of send limits or of the committer.
- New numbers or a "why" text that the API does not give (programme decision PB-7).
- Keyboard shortcuts.

## Acceptance

- With five waiting drafts, an approve of the first shows "sent to" with locked buttons, then the second draft; two fast taps approve one draft only.
- "Later" moves to the next draft and changes nothing on the server.
- `/approvals?id=<id>` of a sent, rejected, expired, failed or superseded draft shows a closed card with its state text; of a waiting draft it opens that draft first.
- A draft that another device decided shows a notice and leaves the queue.
- On a Pixel 7 the three decision buttons stay visible over a long draft, above the tab bar.
- Activity and Review show a category as an icon pill; no emoji is left in their texts.

## Slices

Stages come from the plan. The approvals stages are `[risky]` (sending to people) and get an Opus review.

## Sequenced

- Plan after: F166 (its `interfaces.md`), F167 (its plan: the page head contract).
- Build after: F166; F167 stage 01. Gate: none. May build next to F169 and F170.

## Notes

Programme page: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). The reply-draft pilot (F115) uses this page: programme decision PB-12 holds the release, not the build.
