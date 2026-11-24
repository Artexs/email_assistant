# F167 stage 06 — Legal reading frame, 404, offline page and `/`

Part of [`../plan.md`](../plan.md). Needs stage 05: the `frame` prop of `Public.astro`. Needs stage 01: `BrandMark`. Needs F166 stage 08: `web:build:dev` and `patterns.spec.ts` (the Proof). May run next to 02, 03, 04, 07.

This stage owns the legal page and `components/legal/*.astro`, the 404, offline and `/` pages, and the `reading` branch of `Public.astro`. It does not edit the service worker or its build script (stage 07).

## Step 1 — The reading frame

- **Decisions:** D10, D14. `reading`: a column of at most 768 px; `BrandMark` and the brand name at the top, as a link to `/login`; the text in one card-look block (radius `lg`, `shadow-card`, padding 24 px, 16 px below `lg`); the `h1` `text-3xl` from `lg`, `text-2xl` below.
- The `.legal-*` CSS in `global.css` does not change (D14). The draft line, the version line, the tables and the link to sign in keep their `data-legal` attributes, roles and texts.
- **Edge cases:** at 320 px no sideways scroll of the page; a wide legal table scrolls inside `.legal-table`.

## Step 2 — 404, offline and `/`

- **404 and offline:** the `card` frame; one card with an icon tile (`bg-primary-soft text-primary`; `SearchX` for 404, `WifiOff` for offline); the Polish block first and the English block second, as today. Each link has a full-width button look (`bg-primary text-primary-foreground`, radius full, 48 px high). One `h1` (the Polish title), as today; the English title stays a `p`.
- **`/`:** the `card` frame; the meta refresh and the bilingual link stay; the link has the button look.
- **Edge cases:** the offline page has no island and no script of its own: it must render from its HTML and CSS only (stage 07 caches exactly those files). The texts and keys do not change.

## Step 3 — Capability page

`docs/capabilities/web-panel.md`, the "Look" part that F166 stage 03 added, and only there (D16): one sentence on the look of the reading frame and of the 404 and offline pages.

## Test

1. e2e `legal.spec.ts`: on `desktop` and `mobile`, each legal page has one `h1` with its title; the `data-legal="draft"` and `data-legal="version"` lines are visible; the brand link goes to `/login`.
2. e2e `legal.spec.ts` on `mobile` at 320 px wide: the privacy page has `scrollWidth` ≤ 320.
3. e2e `auth.spec.ts`, the 404 test: status 404, the `h1` is `pl.not_found_title`, the link to `/` is visible with the name `pl.not_found_link`, and the a11y scan passes.
4. e2e `pwa.spec.ts`, the public test: `/offline.html` shows the `h1` `pl.offline_title` and the text `en.offline_text`; the card background is `rgb(255, 255, 255)` in the light scheme; the a11y scan passes.
5. The a11y scans of `legal.spec.ts` pass on both projects.

## Out of scope

The legal texts and the `.legal-*` CSS. The service worker (stage 07).

## Done when

You opened a legal page, the 404 page and the offline page in both schemes, phone and desktop (the contact sheet, or your own screenshots if it has no public routes; name the paths); the Proof of `../plan.md` with the specs `legal.spec.ts auth.spec.ts pwa.spec.ts` prints `PROOF_OK`.
