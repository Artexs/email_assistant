# F100 stage 18 — Stats page

Part of [`../plan.md`](../plan.md). Needs stage 12 on `master`. Shared web files: "Panel to Astro 7" (F101), E7-T1 Polish UI (F098), the operator page of F099 stage 10 and E4-A (F102) edit the shell, `nav-items.ts`, `en.ts` and `pl.ts`; merge `master` before the proof if one of them landed.

After this stage a member of an organization with `stats_page` on sees "Stats" in the panel navigation and a read-only page with the last 8 finished weeks: one table, the metrics as rows, the weeks as columns, each cell a rate with its count, and a mailbox select (D25).

## Step 1 — The nav item from `/api/me` features

**Goal.** The nav shows "Stats" only when the organization has `stats_page` on (D25).

`/api/me` already returns `features: string[]` (F099 stage 06, plan F16: `meSchema` in `packages/core/src/web/me.ts`, filled in `tenancy/routes.ts`, proven by the `web-me.test.ts` case "operator and features"). Do not change the server or the schema.

**Files.** `apps/web/src/components/shell/nav-items.ts` (`NavKey` gains `"stats"`; `STATS_ITEM`; `navItems`), `apps/web/src/components/shell/Nav.tsx` (`BottomTabs`, `Sidebar` and `MenuSheet` use `navItems(features)` instead of `TAB_ITEMS`; the bottom grid class comes from a fixed map `{ 4: "grid-cols-4", 5: "grid-cols-5" }`, never a built class name), `apps/web/src/components/shell/AppShell.tsx` (pass `me?.features ?? []` to the nav parts; it reads `me` from `useMe()` already), `apps/web/src/i18n/en.ts` and `pl.ts` (`nav_stats`; `pl.ts` is `Record<TextKey, string>`, so typecheck fails without the Polish key; the Polish word follows the F098 glossary, for example "Statystyki").

**Interfaces.**

```ts
// nav-items.ts
export const STATS_ITEM: NavItem = { key: "stats", href: "/stats", label: "nav_stats", icon: BarChart3 }; // lucide-react has BarChart3
export function navItems(features: readonly string[]): NavItem[]; // TAB_ITEMS, plus STATS_ITEM after "activity" when "stats_page" is on
```

F099 stage 10 adds `OPERATOR_ITEM` to the same three files (shown when `me.operator`): if it landed first, keep it and add `STATS_ITEM` beside it; if not, leave room for it (do not fold the operator item into `navItems`).

**Decisions.** D25.

**Test.**

1. Unit, `apps/web/src/lib/nav-items.test.ts` (it imports `../components/shell/nav-items`; `test:unit` runs `apps/web/src/lib`): `navItems([])` → 4 items; `navItems(["stats_page"])` → 5 items, the second is `stats`; `navItems(["security_log"])` → 4 items.

**Check.** `bun test apps/web/src/lib/nav-items.test.ts apps/web/src/i18n/`

**Done when.** Case 1 passes; `bun run typecheck` passes for the web.

**Out of scope.** Any other page's use of `features`; the server side of `features`.

## Step 2 — The page

**Goal.** `/stats` shows `GET /api/stats` as one table (D25, D27).

**Files.** `apps/web/src/pages/stats.astro` (new, like `activity.astro`: `<App titleKey="title_stats"><StatsPage client:only="react" /></App>`; islands render on the client only, F098 D2), `apps/web/src/islands/StatsPage.tsx` (new), `apps/web/src/components/stats/StatsTable.tsx` (new), `apps/web/src/lib/stats-view.ts` (new, pure) + `stats-view.test.ts`, `apps/web/src/lib/api.ts` only if it needs a query helper, `apps/web/src/i18n/en.ts` and `pl.ts` (every key below and `title_stats`, in both; plan D31), `docs/capabilities/web-panel.md` (the pages list or rule that names the panel pages: `/stats`, read-only, behind `stats_page`; Entry points: a `page` row `/stats` (the weekly numbers, read-only) → `apps/web/src/islands/StatsPage.tsx`, as the other page rows), `docs/capabilities/measurement.md` ("What it does now": the stats page; Entry points: the page row; remove its "no stats page" Limits item); refresh each "Checked against" line.

