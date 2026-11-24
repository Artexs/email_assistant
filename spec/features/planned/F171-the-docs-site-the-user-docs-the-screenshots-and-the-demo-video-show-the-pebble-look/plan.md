# F171 plan — the docs site, user docs, shots and demo video in the Pebble look

> **Status 2026-11-25 — planned.** Plan base: 0ccf4aa39. Five stages; nothing built; no owner step open. Cold review started, not yet filed (§ Cold review).

Shared decisions (PB-1…13, DB-1…11) and § Rules for width: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Token values: `spec/features/*/F166-*/interfaces.md` § Tokens. Defaults for the owner: [`questions.md`](questions.md).

## Input

Owner's words: the programme page. This plan's task (2026-11-24): "Its docs-site theme stage needs only F166 stage 03; the screenshot and video stages need F167 to F170 built."

### Product decisions

- **P1 Docs theme scope (PB-9).** The docs site takes the teal accent, the brand mark, the favicon and Nunito. Starlight's grays, sizes, layout and code theme stay (default, owner to confirm). Rejected: Pebble neutrals for the grays (outside PB-9; every gray pair would need a new contrast proof).
- **P2 Theme select stays.** Starlight's light / dark / auto select stays on the docs site (default). PB-10 (no manual switch) is a panel rule.
- **P3 Shots stay light, 20 files.** `SHOTS` keeps 5 pages × 2 languages × 2 viewports, light scheme (default). Rejected: dark shots (40 files, changes the F151 shot checks).
- **P4 Captions follow PB-8.** The e2e caption of step `report` loses the first person: en "Day 3: what it would have done." / pl "Dzień 3: co zrobiłby asystent." (default, owner to confirm). Captions name actions in plain words, not button labels, so a renamed button needs no caption change.
- **P5 The e2e-seed take is a check, not an upload.** F171 records on the default source (the e2e seed). That video is never a G3 candidate (F151 D10). The demo-week take stays with the F151 final-take ticket; it then runs on the new look by itself. Upload and pin of the video stay with the owner.
- **P6 README.** `README.md` has no picture of the panel at the plan base: nothing to make. Stage 03 checks it again.

### Design decisions

- **D1 Accent values** (stage 01), in `apps/docs/src/styles/custom.css`, Starlight variables:

  | Variable | Light | Dark |
  | --- | --- | --- |
  | `--sl-color-accent-low` | `#d5f0ea` | `#133b34` |
  | `--sl-color-accent` | `#0a7568` | `#1fa892` |
  | `--sl-color-accent-high` | `#05453e` | `#3fd1b9` |

  Light low and accent are the panel's `--primary-soft` and `--primary`; dark high and low are the panel's dark `--primary` and `--primary-soft`.
- **D2 Font** (stage 01). `custom.css` holds two `@font-face` rules for `"Nunito Variable"` that point by relative URL at the two files of `apps/web/src/assets/fonts/` (F166 stage 03), with the same `unicode-range` as `apps/web/src/styles/global.css`. `--sl-font` = the panel's `--font-sans` list. No copy of the font files, no CDN. Rejected: a copy (two sources drift); a package export (changes `@ea/web`).
- **D3 One mark** (stage 02). The source is `apps/web/brand/mark.svg` (F167 stage 01, D4 there). Docs favicon `apps/docs/public/favicon.svg` and logo `apps/docs/src/assets/mark.svg` are byte copies; a test fails on drift. Starlight `logo` has `alt: ""` (the site title next to it names it) and `replacesTitle: false`.
- **D4 The docs text check** (stage 03). Every key that a docs page or docs component reads through `UiText` must also be read by panel code (`apps/web/src` without `i18n/` and unit tests, `packages/core/src`, `apps/server/src`), directly or through a run-time prefix. The prefixes come from the list of the F166 unused-key test (F166 stage 07). Stage 03 moves that list to `apps/web/src/i18n/runtime-key-prefixes.ts`, `export const RUNTIME_KEY_PREFIXES: readonly { prefix: string; file: string }[]`; both tests import it. Rejected: a second list (drift). Failure text: `docs_key_not_in_panel <key> <docs file>`.
- **D5 The check lands last.** Stage 03 runs after the page tickets. Reason: `check:job` runs docs-reading tests only when `docs/` or `apps/docs/` changed, so a page stage that leaves a docs-only key would turn master CI red. Rejected: land the check now.
- **D6 Docs page ownership.** A page ticket stage owns the docs page of its page (DB-11). F171 stage 03 owns every docs page after its Needs are met: it fixes what the page tickets left. F168 D11 holds: no approvals docs while `approvals_page` is default off.
- **D7 Polish pages.** An English page edit changes its Polish page in the same commit and restamps it: `bun run docs:stale --stamp <pl file>`. `docs:stale` must report no stale page that the stage touched.
- **D8 Dark a11y** (stage 01). `docs:test` adds an axe pass in the dark scheme (`colorScheme: "dark"`, desktop) on a fixed list: home, start, `how-to/sender-rules`, `reference/settings`, `explanation/how-a-mail-is-sorted`, `faq`, `security`, `pricing`, each in English and, where it exists, Polish. Today's light passes stay.
- **D9 Shot texts** (stage 04). Rewrite an `E2E_ALT` text when the picture no longer matches it. A `DEMO_ALT` text changes only where the same words changed in `E2E_ALT` (a card name, a button); the F151 final take checks demo pictures.
- **D10 Demo steps** (stage 05). Any step of `record.spec.ts` may get new locators; each step keeps its story, its `seconds` and its `live` flags. Roles and `en` keys, as today.
- **D11** A gap or a deviation is a question in the final message, not a choice.

