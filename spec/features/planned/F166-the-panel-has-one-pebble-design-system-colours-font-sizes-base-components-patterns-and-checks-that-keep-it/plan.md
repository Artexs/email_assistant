# F166 plan — the Pebble design system of the panel

> **Status 2026-11-23 — planned.** Plan base: cd7c95a39. Seven stages; nothing built. Owner step O1 is open.

Shared decisions (PB-1…13, DB-1…11): [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Names and values for later tickets: [`interfaces.md`](interfaces.md). The drawing: `design/ui-proposals/proposals/03-pebble/index.html` and its `shots/` (in the repo after O1).

## Input

Owner (2026-11-23): "ok pebble is right. lets use it." "my goal is to don't leave their leftovers" "we don't need to use feature flags" "the staging is all about the [dev] environment on this machine." "For the rest of design just follow the pattern from this template and apply it on … all pages."

### Decisions of this ticket

- **D1** The whole look changes through tokens first. After stage 03 every page shows the new colours and font with its old layout. This mixed state is correct on `master` (PB-2). Rejected: a second token set beside the old one (a flag in disguise).
- **D2** Token values are fixed in `interfaces.md`. A worker does not pick a colour. A test computes the contrast of each text pair from the token file, so a later edit cannot drop below AA.
- **D3** Dark mode stays a `prefers-color-scheme` media block. Rejected: a class-based switch (PB-10).
- **D4** The Tailwind size names keep their meaning; only `text-xs` (13 px) and the radius scale change in `@theme`. Rejected: a global remap of `text-sm` to 16 px (396 uses; secondary text must stay 14 px). Page tickets raise main text to `text-base` page by page.
- **D5** Primitives keep every existing variant and size name, with new values. So no feature file changes in this ticket, and the three page tickets can run next to each other later.
- **D6** The font is two `woff2` files (Latin, Latin Extended; the weight axis only) in `apps/web/src/assets/fonts/` with `OFL.txt`, loaded by `@font-face` in `global.css` with `font-display: swap` and a `unicode-range` per file. Vite hashes them into `/_astro/`, which the service worker caches. No new dependency (DB-1). Rejected: `@fontsource-variable/nunito` (a `bun.lock` change), the system rounded font (exists on Apple systems only).
- **D7** The contact sheet is a Playwright run of its own (`bun run ui:sheet`), not part of `test:e2e` or CI. It records; it does not judge. A unit test makes sure that every page file has a row in its route table.
- **D8** The pattern page lives in `apps/web/src/dev/` and an Astro integration adds its route only when `EA_DEV_PAGES=1`. Its demo texts are literals; it is outside the i18n and literal-text rules, and the ADR says so. Rejected: a page in `src/pages` (it would ship to production).
- **D9** The dark a11y scan is inside `expectNoA11yViolations`: it scans, switches the emulated scheme, scans again and restores. All 131 call sites get it with no spec change. It is off until stage 03 lands the tokens.
- **D10** Allowed raw colours: the QR code in `TotpQr.tsx` (black on white in both schemes). The guard test lists it by file; no other entry.
- **D11** A gap or a needed deviation is a question in the final message, not a choice.

## Facts checked (2026-11-23)

- Tailwind 4.3.5 theme variables `--text-xs`, `--radius-sm…xl`, `--font-sans` (read in `node_modules/tailwindcss/theme.css`); `global.css` already maps the radius scale from `--radius`.
- Nunito: OFL-1.1, variable, subsets `latin` and `latin-ext`, weights 200–900 (Fontsource API `api.fontsource.org/v1/fonts/nunito`).
- The CSP has `font-src 'self'` (`apps/web/astro.config.mjs`). The service worker caches `/_astro/*` (`apps/web/src/lib/service-worker.ts`).
- Raw palette classes exist in three feature files only: `PausedBanner.tsx`, `AuthErrorBanner.tsx`, `TotpQr.tsx`.
- e2e projects: `mobile` (Pixel 7) and `desktop` (1280 × 800); 131 calls of `expectNoA11yViolations`; 525 of 557 role selectors read text keys.
- Contrast of the values in `interfaces.md`: light primary on soft 4.65, on background 5.14, white on primary 5.59; every light pill ≥ 4.61; `--input` ≥ 3.02 in both schemes; dark destructive foreground 7.42.

## Not verified

- `injectRoute` in an Astro 7 integration for a page outside `src/pages`: stage 04 checks it first. If it fails, the page sits in `src/pages/dev/` and the build script deletes `dist/dev` unless `EA_DEV_PAGES=1`.
- The size of the two font files: stage 03 records it; over 150 KB together is a question.
- Tabular numbers in Nunito: stage 03 checks; if absent, `tabular-nums` stays in the code and changes nothing.
- The time of the e2e suite with two scans per call: stage 03 records it.

## Done when

The acceptance list of [`ticket.md`](ticket.md) holds, and `bun run ui:sheet` shows every page in the Pebble colours and font in both schemes.

## Rules for every stage

- Read the programme page, this file, `interfaces.md` and your stage file. Open the mockup HTML and the shots of the parts you build.
- Token classes only; no palette class, hex value or inline `style` (DB-2). No feature flag (PB-1).
- Keep every prop, variant name, `data-*` attribute and text key that exists (D5). Tests find elements by role and text key.
- Format and lint only the files of your stage. No `bun.lock` change.
- UI stages (03–06): run `UI_SHEET_ROUTES=<your routes> bun run ui:sheet`, open at least the phone and desktop PNG in both schemes, compare with the mockup shots, and name the files you looked at in the final message.
- A gap in a decision is a question in the final message (D11).

## Proof

- Stages 01, 02, 07: `mkdir -p /tmp/f166-NN && bun run check:job > /tmp/f166-NN/check.log 2>&1 && echo PROOF_OK`
- Stages 03–06: `mkdir -p /tmp/f166-NN && bun run check:job > /tmp/f166-NN/check.log 2>&1 && bun run web:build > /tmp/f166-NN/build.log 2>&1 && bun run test:e2e > /tmp/f166-NN/e2e.log 2>&1 && echo PROOF_OK`

## User checkpoints and steps

- **O1 (owner, before stage 03):** say yes to the commit of the mockup into the public repo. The coordinator then commits `design/ui-proposals/proposals/03-pebble/`, `design/ui-proposals/proposals/_shared/`, `design/ui-proposals/tools/` and `design/ui-proposals/analysis.md` without its "How to view" section (it names a private network address), and adds the rest of `design/` to `.gitignore`.
- **Look 1 (owner, after F167):** the full contact sheet (PB-12). Not a stop.

## Review

A Sonnet review before the land of stages 03, 04, 05 and 06. The review task adds: "Open the contact sheet or pattern page pictures the worker named and the mockup shots; report each visible difference from the mockup's pattern." Stages 01, 02 and 07 land on the proof.

## Stages

| # | Stage | Needs |
| --- | --- | --- |
| 01 | [Records: ADR and rules](stages/stage-01-records.md) | — |
| 02 | [Contact sheet and two-scheme scan](stages/stage-02-contact-sheet.md) | — ; may run next to 01 |
| 03 | [Tokens, font, scales](stages/stage-03-tokens-font.md) | O1; stage 02 (`ui:sheet`, the scan switch) |
| 04 | [Pattern page and primitives A](stages/stage-04-primitives-a.md) | stage 03 (tokens) |
| 05 | [Primitives B](stages/stage-05-primitives-b.md) | stage 04 (the pattern page) |
| 06 | [Patterns and the category look](stages/stage-06-patterns.md) | stage 04 (`Button`, `Card`, `Badge`, the pattern page); may run next to 05 |
| 07 | [Guards](stages/stage-07-guards.md) | stage 03 (tokens); may run next to 04–06 |

## How to run (coordinator)

Move the folder to `active/` and commit before the first spawn. One job per stage:

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<what the stage changes> · F166" \
  'Implement F166 stage NN. Read docs/product/pebble-ui/README.md and, in spec/features/active/F166-<slug>/, ticket.md, plan.md, interfaces.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: <the Proof command>. In the final message, list as proven only what a saved log shows.'
```

Land each stage with `limen land <job> --yes --keep-open`; the last one without `--keep-open`. Drop the job DB after the land. When the plan lands, start the planner jobs of F167–F170 (their `Plan after` is this folder's `interfaces.md`).

## Planning progress

Stages 01–07 [written]. Word counts and the cold review: § Cold review.

## Cold review

Not run yet.

## Log

- 2026-11-23: plan written in the planning session with the owner.
