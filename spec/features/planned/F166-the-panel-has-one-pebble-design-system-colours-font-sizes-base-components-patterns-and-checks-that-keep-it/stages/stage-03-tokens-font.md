# F166 stage 03 — Tokens, font and scales

Part of [`../plan.md`](../plan.md). Needs: owner step O1 (the mockup in the repo); stage 02 (`ui:sheet`, `A11Y_SCHEMES`).

## Step 1 — Tokens

- **Goal:** `global.css` holds the Pebble tokens for both schemes.
- **Files:** `apps/web/src/styles/global.css`.
- **Decisions:** D1, D2, D3, D4; DB-2, DB-3, DB-6.
- **Do:** set every token of `../interfaces.md` § Tokens in `:root` and in the dark media block; add the new tokens to `@theme inline` so the classes exist (`bg-primary-soft`, `text-destructive-foreground`, `shadow-card`, `text-cat-urgent`…); set the radius scale and `--text-xs`; set the focus ring. Delete `--chart-*` and the `--sidebar-*` tokens that no file reads (grep first; keep `--sidebar`). The hand CSS of the legal pages keeps its selectors and uses the new tokens.
- **Out of scope:** any class change in `components/ui/` (stages 04, 05) except what step 3 names.

## Step 2 — Font

- **Files:** `apps/web/src/assets/fonts/` (two `woff2` files and `OFL.txt`), `global.css` (`@font-face`, `--font-sans`).
- **Decisions:** D6. Take the variable `wght` files of the `latin` and `latin-ext` subsets of Nunito from the Fontsource package tarball once (no dependency, no CDN link in the code). Write the `unicode-range` of each subset as Fontsource gives it.
- **Check:** the built CSS points at `/_astro/…woff2`; the built pages request no other host; record both file sizes (over 150 KB together: ask). Check whether the font has tabular numbers (`plan.md` § Not verified) and say so.

## Step 3 — The three files with raw colours

- **Files:** `components/shell/PausedBanner.tsx`, `components/shell/AuthErrorBanner.tsx`.
- **Do:** the paused banner uses the accent tokens; the login-error banner uses the destructive soft look (text `--destructive` on its 14 % mix). `TotpQr.tsx` stays (D10). The destructive `Button` and `Badge` use `text-destructive-foreground` in place of `text-white`, with no `dark:` opacity change.

## Step 4 — Scan both schemes

- **Files:** `apps/web/e2e/a11y.ts`: `A11Y_SCHEMES = ["light", "dark"]`.
- **Do:** run the e2e suite. A contrast violation that the tokens cause is fixed by a token class on the element, never by a new colour. A violation you cannot fix with the listed tokens is a question.

## Test

1. New unit test `apps/web/src/lib/tokens.test.ts`: it reads `global.css`, takes the hex tokens of both schemes and checks: every row of `../interfaces.md` § Tokens has its exact value; contrast ≥ 4.5 for foreground on background, card and muted; muted-foreground on background, card and muted; primary-foreground on primary; primary on card, background and primary-soft; accent-foreground on accent; destructive on card; destructive-foreground on destructive; each category colour on its 14 % mix with card and with background. Contrast ≥ 3 for `--input` on card and background. Fixed values to assert: light primary on primary-soft 4.65 (two decimals), dark destructive-foreground on destructive 7.42.
2. Break check: set light `--primary` to `#0a7a6c`; test 1 fails on "primary on primary-soft"; restore.
3. The e2e suite passes with both schemes. Record its run time.
4. `bun run ui:sheet`: open the sheet of four routes (login, activity, settings, approvals) in both schemes; the pages are teal, in Nunito, with Polish letters correct in the `pl` shots.

## Done when

The Proof of `../plan.md` (stages 03–06) prints `PROOF_OK`, and the final message lists the font sizes, the e2e time and the pictures you opened.
