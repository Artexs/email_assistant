# F166 plan — the Pebble design system of the panel

> **Status 2026-11-23 — planned.** Plan base: cd7c95a39. Eleven stages in four waves; nothing built. No owner step is open.

Shared decisions (PB-1…13, DB-1…11): [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Names and values for later tickets: [`interfaces.md`](interfaces.md). The drawing: `design/ui-proposals/proposals/03-pebble/index.html` and its `shots/`.

## Input

The owner's words are on the programme page. For this ticket also (2026-11-23): "tell me if there is any possibility to run more work in parallel … so it will speed up whole implementation".

### Decisions of this ticket

- **D1** The look changes through tokens first: after stage 03 every page has the new colours and font with its old layout. This mixed state is correct on `master` (PB-2).
- **D2** Token values are fixed in `interfaces.md`; a worker picks no colour. A test computes the contrast of each pair from the token file.
- **D3** Dark mode stays a `prefers-color-scheme` media block.
- **D4** The Tailwind size names keep their meaning; only `text-xs` (13 px) and the radius scale change in `@theme`. Page tickets raise main text to `text-base`; `text-sm` (396 uses) stays 14 px.
- **D5** Primitives keep every existing prop, variant and size name, with new values, so no feature file must change in this ticket. D5 is about names, not classes: a stage may change a class in any file to reach a token or to fix a scan violation.
- **D6** The font is two `woff2` files (Latin, Latin Extended; the weight axis only) in `apps/web/src/assets/fonts/` with `OFL.txt`, loaded by `@font-face` in `global.css` with `font-display: swap` and a `unicode-range` per file. Vite hashes them into `/_astro/`. Rejected: a font package (a `bun.lock` change), the system rounded font (Apple systems only).
- **D7** The contact sheet is a Playwright run of its own (`bun run ui:sheet`), not part of `test:e2e` or CI. It records; it does not judge. It writes outside the worktree, so a test run does not clear it and a review job can open it.
- **D8** The pattern page lives in `apps/web/src/dev/`; an Astro integration adds its route only when `EA_DEV_PAGES=1`, which only `bun run web:build:dev` sets. The e2e runs and the CI `e2e` job use that build; the image build does not. The page needs a session like every panel page: the server's public paths do not change. Its demo texts are literals, outside the i18n rules. Rejected: a page in `src/pages` (it would ship); a public `/dev/` path (a new open surface).
- **D9** `expectNoA11yViolations` scans one scheme, emulates the next, scans again and restores. The dark scan covers the pattern page from stage 08 and every page from stage 11, on the `desktop` project only: colour pairs are the same on a phone, and the CI `e2e` job has a 20-minute limit.
- **D10** The only allowed raw colours: the QR code in `TotpQr.tsx`, the scrim of dialogs and sheets, `theme-color`. The guard test lists each by file.
- **D11** A gap or a needed deviation is a question in the final message, not a choice.
- **D12** Width. The patterns, the pattern page and the page head contract do not wait for the restyled primitives (D5): after stage 03, six stages run next to each other. The page head contract is built here (stage 09), so the shell ticket and the page tickets start together. Parallel stages share no file.
- **D13** After stage 03 no neutral hover or active fill uses `accent`; they use `muted`. `accent` is the warm box and the warning banner only.

## Facts checked (2026-11-23)

- Tailwind 4.3.5 theme variables `--text-xs`, `--radius-sm…xl`, `--font-sans` (`node_modules/tailwindcss/theme.css`).
- Nunito: OFL-1.1, variable, subsets `latin` and `latin-ext` (Fontsource API).
- The CSP has `font-src 'self'`; the service worker caches `/_astro/*`.
- The server sends every path outside `PUBLIC_PAGE_PATHS` (`apps/server/src/platform/http.ts`) to `/login`. CI and the image both run `bun run web:build`.
- `accent` classes: 26 uses in 7 files. `ring-ring/50`: 17 uses.
- e2e: projects `mobile` and `desktop`; 102 a11y scan calls; the CI `e2e` job takes 935 s.
- The only `h1` elements of signed-in pages are in `AppShell.tsx`; all 12 islands pass `active` and `title`.
- Contrast of the `interfaces.md` values: light primary on soft 4.65; every light pill ≥ 4.61; `--input` ≥ 3.02; ring on background 5.14 and 9.73; avatar text ≥ 5.5; dark destructive foreground 7.42.

## Not verified

- `injectRoute` in an Astro 7 integration for a page outside `src/pages`: stage 08 checks it first. Fallback: the page sits in `src/pages/dev/` and the build deletes `dist/dev` unless `EA_DEV_PAGES=1`.
- Stage 03 records the size of the two font files (over 150 KB together is a question) and whether Nunito has tabular numbers.
- Stage 11 records the e2e time with the dark scan; over 17 minutes for the CI `e2e` job is a question.

## Done when

The acceptance list of [`ticket.md`](ticket.md) holds.

## Rules for every stage

- Read the programme page, this file, `interfaces.md` and your stage file. Stages 04, 05, 06 and 10: open the mockup HTML and the shots of the parts you build.
- Token classes only; no palette class, hex value or inline `style` (DB-2). No feature flag (PB-1).
- Keep every prop, variant name, `data-*` attribute and text key that exists (D5).
- Edit no file that another stage of your wave owns (D12). Format only the files of your stage. No `bun.lock` change.
- UI stages (03–06, 09–11): run `UI_SHEET_ROUTES=<your routes> bun run ui:sheet`, open the phone and desktop PNG in both schemes, and give their full paths in the final message.

## Proof

- **Proof A** (stages 01, 02, 07): `mkdir -p /tmp/f166-NN && bun run check:job > /tmp/f166-NN/check.log 2>&1 && echo PROOF_OK`
- **Proof B** (stages 03, 04, 05, 09, 11: they change every page): `mkdir -p /tmp/f166-NN && bun run check:job > /tmp/f166-NN/check.log 2>&1 && bun run web:build:dev > /tmp/f166-NN/build.log 2>&1 && bun run test:e2e > /tmp/f166-NN/e2e.log 2>&1 && echo PROOF_OK`
- **Proof C** (stages 06, 08, 10: new files only): the same with `bunx playwright test -c apps/web/e2e/playwright.config.ts patterns.spec.ts` in place of `bun run test:e2e`.

## User checkpoints and steps

- **O1, done 2026-11-23:** the owner said yes; the Pebble mockup is in the public repo (`design/ui-proposals/`: `proposals/03-pebble/`, `proposals/_shared/`, `tools/`, `analysis.md`); the rest of the design study is in `.gitignore`.
- **Look 1 (owner, when this ticket lands):** the pattern page and the contact sheet (PB-12). Not a stop.
- **Outside path:** `~/.local/share/email-assistant/ui-sheet/`. The coordinator deletes a job's folder after its land; the cleanup ticket (F172) deletes the rest.

## Review

A Sonnet review before the land of stages 03, 04, 05, 06, 09, 10 and 11. The review task adds: "Open the pictures the worker named and the mockup shots; report each difference from the mockup's pattern." Stages 01, 02, 07 and 08 land on the proof.

## Stages

| Wave | # | Stage | Needs |
| --- | --- | --- | --- |
| 1 | 01 | [Records: ADR and rules](stages/stage-01-records.md) | — |
| 1 | 02 | [Contact sheet and scan schemes](stages/stage-02-contact-sheet.md) | — |
| 2 | 03 | [Tokens, font, scales](stages/stage-03-tokens-font.md) | 02 |
| 2 | 08 | [Pattern page](stages/stage-08-pattern-page.md) | 02 |
| 3 | 04 | [Primitives A](stages/stage-04-primitives-a.md) | 03, 08 |
| 3 | 05 | [Primitives B](stages/stage-05-primitives-b.md) | 03, 08 |
| 3 | 06 | [Patterns A and the category look](stages/stage-06-patterns.md) | 03, 08 |
| 3 | 10 | [Patterns B](stages/stage-10-patterns-b.md) | 03, 08 |
| 3 | 09 | [Page head contract](stages/stage-09-page-head.md) | 03 |
| 3 | 07 | [Guards](stages/stage-07-guards.md) | 03 |
| 4 | 11 | [Dark scan for every page](stages/stage-11-dark-scan.md) | 04, 05 |

All stages of one wave run next to each other. Other tickets wait for stages 03, 06, 09 and 10 only, not for the whole ticket.

## How to run (coordinator)

Move the folder to `active/` and commit before the first spawn. One job per stage, with the board's worker flags, the personal route and `--prepare 'bash scripts/limen-prepare.sh'`:

```
limen spawn <flags> --label "<what the stage changes> · F166" \
  'Implement F166 stage NN. Read docs/product/pebble-ui/README.md and, in spec/features/active/F166-<slug>/, ticket.md, plan.md, interfaces.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: <its Proof command>. In the final message, list as proven only what a saved log shows.'
```

Start every stage of a wave at once. Land each with `limen land <job> --yes --keep-open`; the last one without. Drop the job DB after the land.

## Planning progress

Stages 01–11 [written].

## Cold review

One round, Opus (six tickets build on this plan), 2026-11-23: [`plan-review-1.md`](plan-review-1.md). It read the seven-stage form. 3 blocking, 11 gaps, 8 notes; all 22 fixed: [`plan-review-1-fixes.md`](plan-review-1-fixes.md).

## Log

- 2026-11-23: plan written with the owner; reshaped for width (D12); cold review fixed.
