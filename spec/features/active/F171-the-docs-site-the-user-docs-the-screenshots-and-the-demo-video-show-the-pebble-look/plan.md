# F171 plan — the docs site, user docs, shots and demo video in the Pebble look

> **Status 2026-11-25 — planned.** Plan base: 0ccf4aa39. Five stages; nothing built; no owner step open. Cold review 1 filed; its findings fixed (§ Cold review).

Shared decisions (PB-1…13, DB-1…11) and § Rules for width: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Token values: `spec/features/*/F166-*/interfaces.md` § Tokens. Defaults for the owner: [`questions.md`](questions.md).

## Input

Owner's words: the programme page and the plan task of 2026-11-24 (theme stage needs only F166 stage 03; shots and video need F167 to F170).

### Product decisions

- **P1 Docs theme scope (PB-9).** The docs site takes the teal accent, the brand mark, the favicon and Nunito. Starlight's grays, sizes, layout and code theme stay (default, owner to confirm). A printed page stays Starlight blue (`print.css` hard-codes it; accepted). Rejected: Pebble grays (outside PB-9; new contrast proofs).
- **P2 Theme select stays** on the docs site (default). PB-10 is a panel rule.
- **P3 Shots stay light, 20 files.** `SHOTS` keeps 5 pages × 2 languages × 2 viewports, light scheme (default). Rejected: dark shots (40 files).
- **P4 Captions follow PB-8.** The e2e caption of step `report` loses the first person (texts in stage 05; default, owner to confirm). Captions name actions, not button labels.
- **P5 The e2e-seed take is a check, not an upload.** F171 records on the e2e seed; that video is never a G3 candidate (F151 D10). The demo-week take, upload and pin stay with F151 and the owner.
- **P6 README.** `README.md` has no panel picture; stage 03 checks again.

### Design decisions

- **D1 Accent values** (stage 01), in `apps/docs/src/styles/custom.css`, Starlight variables:

  | Variable | Light | Dark |
  | --- | --- | --- |
  | `--sl-color-accent-low` | `#d5f0ea` | `#133b34` |
  | `--sl-color-accent` | `#0a7568` | `#1fa892` |
  | `--sl-color-accent-high` | `#05453e` | `#3fd1b9` |

  From the panel's `--primary` and `--primary-soft` (light low and accent, dark high and low).
- **D2 Font** (stage 01). `custom.css` holds two `@font-face` rules for `"Nunito Variable"` that point by relative URL at the two files of `apps/web/src/assets/fonts/` (F166 stage 03), with the same `unicode-range` as `apps/web/src/styles/global.css`. `--sl-font` = the panel's `--font-sans` list. Rejected: a copy of the files (drift), a CDN, a package export.
- **D3 One mark** (stage 02). The source is `apps/web/brand/mark.svg` (F167 stage 01, D5 there). Docs favicon `apps/docs/public/favicon.svg` and logo `apps/docs/src/assets/mark.svg` are byte copies; a test fails on drift. Starlight `logo` has `alt: ""` (the site title next to it names it) and `replacesTitle: false`.
- **D4 The docs text check** (stage 03). Every key that a docs page or docs component reads through `UiText` must also be read by panel code (`apps/web/src` without `i18n/` and unit tests, `packages/core/src`, `apps/server/src`), directly or through a run-time prefix. The prefixes come from the list of the F166 unused-key test (F166 stage 07). Stage 03 moves that list to `apps/web/src/i18n/runtime-key-prefixes.ts`, `export const RUNTIME_KEY_PREFIXES: readonly { prefix: string; file: string }[]`; both tests import it. The F166 list has no `switch_` entry, so stage 03 adds `{ prefix: "switch_", file: <the file that builds `` `switch_${name}` `` at HEAD, today `apps/web/src/components/settings/ModeCard.tsx`> }`. Every docs key also passes `uiText` in both languages (no deleted key, no `{var}`). A prefix key passes even if the panel drops that one switch: the sweep is its only guard (accepted). Rejected: a second list (drift). Failure text: `docs_key_not_in_panel <key> <docs file>`.
- **D5 The check lands last, and `check:job` runs it.** Stage 03 runs after the page stages it names. `check:job` follows imports and the docs folders only, so stage 03 adds a step to `scripts/check-job.sh`: a change under `apps/web/src/`, `packages/core/src/` or `apps/server/src/` runs `apps/docs/src/panel-keys.test.ts`. A change in `en.ts` or `pl.ts` reaches it through the `uiText` import. Rejected: land the check now; accept the CI risk.
- **D6 Docs page ownership.** A page ticket stage owns the docs page of its page (DB-11). F171 stage 03 owns every docs page after its Needs are met: it fixes what the page tickets left. After stage 03 lands, a stage whose `check:job` fails on `docs_key_not_in_panel` or `ui_text_*` fixes the docs page itself (DB-11). The sweep skips the in-place pages (`CHANGELOG.md` is release history; `deploy/README.md` and `docs/release-checklist.md` are operator pages; default). F168 D11 holds: no approvals docs while `approvals_page` is default off.
- **D7 Polish pages.** An English page edit changes its Polish page in the same commit and restamps it: `bun run docs:stale --stamp <pl file>`. After stage 03, `bun run docs:stale --strict` passes for the whole site (the release runs it).
- **D8 Dark a11y** (stage 01). `docs:test` adds an axe pass in the dark scheme (`colorScheme: "dark"`, desktop) on a fixed list: home, start, `how-to/sender-rules`, `reference/settings`, `explanation/how-a-mail-is-sorted`, `faq`, `security`, `pricing`, each in English and, where it exists, Polish. Today's light passes stay.
- **D9 Shot texts** (stage 04). Rewrite an `E2E_ALT` text when the picture no longer matches it. A `DEMO_ALT` text changes only where the same words changed in `E2E_ALT`.
- **D10 Demo steps** (stage 05). Any step of `record.spec.ts` may get new locators; each step keeps its story, its `seconds` and its `live` flags. Roles and `en` keys, as today.
- **D11** A gap or a deviation is a question in the final message, not a choice.
- **D12 Contrast rule** (stage 01 test 2): convert each `hsl()` to 8-bit sRGB (round each channel), then apply the WCAG formula; compare to two decimals.

