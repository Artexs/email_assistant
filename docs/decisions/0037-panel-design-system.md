# 0037 — The panel has one design system: Pebble tokens, primitives and patterns

- Status: accepted (`spec/features/active/F166-the-panel-has-one-pebble-design-system-colours-font-sizes-base-components-patterns-and-checks-that-keep-it/`, 2026-11-23)
- Date: 2026-11-23

## Context

The web panel (`apps/web`) has the stock shadcn look: grey neutrals, small radius, 14 px text, 36 px controls and no brand colour. Each page picked its own colours and spacing. Palette classes (`bg-amber-50`) and hex values sit in component files, and the category colours exist in several copies.

On 2026-11-23 the owner chose the Pebble drawing (`design/ui-proposals/proposals/03-pebble/`; it is in Git history at `94092626b`): one teal brand colour, a large radius, soft shadows, a rounded font, 16 px text and 48 px controls. The drawing shows about 40 % of what a user sees. Every other page, state and dialog follows its patterns. The owner also said that the old look is replaced and not kept beside the new one, and that no feature flag is needed. The programme page is `docs/product/pebble-ui/README.md`.

The drawing was the source of the values. It left the repository with the last ticket of the programme (2026-11-25). Now this record, the pattern page and the code are the reference for values and names.

## Decision

1. **Tokens only.** All colour, radius, shadow and font values live in `apps/web/src/styles/global.css` as tokens. A component uses token classes (`bg-primary`, `text-muted-foreground`). It uses no palette class, no hex value and no inline `style`. A scan test over the component files enforces it. The same test rejects a stock shadow (`shadow-md`) and an arbitrary shadow (`shadow-[…]`): a shadow is `shadow-card`, `shadow-button`, `shadow-bar` or `shadow-none`. A menu, select or dialog takes `shadow-card`; the design system has no overlay shadow.
2. **Token values.** The values below are the mockup's values, changed where WCAG 2.2 AA failed (contrast computed with the sRGB formula on 2026-11-23). A test computes the contrast of each text pair from the token file.

   | Token                       | Light                                                                      | Dark                                                  | Note                                                                                             |
   | --------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
   | `--background`              | `#f3f6f5`                                                                  | `#0d1513`                                             |                                                                                                  |
   | `--foreground`              | `#13201d`                                                                  | `#e4efec`                                             |                                                                                                  |
   | `--card`, `--popover`       | `#ffffff`                                                                  | `#16211e`                                             | `*-foreground` = `--foreground`                                                                  |
   | `--muted`, `--secondary`    | `#e8efed`                                                                  | `#1d2b27`                                             | `--secondary-foreground` = `--foreground`; every neutral hover, focus and active fill            |
   | `--muted-foreground`        | `#586b66`                                                                  | `#95aba5`                                             |                                                                                                  |
   | `--border`                  | `#dbe5e2`                                                                  | `#24332f`                                             | dividers and card edges only                                                                     |
   | `--input`                   | `#6e968a`                                                                  | `#4f7067`                                             | new value: the edge of a field, a switch track and an outline button; 3:1 on card and background |
   | `--primary`                 | `#0a7568`                                                                  | `#3fd1b9`                                             | mockup light `#0a7a6c` gave 4.36:1 on the soft tint                                              |
   | `--primary-foreground`      | `#ffffff`                                                                  | `#04201b`                                             |                                                                                                  |
   | `--primary-soft`            | `#d5f0ea`                                                                  | `#133b34`                                             | new; text on it is `--primary`                                                                   |
   | `--accent`                  | `#fff1e0`                                                                  | `#3a2a14`                                             | the warm box and the warning banner only; never a hover fill                                     |
   | `--accent-foreground`       | `#8a4b00`                                                                  | `#ffc983`                                             |                                                                                                  |
   | `--destructive`             | `#af3434`                                                                  | `#ff7c7c`                                             | mockup light `#c23a3a` gave 4.30:1 on its soft tint                                              |
   | `--destructive-foreground`  | `#ffffff`                                                                  | `#2b0707`                                             | new; white on the dark value gave 2.49:1                                                         |
   | `--destructive-soft`        | mix                                                                        | mix                                                   | new; see the soft rule below; text on it is `--destructive`                                      |
   | `--primary-soft-hover`      | mix                                                                        | mix                                                   | new; soft button and badge hover: `--primary-soft` 70 % over `--card`, opaque                    |
   | `--destructive-soft-hover`  | mix                                                                        | mix                                                   | new; its hover: `--destructive-soft` 70 % over `--card`, opaque                                  |
   | `--destructive-edge`        | mix                                                                        | mix                                                   | new; the 2 px edge of the danger card: `--destructive` 65 % over `--card`, 3:1 on the card       |
   | `--ring`                    | `--primary`                                                                | `--primary`                                           | solid: 60 % gave 2.50:1 on the background (the bar for a focus mark is 3:1)                      |
   | `--sidebar`                 | `#ffffff`                                                                  | `#121c19`                                             | the other `--sidebar-*` and the `--chart-*` tokens go if nothing reads them                      |
   | `--shadow-card`             | `0 1px 2px rgb(16 40 34 / .05), 0 12px 32px -8px rgb(16 40 34 / .12)`      | `0 1px 2px #0006, 0 12px 32px -8px #0008`             |                                                                                                  |
   | `--shadow-button`           | `0 6px 16px -6px color-mix(in oklab, var(--primary) 70%, transparent)`     | same                                                  | new; the primary button; it follows `--primary` of the scheme                                    |
   | `--shadow-bar`              | `0 -8px 24px -10px color-mix(in srgb, var(--foreground) 20%, transparent)` | same                                                  | new; the phone decision bar (`StickyActions`); it follows `--foreground` of the scheme           |
   | `--avatar-1` … `--avatar-5` | `#0a7568`, `#7741c8`, `#235ebf`, `#a8500f`, `#b3366b`                      | `#3fd1b9`, `#c3a0ff`, `#7fb0ff`, `#e0ad6b`, `#ff9cc2` | new; a solid fill                                                                                |
   | `--avatar-foreground`       | `#ffffff`                                                                  | `#0d1513`                                             | new; ≥ 5.5:1 on each avatar fill                                                                 |
   | `--tabbar-height`           | `4rem`                                                                     | same                                                  | new; the height of the phone tab bar without the safe-area inset                                 |

   Radius is fixed, not computed from `--radius`: `sm` 10 px, `md` 16 px, `lg` 22 px (`--radius`), `xl` 28 px, and full for pills and buttons.

   Category tokens: one per value of the category enum of `@ea/core` (`packages/core/src/triage/categories.ts`, 7 values). The name is `--cat-<value>`, with `_` written as `-`.

   | Category     | Light     | Dark      |
   | ------------ | --------- | --------- |
   | urgent       | `#af3434` | `#ff7c7c` |
   | needs reply  | `#235ebf` | `#7fb0ff` |
   | delegation   | `#7741c8` | `#c3a0ff` |
   | info         | `#4b5d73` | `#a8b6c7` |
   | notification | `#096e61` | `#3fd1b9` |
   | spam         | `#87581b` | `#e0ad6b` |
   | unsure       | `#8f5400` | `#ffc46b` |

   **The soft rule.** Each category colour and `--destructive` has a soft token (`--cat-<value>-soft`, `--destructive-soft`) with the value `color-mix(in srgb, <the colour> 14%, var(--card))`. It is opaque and always mixed with `--card`, whatever is under the pill. A pill is the colour as text on its soft token. An enum value with no row above gets the `info` colours.

   **Focus.** A 3 px ring in `--ring` with a 2 px gap in the colour of the surface. Classes use `ring-ring` and `outline-ring` with no opacity.

