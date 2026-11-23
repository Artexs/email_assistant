# F167 plan — the Pebble shell, brand and pages before sign-in

> **Status 2026-11-24 — planned.** Plan base: 8c9acfc1e. Seven stages; nothing built. No owner step is open.

Shared decisions (PB-1…13, DB-1…11) and § Rules for width: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Tokens, pattern props, shell contract: `spec/features/*/F166-*/interfaces.md`. The drawing: `design/ui-proposals/proposals/03-pebble/index.html` (`.side`, `.brand`, `.mhead`, `.mtabs`, `.login`) and `shots/`.

## Input

Owner's words: the programme page. This plan's task (2026-11-23): "Its stages need F166 stages 03, 06, 09 and 10 only, so the four Pebble tickets build next to each other."

### Decisions of this ticket

- **D1 Navigation does not change (PB-4).** `nav-items.ts` stays; the phone overflow stays in the menu sheet behind `menu_open`. Rejected: the mockup's tab set and phone-header avatar (it hides the overflow behind a person icon).
- **D2 Locators stay:** both `navigation` elements named `nav_main`, the `menu_open` button and its `dialog`, the `user_menu` button and its `menuitem`, `aria-current="page"`, the banners' `role="status"`, the badge with its `sr-only` text. Breaking one is a question.
- **D3 One `h1` (DB-9).** The shell renders the one `PageHead` (F166 stage 09). The phone header shows `BrandMark` and the brand name as plain text. `PageHead.tsx` is F166's; a needed change is a question.
- **D4 The brand mark.** `BrandMark` is the mockup `.pb` tile (36 px, radius 12 12 12 4 px, lucide `Mail`), `aria-hidden`. The icons and the favicon use its shape and the light `--primary` `#0a7568` and `--primary-foreground` `#ffffff`.
- **D5 Icons are committed PNG files made from one SVG.** Source `apps/web/brand/mark.svg` (outside `src`: the F166 colour scan skips it). The `@ea/web` script `icons` (`scripts/build-icons.ts`) renders it with the Chromium of `@playwright/test` (already a dev dependency). The file paths stay; a new `/icons/apple-touch-icon.png` (180 px, full bleed: iOS paints a transparent edge black). 
- **D6 Browser colour (default, owner to confirm).** `theme-color` light `#0a7568` (teal, PB-9), dark `#0d1513` (dark `--background`; a mint bar glares). Manifest `theme_color` `#0a7568`, `background_color` `#f3f6f5`. F166 D10 allows them in the two layouts; each layout keeps its own head tags (a shared partial leaves the F166 guard's allow list).
- **D7 The shell frame (interface for F168–F170).** From `lg`: a grid of 248 px and the rest, 20 px gap and padding; the sidebar is a sticky card (`bg-sidebar`, radius `xl`, `shadow-card`, viewport height less 40 px); on a short window its item list scrolls, brand and foot stay. `main` has no max width: each page sets its own content width. Below `lg`: 14 px side padding, bottom padding `--tabbar-height` + safe-area inset + 1.5 rem; `StickyActions` brings its own spacer.
- **D8 Sidebar items.** Radius `md`, 48 px, `text-muted-foreground`, hover `bg-muted`, active `bg-primary-soft text-primary`. The foot: the help link (flag `docs_links`) and the user menu with `InitialsAvatar` of `me.user.displayName`. No "You stay in charge" card: new promise text that no claim backs (PB-8; default, owner to confirm).
- **D9 Tab bar.** `bg-card`, a top border, height `--tabbar-height`, bottom padding `env(safe-area-inset-bottom)`; active tab `text-primary`; items and badge as today. The inset is 0 until a layout sets `viewport-fit=cover`; this ticket does not (with it, the top bar and the public pages would need top insets too).
- **D10 Pages before sign-in.** `Public.astro` prop `frame: "card" | "split" | "reading"` (default `card`; replaces `reading`). `card`: the centred column with `BrandMark` and the name. `split`: full width; the island draws two columns. `reading`: the legal column in a card. Login and setup (an invited person's first page; default, owner to confirm) use `split`; forgot uses `card`.
- **D11 The login brand panel.** `AuthCard` gains `panel?: boolean`. With it, from `lg` a left column (`bg-primary text-primary-foreground`) shows the inverse mark, the name, a `text-3xl` line and one sentence; below `lg` only the form, the mark above it. The panel line is a `p` (the form title is the one `h1`). No fake mail cards, no gradient (DB-2, PB-7). Texts (default, owner to confirm): `login_panel_title` en "The assistant sorts your mail and prepares drafts." pl "Asystent sortuje pocztę i przygotowuje szkice." (claim C046); `login_panel_text` en "Nothing is sent until an owner approves it." pl "Nic nie zostanie wysłane bez zatwierdzenia właściciela." (C047, `docs/legal/claims.md`). Role-neutral: an assistant member sees the page too and cannot approve.
- **D12 Every sign-in state keeps its text, key and test.** No logic change in `LoginPage`, `SsoSignIn`, the code step, the `?setup=done` and `?deleted` alerts. Button variants stay.
- **D13 Offline works with the new look.** The worker precaches `/offline.html` and the `/_astro/` files it needs (CSS, fonts). `scripts/build-sw.ts` reads `dist/offline.html` and its CSS after `astro build` and puts the list into the bundle; the cache name ends in a hash over the bytes of `offline.html` and of the listed files, so a new text or new files make a new cache and `activate` deletes the old one. Rejected: parsing HTML at install (run-time code).
- **D14 No F166 file.** No stage edits `global.css`, `components/ui/` or `components/patterns/`.
- **D15 A gap or deviation is a question, not a choice.**
- **D16 One capability-page place per stage** (parallel stages must not edit one line): 01 rule 10; 02 and 03 a new rule "The shell frame" at the end of § Rules; 04 the banner sentence of rule 9; 05 rule 3; 06 the "Look" part (F166 stage 03); 07 the installable-shell part of rule 2.

## Facts checked (2026-11-24, at 8c9acfc1e)

- Shell files, the D2 locators, the seed organizations: scouts 1 and 4 ([`scouts.md`](scouts.md)), `AppShell.tsx`, `Nav.tsx`, `nav-items.ts` read; review G1.
- `#000832` in both layouts and the manifest; four PNG files, no generator; no test asserts a colour (scout 3, read). `me.user.displayName` exists.
- The worker precaches only `/offline.html`; `/_astro/` is cache-first; `register-sw` runs only in `App.astro` (scout 2, read).

## Not verified

- Playwright's Chromium renders the SVG with exact colours: stage 01 test 4.
- How many CSS files the offline page links: stage 07 reads `dist/offline.html`.

## Done when

The 6 acceptance items of [`ticket.md`](ticket.md) hold.

## Rules for every stage

- Token classes only (DB-2); allowed raw colours: D6 and `brand/mark.svg`. No feature flag (PB-1). No `bun.lock` change, no migration (DB-1).
- Keep the names of D2. A new text is a key in `en` and `pl` next to the keys of its part (Rules for width 4).
- Each stage updates its D16 place in `docs/capabilities/web-panel.md` (DB-11) and a user docs page that describes what it changed.
- Run `UI_SHEET_ROUTES=<your routes> bun run ui:sheet`, open the PNG files of your routes, give their paths in the final message.
- Format only the files of your stage.

## Proof

`mkdir -p /tmp/f167-NN && bun run check:job > /tmp/f167-NN/check.log 2>&1 && bun run web:build:dev > /tmp/f167-NN/build.log 2>&1 && bunx playwright test -c apps/web/e2e/playwright.config.ts <specs of the stage> patterns.spec.ts > /tmp/f167-NN/e2e.log 2>&1 && echo PROOF_OK`

Stages 02 and 03 change every page frame: they run `bun run test:e2e` instead of a spec list.

## User checkpoints and steps

None. The owner looks at the full contact sheet before the release (PB-12, F172).

## Review

Sonnet review before the land of 01–04, 06, 07; Opus for 05 (new Polish text, sign-in page). The task adds: "Open the pictures the worker named and the mockup shots; report each difference from the mockup's pattern."

## Stages

| # | Stage | Needs (F166 08 for the Proof in all) | May run next to |
| --- | --- | --- | --- |
| 01 | [Brand mark, icons, browser colour](stages/stage-01-brand.md) | F166 03 | 04, 07 |
| 02 | [Desktop frame, user menu, page states](stages/stage-02-frame.md) | F166 03, 06, 09; 01 | 04–07 |
| 03 | [Phone header, menu sheet, tab bar](stages/stage-03-phone-frame.md) | 02 | 04–07 |
| 04 | [Banners, terms dialog, cards](stages/stage-04-shell-parts.md) | F166 03 | all |
| 05 | [Sign-in pages](stages/stage-05-sign-in.md) | F166 03; 01 | 02, 03, 04, 07 |
| 06 | [Legal, 404, offline page, `/`](stages/stage-06-static-pages.md) | 05 | 02, 03, 04, 07 |
| 07 | [Offline precache](stages/stage-07-offline-cache.md) | F166 03 | all |

## How to run (coordinator)

Move the folder to `active/` and commit first. One job per stage, board worker flags, `--prepare 'bash scripts/limen-prepare.sh'`:

```
limen spawn <flags> --label "<what the stage changes> · F167" 'Implement F167 stage NN. Read docs/product/pebble-ui/README.md, F166 interfaces.md, and ticket.md, plan.md, stages/stage-NN-<slug>.md of spec/features/active/F167-<slug>/. Final proof: the Proof of plan.md. List as proven only what a saved log shows.'
```

Start a stage when its Needs landed. Land with `--keep-open` but the last; drop the job DB.

## Planning progress

Stages 01–07 [written]. Scouts: 4 ([`scouts.md`](scouts.md)). Words: plan 1,494; stages 624, 673, 540, 587, 696, 520, 606.

## Cold review

One round, Opus (new Polish text), 2026-11-24: [`plan-review-1.md`](plan-review-1.md), 1 blocking, 9 gaps, 11 notes. Fixed: B1, G1–G9, N1–N3, N5, N7–N9. Rejected: N4 (see D9); N6 (the no-organization card is a few token classes; F172 sweeps leftovers).

## Log

- 2026-11-24: plan written; cold review fixed (it cites the five-stage numbering); stage 02 split into 02 and 03, stage 05 into 06 and 07.
