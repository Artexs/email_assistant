# F170 stage 09 — The shadow report: one card per category

Needs F166 stage 02: `ui:sheet`, the a11y `schemes` option. Needs F166 stage 04: `Button` `soft` and `destructive-soft`, 48 px fields. Needs F166 stage 05: `Dialog`, `Table`, `Skeleton`. Needs F166 stage 08: `web:build:dev`, `patterns.spec.ts` (the Proof). Needs F166 stage 06: `ProgressRing`, `CategoryPill`. Needs F166 stage 09: `AppShell` `lead`. Needs F166 stage 10: `SectionCard`, `EmptyState`, `FactBox`. May run next to 01–08, 10. It uses `MailboxSelector` (stage 02) unchanged.

Part of [`../plan.md`](../plan.md). Decisions: P7, P9, D1, D5, D6.

Owns: `apps/web/src/islands/ReportPage.tsx`, `components/report/`, `apps/web/src/lib/report-view.ts`, `report.spec.ts`, the `rep_*` keys (in `texts/*-reply.ts`, next to the other `rep_*` keys).

## Step 1 — The category cards

- **Decisions (P7; mockup screen `report`, shot `06b-*`):**
  - One `article` card per category of `REPORT_CATEGORIES` (`info`, `notification`, `spam`), keeping `data-category`. A grid: one column below `lg`, three from `lg`.
  - Card top: `CategoryPill` (`categoryLook`, the label `cat_<category>`) and the status as a `Badge`: `rep_auto_on` (`default`), `rep_recommended` (`default`), `rep_not_recommended` (`secondary`). The `data-status` attribute stays. The recommended card gets the primary outline.
  - The ring: `ProgressRing` with `value` = `history.wouldMove`, `max` = `history.total`, label = the `rep_counts` text, the number `wouldMove` inside. With `history: null` there is no ring and no count line (as today: no line).
  - The trust lines (`trustLines`) keep their order, keys, `data-line` and tones (`bad` = destructive text).
  - No button per card (PB-5: the one "Turn on recommended" below is the only way).
- **The action card** below the grid: the turned-on line (`role="status"`), the button `rep_turn_on` with the due categories (owner who can write), `rep_owner_only` for others, the review link (`rep_review_suggest`), "Check again" as a `soft` button. This card shows only on today's conditions (`showTurnOn`, `showCheckAgain`, `showCategories`).
- **Edge cases:** `starting` and `running` keep their `aria-live="polite"` lines (`data-report="starting"`, `"progress"`) and show no cards, as today; `no_result` shows its sentence; `nothing` and `all-on` notes are `FactBox`es with their `data-report`. The component still never reads `view.examples`. `history.total` 0 → an empty ring (`max` 0).
- **Test:** (1) render test: a done view with `notification` `history { total: 40, wouldMove: 12 }` renders a ring named by the `rep_counts` text for 40 and 12 and one `CategoryPill` per category; a view with `history: null` for `spam` has no ring in the `spam` card. (2) Render test: no card has a button; exactly one button `rep_turn_on` shows for an owner with a due category. (3) e2e `report.spec.ts` R1–R8 pass on both projects with their a11y scans.

## Step 2 — The page

- **Page head:** `lead="rep_lead"`: "What the assistant would have done with your recent mail. Nothing changed." No action. `rep_intro` stays as the first line of the content (it holds the period and the mailbox rule).
- **States:** flag off (`rep_off`) → `FactBox`. No mailbox (`rep_no_mailbox`) → `EmptyState` (icon `Inbox`, the button to `/mailboxes`). Load error and Retry as today. The mailbox select stays above the cards when there are two or more mailboxes.
- `rep_read_only` is a muted line at the end.

## Step 3 — Docs

Update the Report part of `docs/capabilities/web-panel.md` (trust ladder pages) and the user docs page `explanation/shadow-and-assist` (English and Polish) if it names the report's layout.

## Out of scope

Any trust rule, check or recommendation logic (`report-view.ts` keeps its functions; add only what the look needs). The per-card "Turn on" of the mockup. The review page (another ticket).

## Done when

The sheet rows `report` and `report-off`, and the running and no-result pictures that `report.spec.ts` saves under `<UI_SHEET_DIR>/f170-09/` (D7), match shot `06b-*` with one action card; the Proof of `../plan.md` with `report.spec.ts onboarding.spec.ts` prints `PROOF_OK`.
