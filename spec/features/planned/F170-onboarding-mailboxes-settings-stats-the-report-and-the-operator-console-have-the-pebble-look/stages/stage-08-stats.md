# F170 stage 08 — Stats: the week at a glance above the table

Needs F166 stage 02: `ui:sheet`, the a11y `schemes` option. Needs F166 stages 04, 05: the primitives. Needs F166 stage 08: `web:build:dev`, `patterns.spec.ts` (the Proof). Needs F166 stage 06: `ProgressRing`, `StatTile`. Needs F166 stage 09: `AppShell` `lead`. Needs F166 stage 10: `EmptyState`, `FactBox`. May run next to 01–07, 09, 10.

Part of [`../plan.md`](../plan.md). Decisions: P6, P9, D5, D6; questions.md items 6, 7.

Owns: `apps/web/src/islands/StatsPage.tsx`, `components/stats/`, `apps/web/src/lib/stats-view.ts`, `stats.spec.ts`, the `stats_*` keys (in `texts/*-activity.ts`, next to the other `stats_*` keys).

## Step 1 — `statsHead`

- **Interface:** in `lib/stats-view.ts`:
  ```ts
  statsHead(week: WeekStats, split: boolean): {
    ring: { value: number; max: number; percent: string; label: TextKey };
    tiles: { value: string; label: TextKey }[]; // exactly 3, in this order
  }
  ```
  `split` is the same test as in `statsRows` (some week has `m2.byKind`); the page passes it from all loaded weeks.
- **Decisions (P6):** the week is `weeks[0]`. The ring: `m4.handled` of `m4.triaged`, label `stats_m4`; in a shadow week (`handled` 0 and `wouldHandle` > 0) it shows `wouldHandle` of `triaged` with the label `stats_m4_would`. `percent` is the whole percent with `%`, or `–` when `triaged` is 0 (then `max` 0: an empty ring). Tiles: `m3.total` as a number, label `stats_m3`; `m5.p90Minutes` as `"<n> min"` (`stats_minutes_short`, one decimal at most, as the table trims it) or `–` when null, label `stats_m5`; `m2.closedOnTime` of `m2.due` as the whole percent or `–` when `due` is 0, label `stats_m2_loops_closed` when `split`, else `stats_m2_closed`. Reuse the helpers of `stats-view.ts` (`percentOf`, `formatTrimmed`) so the head and the table never disagree. This is display of existing counts, not a new metric (`docs/code-patterns.md` § Metrics).
- **Test (unit, `test.each`):** (1) `m4 { triaged: 200, handled: 150, wouldHandle: 0 }` → ring `{ value: 150, max: 200, percent: "75%", label: "stats_m4" }`. (2) `m4 { triaged: 200, handled: 0, wouldHandle: 120 }` → `{ value: 120, max: 200, percent: "60%", label: "stats_m4_would" }`. (3) `m4 { triaged: 0, handled: 0, wouldHandle: 0 }` → `{ value: 0, max: 0, percent: "–" }`. (4) `m5.p90Minutes: null`, `m2.due: 0`, `m3.total: 0` → tiles `["0", "–", "–"]`. (5) `m3.total: 2`, `m5.p90Minutes: 12.4`, `m2 { due: 4, closedOnTime: 3 }`, `split: true` → tiles `["2", "12.4 min", "75%"]` and the third label `stats_m2_loops_closed`. (6) For each test row, the ring percent equals the percent inside the `stats_m4` (or `stats_m4_would`) cell of `statsRows` for the same week, or both are `–`.

## Step 2 — The page

- **Look (mockup screen `stats`, shot `06a-*`):** from `lg` a hero card with the ring (`lg` size, the percent inside, label = the ring label in the panel language) and the week label (`weekLabel(weeks[0].weekStart)`) next to three `StatTile`s; below `lg` the hero, then the tiles in one row of three (they wrap at 320 px). Then the full table as today in a `Card`, then `stats_note`. No hours saved, no bar chart (PB-7).
- **Page head:** `lead="stats_lead"`: "The numbers of the last finished weeks." No action. The mailbox select stays above the hero (it is a filter, not the page action).
- **States:** flag off (`stats_off`) → `FactBox`. No week (`stats_empty`) → `EmptyState` (icon `ChartColumn`), no hero. Loading → skeletons with `aria-busy`. Error → `stats_load_error`. A gone mailbox → `stats_mailbox_gone` above the hero; the hero then shows all mailboxes.
- **Test:** (7) e2e `stats.spec.ts`: the table, the ring (`role="img"` with its label) and three tiles show; the a11y scan passes on both projects. (8) e2e with `page.route` on `/api/stats` answering `{ weeks: [] }`: the empty state shows and no ring.

## Step 3 — Docs

Update the Stats part of `docs/capabilities/web-panel.md` rule 9 and the stats page of `apps/docs` (English and Polish) if one names the table as the only content.

## Out of scope

A new metric, a new field of `weekStatsSchema`, the cost row's rules, a chart.

## Done when

The sheet row `stats` matches shot `06a-*` without the bar chart; the Proof of `../plan.md` with `stats.spec.ts` prints `PROOF_OK`.