## Facts checked (2026-11-25, at 0ccf4aa39)

- F166 stage 03 landed: two Nunito files in `apps/web/src/assets/fonts/`, two `@font-face` rules in `global.css`.
- Starlight 0.43.1 `props.css`: light text-accent = accent, on bg-accent white; dark text-accent = accent-high, on it accent-low. `logo` takes `src`, `alt`, `replacesTitle`.
- D1 contrast under D12: every pair ≥ 4.8 (stage 01 test 2).
- 98 docs `UiText` keys; 7 only through `switch_${name}` and `undo_${kind}` (review 1, B1).
- Shots: made by CI at deploy, git-ignored. Demo video: release asset, pin null. `README.md`: no image.

## Not verified

- Vite resolves the relative font URL from `apps/docs` to `apps/web` in `astro build` and the dev server: stage 01 test 4.
- Starlight takes a logo SVG with a non-square view box at its size: stage 02 looks at it.

## Done when

The 4 acceptance items of [`ticket.md`](ticket.md) hold, and stage 03 test 1 passes on `master`.

## Rules for every stage

- No migration, no `bun.lock` change, no API change (DB-1). No edit of `apps/web/src` outside the files a stage names (Rules for width 3).
- English and Polish together (D7); docs sentences follow the docs page tests.
- Open every picture you make; copy it to `/tmp/f171-NN/` and give the paths.
- Format only the files of your stage.

## Proof

Stages 01–03: `mkdir -p /tmp/f171-NN && bun run check:job > /tmp/f171-NN/check.log 2>&1 && bun run docs:build > /tmp/f171-NN/build.log 2>&1 && bun run docs:test > /tmp/f171-NN/docs.log 2>&1 && echo PROOF_OK`

Stages 04 and 05 name their own Proof; it runs `bun run web:build` after `check:job` (the e2e server serves `apps/web/dist`, and a stale build records the old look).

## User checkpoints and steps

None. The owner looks at the full sheet before the release (PB-12, F172). Video upload and pin: owner gate G3 (F151), not this ticket.

## Review

Opus before the land of 03, 04, 05 (Polish text); Sonnet for 01, 02. Task line: "Open the pictures the worker named; report each difference from the panel."

## Stages

| # | Stage | Needs | May run next to |
| --- | --- | --- | --- |
| 01 | [Docs accent, font, dark a11y](stages/stage-01-docs-theme.md) | F166 03 | 03, 04, 05 |
| 02 | [Docs mark and favicon](stages/stage-02-docs-mark.md) | F167 01; stage 01 (`testMatch`) | 03, 04, 05 |
| 03 | [Docs text check and page sweep](stages/stage-03-docs-text.md) | F166 07; page stages | 01, 02, 04, 05 |
| 04 | [Docs shots on the new pages](stages/stage-04-shots.md) | page stages of the 5 shot pages | 01, 02, 03, 05 |
| 05 | [Demo takes on the new pages](stages/stage-05-demo-takes.md) | page stages of the 8 steps | 01–04 |

## How to run (coordinator)

Move the folder to `active/` first. One job per stage, board flags, `--prepare 'bash scripts/limen-prepare.sh'`:

```
limen spawn <flags> --label "<what the stage changes> · F171" 'Implement F171 stage NN. Read docs/product/pebble-ui/README.md and ticket.md, plan.md, stages/stage-NN-<slug>.md of spec/features/active/F171-<slug>/. Final proof: the Proof of the stage. List as proven only what a saved log shows.'
```

Start a stage when its Needs landed. Land with `--keep-open` but the last; drop the job DB.

## Planning progress

Stages 01–05 [written]. Scouts: 0 (the job task forbids `limen wait` and polling; the planner read the code). Words after review fixes: see `plan-review-1.md` § Response.

## Cold review

Model: Opus (the plan adds user-facing Polish text). Job `2026-11-24-f171-plan-review-77e8bf26` at `ad9e17294`: FAIL, 1 blocking, 7 gaps, 6 notes. All fixed; see [`plan-review-1.md`](plan-review-1.md) § Response.

## Log

- 2026-11-25: plan written at 0ccf4aa39; review 1 fixed.
