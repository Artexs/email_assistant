# F088 · Open defaults (owner to confirm)

None of these blocks the build or changes the stage list. Each is a numbered decision in [plan.md](plan.md) § Input. Change one before the stage that uses it.

1. **D9 Six stages, not five** (all stages). The author's "sender renders" stage is split: first every producer queues a view and the row still stores the text rendered from it (the byte-identical proof), then the sender renders. Option: one bigger stage (about 450 lines, one review).
2. **D11 Render functions stay in their files** (stage 01). The registry imports them from `packages/core/src/digest/`. Option: move them to `packages/core/src/notices/` (churn, no behaviour).
3. **D12 Clock facts from the queue time** (stage 01). A notice held by the quiet hours overnight prints `22:15`, not `13 Nov 22:15`, as today. Option: render with the send time (more exact, but texts change).
4. **D13 Urgent view stores facts, not English phrases** (stages 01, 03). `wouldDo` and the AI line are built by the renderer. Option: store the two strings (E7-T1 changes the view later).
5. **D16 A user without a locale gets `pl` rows** (stage 02). Same rule as the auth mails (F082 B1); the texts stay English until E7-T1. Option: `en`.
6. **D17 The tap edit keeps the stored card bytes** (stage 04). The registry's edit entry adds the status line to the stored text; it does not render the card again from the view (`docs/architecture.md` §4.5, review §3.4). Option: render the card again (the author's D7 as written).
