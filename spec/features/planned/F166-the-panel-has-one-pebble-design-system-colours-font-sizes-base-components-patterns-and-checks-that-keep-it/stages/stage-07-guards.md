# F166 stage 07 — Guards against the old look

Part of [`../plan.md`](../plan.md). Needs: stage 03 (tokens; the three raw-colour files fixed). May run next to 04, 05, 06, 09, 10.

## Step 1 — The colour scan

- **Goal:** a raw colour cannot come back (DB-2).
- **Files:** `apps/web/src/lib/token-classes.test.ts` (model: `apps/server/src/bare-codes.test.ts`, a scan with a pure matcher and a file walk).
- **Decisions:** the scan reads every `.tsx`, `.ts` and `.astro` file under `apps/web/src` except tests. It reports: a Tailwind palette class (`bg|text|border|ring|fill|stroke|from|to|via|outline|divide|decoration` + a palette name + an optional shade and opacity); `text-white`, `bg-white`, `text-black`, `bg-black` without an opacity; a hex colour, `rgb(`, `hsl(` or `oklch(`; an inline `style=` attribute. It also reports `ring-ring/` and `outline-ring/` with an opacity, and an `accent` class outside `patterns/FactBox.tsx` and `shell/AuthErrorBanner.tsx` (D13; take the scan of stage 03 test 3 over and delete it there). Allowed, each as one named entry of a list in the test (D10): `bg-black/50` in `ui/dialog.tsx` and `ui/sheet.tsx` (the scrim), the QR colours of `settings/TotpQr.tsx`, the `style` of `ui/sonner.tsx` if it still exists, the `theme-color` values in the two layouts. `global.css` and `apps/web/src/dev/` are not scanned.
- **Interface:** `colourProblems(file: string, text: string): string[]` (pure; the walk calls it).
- **Test:** (1) `colourProblems("a.tsx", '<p className="bg-amber-50">')` gives one problem that names `bg-amber-50`. (2) `text-muted-foreground`, `bg-primary/90` and `border-destructive` give none. (3) `style={{ width: 3 }}` gives one problem. (4) `#0a7568` in a `.tsx` string gives one problem. (5) The walk over the real tree gives no problem. (6) Each allow-list entry still matches its file (a stale entry fails).

## Step 2 — The unused-key test

- **Goal:** a text that no page shows cannot stay (DB-10).
- **Files:** a test next to `apps/web/src/i18n/i18n.test.ts`.
- **Decisions:** a key is used when its name appears as a whole word in a file under `apps/web/src`, `apps/web/e2e`, `apps/docs/src`, `packages/core/src` or `apps/server/src` (core schemas and the server send some keys as error codes). Not counted: the files that define texts (`apps/web/src/i18n/texts/`, `i18n/en.ts`, `i18n/pl.ts`) and unit test files (`*.test.ts`, `*.test.tsx`); e2e specs count. Keys built at run time (a template such as `` `cat_${category}` ``) are found by their prefix: list each prefix once in the test with the file that builds it. Plural keys (the tables in `en.ts` and `pl.ts`) follow the same rule.
- **Do:** run it; delete each unused key from `en` and `pl` (and from the plural tables) in this stage. If more than 40 keys are unused, delete none: write the list to `unused-keys.md` in the ticket folder and say so (the count would mean the rule is wrong).
- **Test:** (7) a fake key `zz_never_used` added to both languages fails the test with its name; remove it. (8) A key used only through a listed prefix passes; `empty_patch` (used only by `packages/core/src/web/organization.ts`) passes. (9) A prefix entry whose file no longer builds such a key fails.

## Out of scope

An ESLint rule (the scan test is enough and needs no plugin work). Emoji in texts (the page tickets remove them; the cleanup ticket adds that guard). The docs site.

## Done when

Both tests are in `test:unit` and pass; the final message gives the count of deleted keys and the allow list; Proof A of `../plan.md` prints `PROOF_OK`.
