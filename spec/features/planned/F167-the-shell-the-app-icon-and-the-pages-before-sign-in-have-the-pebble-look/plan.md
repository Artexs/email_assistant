# F167 plan — the Pebble shell, brand and pages before sign-in

> **Status 2026-11-24 — planned.** Plan base: 8c9acfc1e. Five stages; nothing built. No owner step is open.

Shared decisions (PB-1…13, DB-1…11) and § Rules for width: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Token values, pattern props and the shell contract: F166 `interfaces.md` (`spec/features/*/F166-*/interfaces.md`). The drawing: `design/ui-proposals/proposals/03-pebble/index.html` (classes `.side`, `.brand`, `.mhead`, `.mtabs`, `.login`, `.pagehead`) and its `shots/`.

## Input

The owner's words are on the programme page. The task of this plan (2026-11-23): "Its stages need F166 stages 03, 06, 09 and 10 only, so the four Pebble tickets build next to each other."

### Decisions of this ticket

- **D1 Navigation does not change (PB-4).** `nav-items.ts` keeps its order, flags, `PHONE_TAB_LIMIT` and labels; the phone overflow stays in the menu sheet behind `menu_open`. Rejected: the mockup's tab set and its avatar in the phone header (it would hide the overflow behind a person icon).
- **D2 Locators stay.** These stay: both `navigation` elements named `nav_main`, the `menu_open` button and its `dialog`, the `user_menu` button and its `menuitem`, `aria-current="page"`, the banners' `role="status"`, the badge with its `sr-only` text. Breaking one is a question.
- **D3 One `h1` (DB-9).** The shell renders the one `PageHead` (F166 stage 09). The phone header shows `BrandMark` and the brand name as plain text, never a heading. F167 does not edit `components/patterns/PageHead.tsx` (F166 owns it); a needed change there is a question.
- **D4 The brand mark.** `BrandMark` is the mockup `.pb` tile (36 px, radius 12 12 12 4 px, lucide `Mail`), `aria-hidden`. The icons and the favicon use its shape and the light `--primary` `#0a7568` and `--primary-foreground` `#ffffff`.
- **D5 Icons are committed PNG files made from one SVG.** The source is `apps/web/brand/mark.svg` (outside `src`, so the F166 colour scan does not read it). The `@ea/web` script `icons` (`apps/web/scripts/build-icons.ts`, next to `build-sw.ts`) renders it with the Chromium of `@playwright/test`, which `@ea/web` has already. The file paths stay; a new `/icons/apple-touch-icon.png` (180 px, full bleed: iOS paints a transparent edge black). Rejected: `sharp` (optional, not installed).
- **D6 Browser colour (default, owner to confirm).** `theme-color` light `#0a7568` (teal, PB-9), dark `#0d1513` (the dark `--background`: a mint bar over a dark page glares). Manifest `theme_color` `#0a7568`, `background_color` `#f3f6f5`. F166 D10 allows these raw colours in the two layouts. Both layouts keep their own head tags (a shared partial would move them out of the F166 guard's allow list).
- **D7 The shell frame (interface for F168–F170).** From `lg`: a grid of 248 px and the rest, 20 px gap and padding; the sidebar is a sticky card (`bg-sidebar`, radius `xl`, `shadow-card`, viewport height less 40 px). `main` has no max width: each page sets its own content width. Below `lg`: 14 px side padding, bottom padding `--tabbar-height` + safe-area inset + 1.5 rem; `StickyActions` brings its own spacer.
- **D8 Sidebar items.** Radius `md`, 48 px high, `text-muted-foreground`; hover `bg-muted`; the active item `bg-primary-soft text-primary`. The foot holds the help link (flag `docs_links`) and the user menu with `InitialsAvatar` of `me.user.displayName`. No "You stay in charge" card: it is new promise text that no claim row backs (PB-8). Default, owner to confirm.
- **D9 Tab bar.** `bg-card`, a top border, height `--tabbar-height`, bottom padding `env(safe-area-inset-bottom)`; active tab `text-primary`; items and badge as today.
- **D10 Pages before sign-in.** `Public.astro` gets one prop `frame: "card" | "split" | "reading"` (default `card`; it replaces `reading`). `card`: the centred column with `BrandMark` and the name. `split`: full width; the island draws two columns. `reading`: the legal column in a card. Login and setup use `split` (setup is an invited person's first page; default, owner to confirm); forgot uses `card`.
- **D11 The login brand panel.** `AuthCard` gains `panel?: boolean`. With it, from `lg` a left column on `bg-primary` with `text-primary-foreground` shows the inverse mark, the name, a line in `text-3xl` and one sentence; below `lg` only the form, with the mark above it. The panel line is a `p`, not a heading (the form title stays the one `h1`). No fake mail cards and no gradient (DB-2, PB-7). Texts (new keys next to the login keys; default, owner to confirm): `login_panel_title` en "Your mail, sorted. You decide what goes out." pl "Twoja poczta, uporządkowana. Ty decydujesz, co wychodzi."; `login_panel_text` en "The assistant sorts your mail and writes drafts. Nothing is sent until you approve it." pl "Asystent porządkuje pocztę i przygotowuje szkice. Nic nie wychodzi, dopóki tego nie zatwierdzisz." Claim source: `docs/legal/claims.md` C047.
- **D12 Every sign-in state keeps its text, its key and its test.** No change in the logic of `LoginPage`, `SsoSignIn`, the code step or the `?setup=done` and `?deleted` alerts. Button variants stay (F166 restyles them).
- **D13 Offline works with the new look.** The service worker precaches `/offline.html` and every `/_astro/` file that it needs (its CSS and the two font files). `scripts/build-sw.ts` reads `dist/offline.html` and its CSS after `astro build` and puts the list into the bundle; the cache name ends in a short hash of that list, so each build with new files makes a new cache and `activate` deletes the old one. Rejected: parsing HTML in the worker at install (run-time code, harder to test).
- **D14 No global file of F166.** No stage edits `global.css`, `components/ui/` or `components/patterns/`. The legal hand CSS reads tokens already.
- **D15 A gap or a deviation is a question in the final message, not a choice.**

## Facts checked (2026-11-24, at 8c9acfc1e)

- Shell files and the e2e locators of D2: scouts 1 and 4, `AppShell.tsx`, `Nav.tsx`, `nav-items.ts` read.
- `me.user.displayName` exists (`packages/core/src/web/me.ts`).
- Both layouts and the manifest carry `#000832`; four PNG files, no generator, no brand component; no test asserts a colour (scout 3; layouts read).
- The worker precaches only `/offline.html`; `/_astro/` is cache-first after a first online load; the bundle test in `pwa-shell.test.ts` builds `sw/sw.ts` (scout 2; read).
- e2e `mobile` is the Pixel 7, `desktop` 1280 × 800 (`playwright.config.ts`).

## Not verified

- Playwright's Chromium renders the SVG with exact colours: stage 01 test 4.
- How many CSS files the offline page links: stage 05 reads `dist/offline.html`.

## Done when

The acceptance list of [`ticket.md`](ticket.md) holds (6 items).

## Rules for every stage

- Open the mockup shots of the parts you build.
- Token classes only (DB-2); allowed raw colours: D6 and `brand/mark.svg`. No feature flag (PB-1). No `bun.lock` change, no migration (DB-1).
- Keep the names of D2. A new text is a key in `en` and `pl` next to the keys of its part (Rules for width 4).
- Each stage updates its part of `docs/capabilities/web-panel.md` (DB-11) and the user docs page that describes what it changed, if one does.
- Run `UI_SHEET_ROUTES=<your routes> bun run ui:sheet`, open the phone and desktop PNG in both schemes and both languages, and give their paths in the final message.
- Format only the files of your stage.

## Proof

`mkdir -p /tmp/f167-NN && bun run check:job > /tmp/f167-NN/check.log 2>&1 && bun run web:build:dev > /tmp/f167-NN/build.log 2>&1 && bunx playwright test -c apps/web/e2e/playwright.config.ts <specs of the stage> patterns.spec.ts > /tmp/f167-NN/e2e.log 2>&1 && echo PROOF_OK`

Stage 02 changes every page frame: it runs `bun run test:e2e` instead of a spec list.

## User checkpoints and steps

None in this ticket. The owner looks at the full contact sheet before the release (PB-12, F172).

## Review

Sonnet review before the land of 01, 02, 03, 05; Opus for 04 (new Polish text, sign-in page). The task adds: "Open the pictures the worker named and the mockup shots; report each difference from the mockup's pattern."

## Stages

| # | Stage | Needs | May run next to |
| --- | --- | --- | --- |
| 01 | [Brand mark, icons, browser colour](stages/stage-01-brand.md) | F166 03 | 03 |
| 02 | [The frame: sidebar, phone header, tab bar](stages/stage-02-frame.md) | F166 03, 06, 09; 01 | 03, 04, 05 |
| 03 | [Shell parts: banners, dialogs, cards](stages/stage-03-shell-parts.md) | F166 03 | 01, 02, 04, 05 |
| 04 | [Sign-in pages](stages/stage-04-sign-in.md) | F166 03; 01 | 02, 03 |
| 05 | [Legal, 404, offline, `/`](stages/stage-05-static-pages.md) | 04 | 02, 03 |

## How to run (coordinator)

Move the folder to `active/` and commit before the first spawn. One job per stage, board worker flags, `--prepare 'bash scripts/limen-prepare.sh'`:

```
limen spawn <flags> --label "<what the stage changes> · F167" \
  'Implement F167 stage NN. Read docs/product/pebble-ui/README.md, spec/features/active/F166-<slug>/interfaces.md and, in spec/features/active/F167-<slug>/, ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof of plan.md. In the final message, list as proven only what a saved log shows.'
```

Start each stage when its Needs have landed. Land with `--keep-open` but the last. Drop the job DB after the land.

## Planning progress

Stages 01–05 [written]. Scouts: 4 ([`scouts.md`](scouts.md)). Words: plan 1,494; stages 605, 696, 553, 700, 696.

## Cold review

One round, Opus (new Polish text): pending.

## Log

- 2026-11-24: plan written.
