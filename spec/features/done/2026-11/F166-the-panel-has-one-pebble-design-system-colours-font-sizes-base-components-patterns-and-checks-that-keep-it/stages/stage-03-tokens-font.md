# F166 stage 03 — Tokens, font and scales

Part of [`../plan.md`](../plan.md). Needs: stage 02 (`ui:sheet`). May run next to 08. Every value is in `../interfaces.md`: this stage does not need the mockup.

## Step 1 — Tokens

- **Files:** `apps/web/src/styles/global.css`.
- **Decisions:** D1–D4; DB-2, DB-3, DB-6.
- **Do:** set every token of `../interfaces.md` § Tokens in `:root` and in the dark media block: the colour rows, the avatar tokens, the category tokens, the soft tokens (the `color-mix` rule), `--tabbar-height`, `--shadow-card`. Add them to `@theme inline` so the classes exist (`bg-primary-soft`, `text-destructive-foreground`, `bg-destructive-soft`, `shadow-card`, `text-cat-urgent`, `bg-cat-urgent-soft`, `bg-avatar-1`…). Replace the computed radius scale with the four fixed values. Set `--text-xs`. The base rule uses `outline-ring` with no opacity. Delete `--chart-*` and the `--sidebar-*` tokens that no file reads (grep first; keep `--sidebar`). The hand CSS of the legal pages keeps its selectors.

## Step 2 — Font

- **Files:** `apps/web/src/assets/fonts/` (two `woff2` files and `OFL.txt`), `global.css` (`@font-face`, `--font-sans`).
- **Decisions:** D6. Take the variable `wght` files of the `latin` and `latin-ext` subsets of Nunito from the Fontsource package tarball once (no dependency, no CDN link in the code). Write the `unicode-range` of each subset as Fontsource gives it.
- **Check:** the built CSS points at `/_astro/…woff2`; the built pages request no other host; record both file sizes and whether the font has tabular numbers (`../plan.md` § Not verified).

## Step 3 — Classes that the new token meanings break

Class changes only; no prop or name changes (D5).

- **`accent` (D13):** every `bg-accent`, `text-accent-foreground` and their `hover:`, `focus:`, `data-[…]:` forms in `components/ui/` and `components/shell/Nav.tsx` becomes the `muted` and `foreground` form. After this step no file uses an `accent` class.
- **Banners keep their meaning:** `PausedBanner.tsx` (the organization is suspended) uses `bg-destructive-soft` with `text-destructive`; `AuthErrorBanner.tsx` (a mailbox login failed, a warning) uses `bg-accent` with `text-accent-foreground`. These two are the only `accent` uses until stage 10. `TotpQr.tsx` stays (D10).
- **Destructive:** the destructive `Button` and `Badge` use `text-destructive-foreground` in place of `text-white`, with no `dark:` opacity change.
- **Focus:** every `ring-ring/50` becomes `ring-ring`.

## Step 4 — Capability page

- **Files:** `docs/capabilities/web-panel.md`: a short part "Look" under "What it does now": the design system ADR, both schemes by system setting, the self-hosted font. No other part changes.

## Test

1. New unit test `apps/web/src/lib/tokens.test.ts`. It reads `global.css`, resolves the hex tokens of both schemes and computes each soft token by the mix rule in sRGB. It checks: every row of `../interfaces.md` § Tokens has its exact value; contrast ≥ 4.5 for foreground on background, card and muted; muted-foreground on background, card and muted; primary-foreground on primary; primary on card, background and primary-soft; accent-foreground on accent; destructive on card and on destructive-soft; destructive-foreground on destructive; each category colour on its soft token; avatar-foreground on each avatar fill. Contrast ≥ 3 for `--input` and for `--ring` on card and background. Fixed values to assert: light primary on primary-soft 4.65, light ring on background 5.14, dark destructive-foreground on destructive 7.42 (two decimals).
2. Break check: set light `--primary` to `#0a7a6c`; test 1 fails on "primary on primary-soft"; restore.
3. A scan in the same test file: no `ring-ring/`, `outline-ring/` or `accent` class under `apps/web/src` except the two banner files (stage 07 takes this scan over).
4. The e2e suite passes (light scan, as before this stage).
5. `bun run ui:sheet`: open login, activity, settings and approvals in both schemes: teal, Nunito, Polish letters correct in the `pl` shots, the active navigation item not orange.

## Out of scope

The dark scan (stage 11). Sizes and shapes of primitives (stages 04, 05).

## Done when

Proof B of `../plan.md` prints `PROOF_OK` (with `web:build` if stage 08 has not landed), and the final message lists the font sizes and the paths of the pictures you opened.
