# F166 plan review 1: what changed (2026-11-23)

The review ([`plan-review-1.md`](plan-review-1.md)) read the first, seven-stage form of the plan at commit `5b83dbaaf`. Stage numbers in the findings are the old ones: the pattern page moved from stage 04 to stage 08, the patterns from stage 06 to stages 06, 09 and 10. All 22 findings were accepted.

| # | Kind | Fix | Where |
| --- | --- | --- | --- |
| 1 | blocking | The pattern page needs a session (no change of the server's public paths). The sheet row and the spec sign in as the main owner. The ticket says "not in a production build", not "404". | `plan.md` D8, stage 08, `ticket.md` |
| 2 | blocking | A second script `web:build:dev` sets `EA_DEV_PAGES=1`; the e2e runs, the sheet and the CI `e2e` job use it; the image build keeps `web:build`. | D8, `interfaces.md` § Tools, stage 08, Proof B and C |
| 3 | blocking | `--ring` is solid `--primary` (5.14:1 and 9.73:1 on the background). Focus classes carry no opacity. The token test checks the ring; the guard test bans `ring-ring/NN`. | `interfaces.md`, stages 03, 04, 05, 07 |
| 4 | gap | Soft tokens: `color-mix(in srgb, <colour> 14%, var(--card))`, opaque, always mixed with the card colour. | `interfaces.md` § soft rule, stage 03 |
| 5 | gap | Five avatar fill tokens and one avatar text token per scheme; no white text class. | `interfaces.md`, stages 03, 06 |
| 6 | gap | `FactBox` is a plain `div` with no role. `Alert` gets no `accent` variant. | `interfaces.md`, stages 05, 10 |
| 7 | gap | `Row` takes `htmlFor`: the title becomes a `Label` for the control. | `interfaces.md`, stage 10 |
| 8 | gap | Token `--tabbar-height` (4 rem); `StickyActions` and the shell ticket both read it. | `interfaces.md`, stages 03, 10 |
| 9 | gap | The unused-key rule also reads `packages/core/src` and `apps/server/src`, leaves out the plural tables' own files, and does not count unit test files. | stage 07 |
| 10 | gap | D5 is about names, not classes. Stage 11 owns the dark fixes, with a bar of 20 distinct violations. | D5, stage 11 |
| 11 | gap | The cleanup ticket accepts the allow-list entries that the ADR names. | F172 `ticket.md`, D10 |
| 12 | gap | Dark scan on the `desktop` project only; stage 11 records the time; over 17 minutes in CI is a question. | D9, stage 11 |
| 13 | gap | The sheet writes to `~/.local/share/email-assistant/ui-sheet/<job>/`, outside the worktree. | D7, `interfaces.md` § Tools, stage 02 |
| 14 | gap | Patterns split into stages 06, 09 and 10. The dark scan left stage 03 and became stage 11. | stage table |
| 15 | note | 102 scan calls, not 131. | § Facts checked |
| 16 | note | Stage 01 compares every token row; no count in the text. | stage 01 |
| 17 | note | Every existing variant and size stays (`Badge` `ghost`, `link`; `TabsList` `line`, vertical; `SelectTrigger` `sm`). | `interfaces.md` § Primitives, stage 05 |
| 18 | note | The banners keep their meaning: the paused organization is red (destructive soft), the mailbox login error is the warm warning. | stage 03 |
| 19 | note | D13: neutral hover and active fills move from `accent` to `muted` in stage 03; a guard keeps it. | D13, stages 03, 07 |
| 20 | note | The shell ticket's acceptance no longer asks for a lead line on every page. | F167 `ticket.md` |
| 21 | note | `EmptyState` takes `headingLevel`. Stage 03 replaces the computed radius scale with fixed values. | `interfaces.md`, stages 03, 10 |
| 22 | note | No shared edit of `alert.tsx` (see 6). Stage 03 adds a "Look" part to the capability page. `/operator` is skipped in the sheet, with the reason. | stages 02, 03 |