**Interfaces.**

```ts
// lib/stats-view.ts — pure: the table model from the API answer.
export interface StatsCell { text: string } // e.g. "20% (1 of 5)", "–", "$0.41"
export interface StatsRow { label: TextKey; cells: StatsCell[] } // one cell per week, newest first
export function statsRows(weeks: readonly WeekStats[]): StatsRow[];
export function weekLabel(weekStart: string): string; // "16 Nov"
```

Rows and their cell text (one function per row; `rate(n, d)` as stage 16's `rateText`: `d = 0` → `–`):

| `label` key (en text) | Cell |
| --- | --- |
| `stats_m1` "Missed important mail (lower bound)" | `rate(misses, important)` |
| `stats_m1_sample` "Random review sample: missed" | `${misses} of ${important}` (`–` when `labelled = 0`) |
| `stats_m2_closed` "Delegations closed on time" | `rate(closedOnTime, due)` |
| `stats_m2_surfaced` "Delegations surfaced on time" | `rate(surfacedOnTime, due)` |
| `stats_m3` "Serious mistakes" | `${total}` |
| `stats_m4` "Handled for you" | `rate(handled, triaged)` |
| `stats_m4_would` "Would handle (shadow)" | `rate(wouldHandle, triaged)` |
| `stats_m5` "Urgent notice time (p90)" | `${p90Minutes} min (${noticed})` or `–` |
| `stats_m7` "Cost per mailbox per month" | `$${perMailboxMonthUsd.toFixed(2)}` |
| `stats_m8_<category>` "Auto evidence: <category>" (five rows, the bar categories) | the `m8` rows of that category: one mailbox → `${round(precision × 100)}% of ${kept} (≥ ${round(wilsonLower × 100)}%)${auto ? " · auto" : ""}` or `–`; all mailboxes → the row with the most `kept` |

Page: `AppShell` with `active="stats"`; a mailbox select ("All mailboxes" + each address, from `/api/mailboxes`, shown only with 2+ mailboxes, like the activity filter); `useResource(() => api(`/api/stats?weeks=8${mailbox ? `&mailboxId=${id}` : ""}`, statsResponseSchema))`, no polling (`pollMs` unset: the numbers change once a week); a `Table` from `components/ui/table.tsx` with a header row of `weekLabel`s; a note line under it: `t("stats_note")` = "Numbers of finished weeks. Missed mail is a lower bound: it counts only the misses you found." A 404 (flag off) → a `Card` with `t("stats_off")` in the form of `components/shell/Placeholder.tsx` (that component takes no text prop and prints `placeholder_text`; do not change it, plan F18). Every string through `t()`; no literal text in the components (`react/jsx-no-literals`).

**Decisions.** D25, D27.

**Test** (unit, `stats-view.test.ts`):

1. `statsRows([<stage 12 case 1 WeekStats>])` → the `stats_m1` cell `20% (1 of 5)`, `stats_m4` `33% (3 of 9)`, `stats_m5` `3 min (1)`, `stats_m7` `$0.41`.
2. A week with `m2.due = 0` → `stats_m2_closed` cell `–`.
3. Two weeks → each row has 2 cells, the newest first; `weekLabel("2026-11-16")` → `16 Nov`.
4. `en.test.ts` (exists) passes with the new keys.

**Check.** `bun test apps/web/src/lib/stats-view.test.ts apps/web/src/i18n/ apps/server/src/capability-map.test.ts && bun run web:build`

**Done when.** Cases 1–4 pass; the web build passes; `bun run lint` passes on the new components.

**Out of scope.** Charts; an e2e test (the board's e2e runs under a lock; not in this stage); the E4-B autonomy page.

## Done when (stage)

Steps 1–2 done; the Proof command of `plan.md` passes (`/tmp/f100-s18`).