3. **Type and size scales.** Text: `text-xs` 13 px, `text-sm` 14 px, `text-base` 16 px, `text-lg` 18 px, `text-xl` 20 px, `text-3xl` 30 px (the page title; `text-2xl` on a phone). The Tailwind size names keep their meaning; only `text-xs` and the radius scale change in `@theme`. A control is 48 px high; 44 px is compact; 36 px is only for dense tables. There is one breakpoint pair: the phone layout is below `lg` (1024 px), the desktop layout from `lg`. A page with two columns uses one column below `lg`. The font family token `--font-sans` is `"Nunito Variable", ui-rounded, ui-sans-serif, system-ui, sans-serif` plus the emoji fonts of the stock stack.
4. **Layout rules.** No sideways scroll at 320 px. The bottom tab bar respects the safe-area inset and has the height `--tabbar-height`. A card has a border in forced-colors mode. Motion stops under `prefers-reduced-motion`.
5. **Dark mode follows the system.** Dark values sit in a `prefers-color-scheme: dark` block of `global.css`. There is no manual switch and no stored choice. The root sets `color-scheme: light dark`, so browser controls (checkbox, date field, select list, scroll bar) follow the scheme too. Neutral hover, focus and active fills use `muted`. `accent` is for the warm box and the warning banner only. Three files read the accent tokens: `components/patterns/FactBox.tsx` (the warm box), `components/patterns/EmptyState.tsx` (the warm dot of the picture) and `components/shell/AuthErrorBanner.tsx` (the warning banner). A scan test lists them.
6. **Font.** Nunito, licence SIL OFL 1.1, self-hosted. Two `woff2` files (Latin and Latin Extended, the weight axis only) sit in `apps/web/src/assets/fonts/` with `OFL.txt`. `global.css` loads them with `@font-face`, `font-display: swap` and a `unicode-range` for each file. The build hashes them into `/_astro/`. The CSP keeps `font-src 'self'`, so no request leaves for another host.
7. **Allowed raw colours.** Three places only, each named by its file in the guard test: the QR code in `components/settings/TotpQr.tsx` (white ground, black modules), the scrim of dialogs and sheets in `components/ui/dialog.tsx` and `components/ui/sheet.tsx`, and the `theme-color` meta tag in `layouts/App.astro` and `layouts/Public.astro`. The test fails when a listed file is not named in this record.
8. **Primitives.** `components/ui/` holds shadcn CLI output. A new primitive still comes from the CLI. Editing the variants, sizes and classes of an existing file is allowed and is how the theme reaches the primitives. A variant or size with no user outside the pattern page is removed; the pattern page shows each one that is left. A primitive that only the pattern page imports (`components/ui/tabs.tsx`) stays, without its unused keys. Pattern components are app code in `components/patterns/`, one file per pattern with no index file. A page uses a pattern before it builds its own markup. The patterns are `PageHead`, `SectionCard`, `RowList` and `Row`, `CategoryPill`, `InitialsAvatar`, `ProgressRing` and `StepDots`, `FilterChips`, `EmptyState`, `StatTile`, `FactBox` and `StickyActions`; their props are in the code and on the pattern page.
9. **Category look.** A category has one look (an icon and a colour token) in one typed record, `categoryLook` in `apps/web/src/lib/category-look.ts`, with a test against the category enum. A delegation status maps to its column the same way. Emoji leave the panel texts.
10. **Page head.** The shell renders the page head (title, one lead line, one action) from the props `lead` and `action` that the island passes. An island renders no `h1` of its own. Three files render an `h1`: `components/patterns/PageHead.tsx` (every shell page), `components/auth/AuthCard.tsx` (the sign-in and other pages with no shell) and `components/shell/AppShell.tsx` (the card for a user with no organization). A test lists them.
11. **Texts.** Every string is a key in `en` and `pl`. A key that no source file reads is deleted in the same change, and a test fails on an unused key.
12. **Two builds.** `bun run web:build` is the production build (the image and CI use it). `bun run web:build:dev` sets `EA_DEV_PAGES=1` and adds the pattern page; the e2e runs, the contact sheet and the CI `e2e` job use it. The image build holds no dev page.
13. **The pattern page.** It lives in `apps/web/src/dev/` and shows every primitive variant and every pattern at `/dev/patterns`. An Astro integration adds its route only when `EA_DEV_PAGES=1`. The page needs a session like every panel page; the public paths of the server do not change. Its demo texts are literals and sit outside the text rules of decision 11 (the lint rule on literal text and the unused-key test do not cover `apps/web/src/dev/`).
14. **Accessibility bar.** Text has a contrast of at least 4.5:1 and a control edge at least 3:1, in both schemes. The e2e accessibility scan runs in the light scheme on both projects (`mobile`, `desktop`) and in the dark scheme on the `desktop` project (the CI `e2e` job has a 20-minute limit). The contact sheet (`bun run ui:sheet`) records every route in each size, scheme, language and organization state; it does not judge.
15. **Invariants of the redesign.** No database migration, no API or schema change in `packages/core/src/web`, no URL, query or anchor change, no feature flag, no new dependency. The cleanup removed one unused dependency (`next-themes`, which no source file read).
16. **No file without a user.** A source file of `components/`, `islands/`, `lib/` and `layouts/` that no other file of `apps/web` imports fails `apps/web/src/lib/unused-files.test.ts`. A test file is no importer; a page, a script, an e2e helper and a file of `dev/` are, so a file that only the pattern page imports counts as used. A file that must stay with no importer is named in this record with its reason; none is named today.
17. **No token without a reader.** A token of `apps/web/src/styles/global.css` that no rule and no source file reads fails `apps/web/src/lib/unused-tokens.test.ts`. A token is read by `var(--name)`, or by the class that its theme name makes (`--color-primary` gives `bg-primary`, `--radius-lg` gives `rounded-lg`). A token that only an unused token reads is unused. Tailwind's base styles read `--font-sans` and `--font-mono` with no class, so they stay. A token that goes from `global.css` goes from the token table above in the same change.

### Rejected options

- **A new component library.** The panel keeps shadcn and Tailwind. A library would replace every primitive and would bring a new dependency.
- **A manual theme switch.** The system setting decides. A switch needs a stored choice, a flash guard and a second a11y path.
- **A redesign flag.** The owner wants the old look replaced and not kept. A flag keeps two looks alive and doubles the e2e matrix.
- **A font package.** It changes `bun.lock`. The font files sit in the repository instead.
- **The system rounded font.** It exists on Apple systems only.
- **The pattern page in `src/pages`.** It would ship in production. A public `/dev/` path would be a new open surface.

## Consequences

- After the token change every page has the new colours and font with its old layout. This mixed state is correct on `master` until the page tickets finish; production changes once, in the last ticket of the programme.
- A page change that needs a new colour, size or radius changes this record and `global.css` first. A page never adds a value of its own.
- A palette class, a hex colour, an inline `style` or an unused text key fails `bun run test:unit`.
- `components/ui/` is no longer pure CLI output: its variants carry the theme. A CLI update of a primitive needs a merge by hand.
- The contact sheet and the pattern page are the owner's look at the whole panel in one place.
