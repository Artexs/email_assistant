# F166 plan — the Pebble design system of the panel

> **Status 2026-11-23 — planned.** Plan base: cd7c95a39. Ten stages in three waves; nothing built. Owner step O1 is open.

Shared decisions (PB-1…13, DB-1…11): [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Names and values for later tickets: [`interfaces.md`](interfaces.md). The drawing: `design/ui-proposals/proposals/03-pebble/index.html` and its `shots/` (in the repo after O1).

## Input

The owner's words are on the programme page. For this ticket also (2026-11-23): "tell me if there is any possibility to run more work in parallel … so it will speed up whole implementation".

### Decisions of this ticket

- **D1** The look changes through tokens first: after stage 03 every page has the new colours and font with its old layout. This mixed state is correct on `master` (PB-2).
- **D2** Token values are fixed in `interfaces.md`; a worker picks no colour. A test computes the contrast of each text pair from the token file.
- **D3** Dark mode stays a `prefers-color-scheme` media block.
- **D4** The Tailwind size names keep their meaning; only `text-xs` (13 px) and the radius scale change in `@theme`. Rejected: a global remap of `text-sm` to 16 px (396 uses; secondary text stays 14 px). Page tickets raise main text to `text-base`.
- **D5** Primitives keep every existing variant and size name, with new values. So no feature file changes in this ticket.
- **D6** The font is two `woff2` files (Latin, Latin Extended; the weight axis only) in `apps/web/src/assets/fonts/` with `OFL.txt`, loaded by `@font-face` in `global.css` with `font-display: swap` and a `unicode-range` per file. Vite hashes them into `/_astro/`, which the service worker caches. Rejected: a font package (a `bun.lock` change, DB-1), the system rounded font (Apple systems only).
- **D7** The contact sheet is a Playwright run of its own (`bun run ui:sheet`), not part of `test:e2e` or CI. It records; it does not judge. A unit test checks that every page file has a row.
- **D8** The pattern page lives in `apps/web/src/dev/` and an Astro integration adds its route only when `EA_DEV_PAGES=1`. It finds its sections by itself (one file per section), so stages that run next to each other share no file. Its demo texts are literals, outside the i18n rules; the ADR says so. Rejected: a page in `src/pages` (it would ship).
- **D9** `expectNoA11yViolations` scans, switches the emulated scheme, scans again and restores. All 131 call sites get it; it is off until stage 03.
- **D10** The only allowed raw colours: the QR code in `TotpQr.tsx` (black on white in both schemes).
- **D11** A gap or a needed deviation is a question in the final message, not a choice.
- **D12** Width. Primitive names do not change (D5), so the patterns, the pattern page and the page head contract do not wait for the restyled primitives: after stage 03, six stages run next to each other. The page head contract is built here (stage 09), not in the shell ticket, so the shell ticket and the three page tickets start together. Parallel stages share no file: no index file in `components/patterns/`, one section file per item, one generic e2e spec.

## Facts checked (2026-11-23)

- Tailwind 4.3.5 theme variables `--text-xs`, `--radius-sm…xl`, `--font-sans` (`node_modules/tailwindcss/theme.css`).
- Nunito: OFL-1.1, variable, subsets `latin` and `latin-ext` (Fontsource API, `api.fontsource.org/v1/fonts/nunito`).
- The CSP has `font-src 'self'` (`apps/web/astro.config.mjs`); the service worker caches `/_astro/*`.
- Raw palette classes are in three feature files only: `PausedBanner.tsx`, `AuthErrorBanner.tsx`, `TotpQr.tsx`.
- e2e: projects `mobile` (Pixel 7) and `desktop` (1280 × 800); 131 a11y scan calls; the suite takes about 19 min in CI.
- The only `h1` elements of signed-in pages are in `AppShell.tsx`; all 12 islands pass `active` and `title` to it.
- Contrast of the values in `interfaces.md`: light primary on soft 4.65, white on primary 5.59; every light pill ≥ 4.61; `--input` ≥ 3.02 in both schemes; dark destructive foreground 7.42.

## Not verified

- `injectRoute` in an Astro 7 integration for a page outside `src/pages`: stage 08 checks it first. Fallback: the page sits in `src/pages/dev/` and the build deletes `dist/dev` unless `EA_DEV_PAGES=1`.
- Stage 03 records: the size of the two font files (over 150 KB together is a question), whether Nunito has tabular numbers, and the e2e time with two scans per call.

## Done when

The acceptance list of [`ticket.md`](ticket.md) holds, and `bun run ui:sheet` shows every page in the Pebble colours and font in both schemes.

## Rules for every stage

- Read the programme page, this file, `interfaces.md` and your stage file. Stages 04, 05, 06 and 10: open the mockup HTML and the shots of the parts you build (in the repo after O1).
- Token classes only; no palette class, hex value or inline `style` (DB-2). No feature flag (PB-1).
- Keep every prop, variant name, `data-*` attribute and text key that exists (D5).
- Format only the files of your stage. No `bun.lock` change.
- UI stages (03–06, 09, 10): run `UI_SHEET_ROUTES=<your routes> bun run ui:sheet`, open the phone and desktop PNG in both schemes, and name the files you looked at in the final message.
- Edit no file that another stage of your wave owns (D12).

## Proof

- **Proof A** (stages 01, 02, 07): `mkdir -p /tmp/f166-NN && bun run check:job > /tmp/f166-NN/check.log 2>&1 && echo PROOF_OK`
- **Proof B** (stages 03, 04, 05, 09: they change every page): `mkdir -p /tmp/f166-NN && bun run check:job > /tmp/f166-NN/check.log 2>&1 && bun run web:build > /tmp/f166-NN/build.log 2>&1 && bun run test:e2e > /tmp/f166-NN/e2e.log 2>&1 && echo PROOF_OK`
- **Proof C** (stages 06, 08, 10: new files only): `mkdir -p /tmp/f166-NN && bun run check:job > /tmp/f166-NN/check.log 2>&1 && bun run web:build > /tmp/f166-NN/build.log 2>&1 && bunx playwright test -c apps/web/e2e/playwright.config.ts patterns.spec.ts > /tmp/f166-NN/e2e.log 2>&1 && echo PROOF_OK`

Only the stages that change every page run the full e2e suite (about 2.1 GB of memory per run).

## User checkpoints and steps

- **O1 (owner, before stages 04, 05, 06 and 10):** yes to the commit of the mockup into the public repo. The coordinator then commits, under `design/ui-proposals/`, `proposals/03-pebble/`, `proposals/_shared/`, `tools/` and `analysis.md` without its "How to view" section (it names a private network address), and adds the rest of `design/` to `.gitignore`.
- **Look 1 (owner, when this ticket lands):** the pattern page and the contact sheet (PB-12). Not a stop. A correction of a pattern here reaches every page.

## Review

A Sonnet review before the land of stages 03, 04, 05, 06, 09 and 10. The review task adds: "Open the pictures the worker named and the mockup shots; report each visible difference from the mockup's pattern." Stages 01, 02, 07 and 08 land on the proof.

## Stages

| Wave | # | Stage | Needs |
| --- | --- | --- | --- |
| 1 | 01 | [Records: ADR and rules](stages/stage-01-records.md) | — |
| 1 | 02 | [Contact sheet and two-scheme scan](stages/stage-02-contact-sheet.md) | — |
| 2 | 03 | [Tokens, font, scales](stages/stage-03-tokens-font.md) | stage 02 (`ui:sheet`, the scan switch) |
| 2 | 08 | [Pattern page](stages/stage-08-pattern-page.md) | stage 02 (the route table) |
| 3 | 04 | [Primitives A](stages/stage-04-primitives-a.md) | 03, 08; O1 |
| 3 | 05 | [Primitives B](stages/stage-05-primitives-b.md) | 03, 08; O1 |
| 3 | 06 | [Patterns A and the category look](stages/stage-06-patterns.md) | 03, 08; O1 |
| 3 | 10 | [Patterns B](stages/stage-10-patterns-b.md) | 03, 08; O1 |
| 3 | 09 | [Page head contract](stages/stage-09-page-head.md) | 03 |
| 3 | 07 | [Guards](stages/stage-07-guards.md) | 03 |

All stages of one wave run next to each other. Other tickets wait for stages 03, 06, 09 and 10 only (tokens, patterns, the contract), not for the whole ticket.

## How to run (coordinator)

Move the folder to `active/` and commit before the first spawn. One job per stage, with the board's worker flags, the personal route and `--prepare 'bash scripts/limen-prepare.sh'`:

```
limen spawn <flags> --label "<what the stage changes> · F166" \
  'Implement F166 stage NN. Read docs/product/pebble-ui/README.md and, in spec/features/active/F166-<slug>/, ticket.md, plan.md, interfaces.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: <its Proof command>. In the final message, list as proven only what a saved log shows.'
```

Start every stage of a wave at once. Land each with `limen land <job> --yes --keep-open`; the last one without `--keep-open`. Drop the job DB after the land. The planner jobs of F167–F170 start when this plan's review fixes are committed; their first stages start when stages 03, 06, 09 and 10 have landed.

## Planning progress

Stages 01–10 [written].

## Cold review

Running. It read the seven-stage form; stages 08–10 and the waves came later.

## Log

- 2026-11-23: plan written in the planning session with the owner.
- 2026-11-23: reshaped for width (D12): pattern page out of stage 04 into 08, patterns split into 06 and 10, page head contract added as 09, O1 moved from stage 03 to the stages that read the mockup.