## Facts checked (2026-11-25, at 0ccf4aa39)

- F166 stage 03 landed: `apps/web/src/assets/fonts/nunito-latin-wght-normal.woff2`, `nunito-latin-ext-wght-normal.woff2`, two `@font-face` rules in `global.css`.
- Starlight 0.43.1 `dist/style/props.css`: light text-accent = accent, text on bg-accent = white; dark text-accent = accent-high, text on it = accent-low. `logo` takes `src`, `alt`, `replacesTitle`; favicon default `/favicon.svg`.
- Contrast of D1 (sRGB, probe): every pair ≥ 4.8; the values are stage 01 test 2.
- `UiText` throws `ui_text_unknown` at build. 98 keys read by docs; 7 only through run-time prefixes (`switch_${name}`, `undo_${kind}`).
- Shots are made by CI at deploy (`docs-deploy.yml`) and git-ignored; the demo video is a release asset, pin null in `apps/docs/src/demo-video.ts`.
- `README.md` has no image.

## Not verified

- Vite resolves the relative font URL from `apps/docs` to `apps/web` in `astro build` and the dev server: stage 01 test 4.
- Starlight takes a logo SVG with a non-square view box at its size: stage 02 looks at it.

## Done when

The 4 acceptance items of [`ticket.md`](ticket.md) hold, and stage 03 test 1 passes on `master`.

## Rules for every stage

- No migration, no `bun.lock` change, no API change (DB-1). No edit of `apps/web/src` outside the files a stage names (shared files belong to F166 and F167, Rules for width 3).
- English and Polish together (D7). A new or changed docs sentence follows the docs page rules (`how-to.test.ts`, `polish.test.ts`, `flagged-text.ts`, `public-content` integration).
- Open every picture you make; give the paths in the final message.
- Format only the files of your stage.

## Proof

Stages 01–03: `mkdir -p /tmp/f171-NN && bun run check:job > /tmp/f171-NN/check.log 2>&1 && bun run docs:build > /tmp/f171-NN/build.log 2>&1 && bun run docs:test > /tmp/f171-NN/docs.log 2>&1 && echo PROOF_OK`

Stages 04 and 05 name their own Proof.

## User checkpoints and steps

None. The owner looks at the full sheet before the release (PB-12, F172). Video upload and pin: owner gate G3 (F151), not this ticket.

## Review

Opus before the land of 03, 04, 05 (new user-facing Polish text). Sonnet for 01, 02. The task adds: "Open the pictures the worker named; report each difference from the panel."

## Stages

| # | Stage | Needs | May run next to |
| --- | --- | --- | --- |
| 01 | [Docs accent, font, dark a11y](stages/stage-01-docs-theme.md) | F166 03 | all |
| 02 | [Docs mark and favicon](stages/stage-02-docs-mark.md) | F167 01 | all |
| 03 | [Docs text check and page sweep](stages/stage-03-docs-text.md) | F166 07; page stages | 01, 02, 04, 05 |
| 04 | [Docs shots on the new pages](stages/stage-04-shots.md) | page stages of the 5 shot pages | 01, 02, 03, 05 |
| 05 | [Demo takes on the new pages](stages/stage-05-demo-takes.md) | page stages of the 8 steps | 01–04 |

## How to run (coordinator)

Move the folder to `active/` and commit first. One job per stage, board worker flags, `--prepare 'bash scripts/limen-prepare.sh'`:

```
limen spawn <flags> --label "<what the stage changes> · F171" 'Implement F171 stage NN. Read docs/product/pebble-ui/README.md and ticket.md, plan.md, stages/stage-NN-<slug>.md of spec/features/active/F171-<slug>/. Final proof: the Proof of the stage. List as proven only what a saved log shows.'
```

Start a stage when its Needs landed. Land with `--keep-open` but the last; drop the job DB.

## Planning progress

Stages 01–05 [written]. Scouts: 0 (the job task forbids `limen wait` and polling; the planner read the code). Words: plan about 1,450; stages 574, 340, 633, 533, 606.

## Cold review

Model: Opus (the plan adds user-facing Polish text). Job `2026-11-24-f171-plan-review-77e8bf26`, started detached on this branch at `ad9e17294`; not awaited (the job task forbids `limen wait`). The coordinator files its message as `plan-review-1.md` and continues this job for the fixes.

## Log

- 2026-11-25: plan written at 0ccf4aa39.
