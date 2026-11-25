FAIL ad9e1729431f9b2dfa3f4a116a17ef7ab5b9e85c

HEAD matches the candidate (`git rev-parse HEAD` = ad9e1729431f9b2dfa3f4a116a17ef7ab5b9e85c, clean tree). The plan sits at the word limits (`wc -w`: plan.md 1466, stages 574/340/633/533/606). Its D1 accent values pass axe in both schemes (probe below). The plan has one blocking defect: the docs text check cannot pass as written. It also has seven gaps.

## BLOCKING

**B1. Stage 03 test 1 cannot pass if the prefix list moves unchanged.** Proven by reading the file and by grep.
- `stages/stage-03-docs-text.md:10-11` says the entries of the F166 test are "moved unchanged". `plan.md:33` says "The prefixes come from the list of the F166 unused-key test". `plan.md:47` names `switch_${name}` as one of the two run-time prefixes.
- The F166 list does not hold `switch_`. See `apps/web/src/i18n/unused-keys.test.ts:18-34`: it lists only `legal_kept_until_`, `cat_`, `cat_effect_`, `folder_`, `sec_kind_`, `browser_`, `os_`, `act_range_`, `act_cat_`, `act_tag_`, `act_rule_`, `undo_`, `sender_rel_`, `stats_m8_` and `rep_mode_`. The F166 test sees the switch keys only because it also counts `apps/docs/src` and `apps/web/e2e`. D4 removes those folders from the panel files.
- I ran a whole-word grep of the 98 docs keys over the D4 panel files. These 7 keys are missing: `switch_create_draft`, `switch_flag`, `switch_mark_read`, `switch_move`, `switch_move_unsure`, `undo_held`, `undo_started`. Only `undo_` is listed, so `docsOnlyKeys` on the real tree returns 5 results, not `[]`.
- Test 1 (`stage-03-docs-text.md:40`) fails at the plan base. Per D11 (`plan.md:40`), the worker must stop and ask.
- Fix: add one entry as a decision, `{ prefix: "switch_", file: "apps/web/src/components/settings/ModeCard.tsx" }`. That file builds `` t(`switch_${name}`) `` (lines 57 and 105), so F166 test 9 holds. Tell the worker to take the file at HEAD, because F170 stages 01–02 may move ModeCard.

## GAP

**G1. Stage 01 test 2 cannot hold to two decimals unless the plan picks a rounding rule.** Proven with the probe `/tmp/f171rev/r.ts`.
- `stage-01-docs-theme.md:29` fixes `4.82`, `9.32` and `7.94`. Starlight's grays are `hsl()` values (`props.css:11-12,132`).
- If I convert hsl to sRGB with no rounding, I get light accent on gray-6 4.828 → 4.83, dark accent-high on black 9.299 → 9.30, and on dark gray-6 7.931 → 7.93.
- The plan's numbers come out only when each channel is first rounded to 8 bits: 4.824, 9.319, 7.938.
- Fix: write the rule "convert hsl to 8-bit sRGB (round each channel), then apply the WCAG formula", or give a tolerance.

**G2. After stage 03 lands, a panel-only change can still turn master CI red. D5 reasons only about the time before the land.**
- `plan.md:34` (D5) says correctly that `check:job` runs tests that read the docs only when `docs/` or `apps/docs/` changed (`scripts/check-job.sh:40-42,62-66`). The pre-commit hook follows imports only.
- After the land, `panel-keys.test.ts` reads panel files at run time. Suppose a later stage removes the last panel read of a docs key and touches no docs file. Then `check:job` and the hook skip the test, and CI on master fails.
- Stages that can land after stage 03 include F167 04/07, F168 01–05, F169 01/02/04/05/09/10, F170 08/10 and all of F172 (none are in stage 03's Needs).
- Two related cases are not covered at all: a page stage that deletes a key the docs read, or that adds a `{var}` to such a text. Both break `docs:build` (`apps/docs/src/ui-text.ts:15-18`), and no page-stage Proof runs `docs:build` (Pebble README Rule 6).
- Fix: run `panel-keys.test.ts` in `check-job.sh` when files under `apps/web/src`, `packages/core/src` or `apps/server/src` change. Also have the test pass every docs key through `uiText`. That imports `en.ts` and `pl.ts`, so any text change triggers it. Or record the risk as accepted.

**G3. The Proofs of stages 04 and 05 do not build the panel first, so they can record the old look and still print PROOF_OK.**
- `stage-04-shots.md:41` and `stage-05-demo-takes.md:37` run `check:job` and then `docs:shots` or `demo:record`.
- The e2e server serves `apps/web/dist` (`apps/server/src/platform/config.ts:79`, default `WEB_DIST`). `scripts/limen-prepare.sh` builds nothing.
- `record.ts:93-94` fails only when `dist/404.html` is missing. It does not see a stale build.
- `check:job` merges master after any earlier build. A stale `dist` therefore gives old-look shots and takes with `PROOF_OK`, which silently breaks ticket acceptance 3 and 4.
- `docs-deploy.yml` runs `bun run web:build` before `docs:shots`.
- Fix: put `bun run web:build` after `check:job` in both Proofs.

**G4. Stage 03's Needs line misses F167 stage 04.**
- `stage-03-docs-text.md:3` names F167 stages 05 and 06 only.
- F167 stage 04 owns `PausedBanner.tsx` (F167 `stage-04-shell-parts.md:5,11`). The docs quote that banner and describe it: `faq.mdx:88-90`, `how-to/pause.mdx:53-55` and `pl/faq.mdx:92`, all reading `paused_banner_no_contact`.
- If F167 04 lands after stage 03, the sweep has missed it.

**G5. Stage 03 test 8 checks only the pages stage 03 touched.**
- D6 (`plan.md:35`) says stage 03 "fixes what the page tickets left". Page stages edit English pages under DB-11 and may not restamp the Polish twin.
- `docs-deploy.yml:107-108` runs `docs:stale --strict`, which blocks the release (F172) for a stale public page: home, start, security, pricing.
- Test 8 (`stage-03-docs-text.md:47`) should be: `bun run docs:stale` prints `stale: 0`. Today it prints `[docs-stale] stale: 0`.

**G6. The sweep rule clashes with history pages.**
- `stage-03-docs-text.md:32` says "For each page of the sidebar … Fix a sentence that is no longer true".
- The sidebar includes the in-place pages (`astro.config.mjs:76-77`), and `inPlaceSourcePaths()` returns `CHANGELOG.md`, `deploy/README.md` and `docs/release-checklist.md`.
- `CHANGELOG.md:122` quotes "what I would have done" and "Turn on recommended". These lines are release history and must not be rewritten.
- Fix: state that `CHANGELOG.md` is not swept, and say whether the operator pages are.

**G7. plan.md and stage 02 disagree on stage 02's Needs.**
- `plan.md:86` gives stage 02 Needs "F167 01" and "May run next to all".
- `stage-02-docs-mark.md:3` also needs stage 01 (its `testMatch` change), and `plan.md:85` gives stage 01 "all".
- A coordinator who reads the table can start 02 before 01. Then `brand.spec.ts` never runs, because `apps/docs/e2e/playwright.config.ts:16` sets `testMatch: "site.spec.ts"`, and test 4 is silently skipped.

## NOTE

- **N1. Stage 05's Needs labels do not match the steps it lists.** Checked against `record.spec.ts`.
  - The steps open, in order: `/mailboxes`, `/mailboxes`, `/report` (twice), the fake Telegram view, `/approvals`, `/delegations` and `/activity`. No step opens `/settings`.
  - So "F170 … 01, 02 (step 2, Settings)" at `stage-05-demo-takes.md:3` is a false dependency that only delays the start.
  - "(steps 2 and 8, Activity)" is wrong for step 2. "F168 05 (the locators of steps 6 and 8 on the approvals queue)" is wrong for step 8, which is Activity.
- **N2.** `ticket.md:37` says the shots and the video need F167–F170 "in `done/`". The stage Needs lines name single stages (`stage-04-shots.md:3`, `stage-05-demo-takes.md:3`). One of the two should go. Rules for width 5 prefers stages.
- **N3.** `plan.md:32` (D3) cites "F167 stage 01, D4 there" for `apps/web/brand/mark.svg`. In F167, D4 is the shape of the mark and D5 is the SVG source (`F167 plan.md:16-17`).
- **N4.** For the 7 prefix keys, the D4 check proves nothing: any `switch_*` or `undo_*` key passes even if the panel drops that switch. The sweep is the only guard for the mode-and-switches pages. Accept it or write it down.
- **N5.** The Look sections of stages 02 and 04 name no `/tmp/f171-NN/` folder. Stage 04's PNG files stay in the worker's git-ignored `apps/docs/public/shots/`. The Opus review that plan.md:79 asks for must open them from another worktree.
- **N6.** Starlight's `print.css:30-39` hard-codes the blue accent, so a printed page stays blue. This is harmless; one line in P1 would settle it.

## Checks run

- `bun install --frozen-lockfile`: 991 packages, OK.
- `/tmp/f171rev/c.ts` and `/tmp/f171rev/r.ts` (contrast probe on Starlight 0.43.1 `props.css`): the D1 pairs are 4.65–10.90; for the rounding mismatch, see G1. The break value `#13a08c` on white gives 3.26, so stage 01 test 3 can fail as planned.
- `bun run docs:build` at HEAD: exit 0, 55 pages; log in `/tmp/f171rev/build.log`.
- Axe probe `/tmp/f171rev/probe/axe.mjs` on the D8 list (16 pages), the same WCAG tags as `apps/docs/e2e/a11y.ts`:
  - dark scheme, today's site: 16 of 16 pages have no violation;
  - D1 values added as unlayered CSS: dark 16 of 16 and light 16 of 16 have no violation.
  - The Nunito font was not loaded. This is a probe, not the stage 01 test.
- Chromium probe of `document.fonts.check` with a font URL that does not load: it returns `false` (status `error`). Stage 01 test 7 therefore fails on a broken URL, as intended.
- Grep of the 98 docs `UiText` keys against the D4 panel files: 7 keys are missing (see B1).
- `bun run docs:stale`: `stale: 0`.
- I ran no test suite, lint or typecheck: this is a plan review. I removed the built `apps/docs/dist` afterwards, and the tree is clean.

Facts checked with no finding: the F166 stage 03 font files and `global.css` `@font-face`; Starlight's accent roles in light and dark; the `UiText` throw; the shot list (5 pages, 20 files, `SHOT_MIN_BYTES` 10 KB, the file-list test); the `demo:record` log lines (`demo_step <id> end`, `not_live`, `[demo-record] not for upload:`, `tmp/demo/*.vtt`); the demo video pin is null; `README.md` has no image; the CSP `font-src 'self'`.

Decisions for the owner: none.

## Note check

- HEAD equals candidate ad9e1729431f9b2dfa3f4a116a17ef7ab5b9e85c: proven. `git rev-parse HEAD` printed ad9e1729431f9b2dfa3f4a116a17ef7ab5b9e85c.
- Every finding quotes file and line and is sorted BLOCKING, GAP or NOTE: proven. The sections above give each finding a file:line and a class.
- Facts the plan uses are checked against the repo: proven. `apps/web/src/i18n/unused-keys.test.ts`, `scripts/check-job.sh`, `node_modules/@astrojs/starlight/dist/style/props.css`, `apps/web/e2e/demo/record.ts`, `/tmp/f171rev/build.log`, probe scripts `/tmp/f171rev/r.ts` and `/tmp/f171rev/probe/axe.mjs`. The probe outputs are not saved to a log file; they are quoted above.
- Easy-to-miss rule ("Missing code detail … is not a finding"): followed. Each finding names a missing decision, a test that cannot hold, a dependency, or a rule conflict. None asks only for line numbers or edit text.
- Reminder "Tests run once per job / no test:unit, test:int, test:e2e": followed. I ran none of them. I ran only probes, `docs:build` and `docs:stale`.
- Reminder "check:job before the final message for product-code jobs": not applicable. This is a review job and committed nothing.
- Reminder "A review job runs no test suite, lint or typecheck": followed. I ran no suite, lint or typecheck. The one-off probes proved specific doubts (B1, G1, D1 contrast, the font check).
- Reminder "never delete node_modules/.cache": followed. I deleted only `apps/docs/dist`, my own build output.

## Response (planner, 2026-11-25, at 41585d71d)

Each claim was checked against the code before the fix. All 14 findings are accepted; none is rejected.

- **B1 — fixed.** Confirmed: `unused-keys.test.ts` `BUILT_PREFIXES` has no `switch_`; `ModeCard.tsx` builds `` t(`switch_${name}`) ``. D4 and stage 03 step 1 add `{ prefix: "switch_", file: <the file that builds it at HEAD, today ModeCard.tsx> }`.
- **G1 — fixed.** Confirmed with a probe: raw hsl gives 4.828 / 9.299 / 7.931, 8-bit rounded gives 4.824 / 9.319 / 7.938. New D12 (round each channel to 8 bits, then WCAG, two decimals); stage 01 test 2 names it. The values stay.
- **G2 — fixed.** Confirmed: `check-job.sh` runs docs-reading tests only for `docs/` or `apps/docs/` changes. D5 and stage 03 step 3: `scripts/check-job.sh` runs `apps/docs/src/panel-keys.test.ts` when a file under `apps/web/src/`, `packages/core/src/` or `apps/server/src/` changes (test 10 checks the log line). The test also passes each docs key through `uiText` in both languages (test 9, with a break check), so a text change in `en.ts` / `pl.ts` triggers it through imports. D6: after the land, a stage that fails this check fixes the docs page itself.
- **G3 — fixed.** Confirmed: `WEB_DIST` defaults to `apps/web/dist`; `record.ts` checks only `404.html`. The Proofs of stages 04 and 05 run `bun run web:build` after `check:job`; plan.md § Proof says why.
- **G4 — fixed.** Confirmed: F167 stage 04 owns `PausedBanner.tsx`; four docs pages read `paused_banner_no_contact`. Stage 03 Needs adds F167 stage 04.
- **G5 — fixed.** D7 and stage 03 test 8: `bun run docs:stale --strict` exits 0 and prints `stale: 0` for the whole site.
- **G6 — fixed.** Confirmed: `IN_PLACE_PAGES` holds `CHANGELOG.md`, `deploy/README.md`, `docs/release-checklist.md`. D6 and stage 03 step 4: the sweep skips all three (default; `questions.md` item 6).
- **G7 — fixed.** plan.md § Stages: stage 02 needs F167 01 and stage 01; stages 01 and 02 may run next to 03, 04, 05.
- **N1 — fixed.** Confirmed in `record.spec.ts`: steps 1–2 open `/mailboxes`, 3–4 `/report`, 5 the fake Telegram view, 6 `/approvals`, 7 `/delegations`, 8 `/activity`. Stage 05 Needs drops F170 01, 02 and names F168 05 for steps 6 and 8, F168 06, 07 for step 8.
- **N2 — fixed.** `ticket.md` § Sequenced: the shots and video need the page stages their Needs lines name (no `done/` gate).
- **N3 — fixed.** D3 cites F167 D5 (the SVG source).
- **N4 — accepted risk, written down.** D4 says so; `questions.md` item 7.
- **N5 — fixed.** Rules for every stage: copy each picture to `/tmp/f171-NN/`. Stage 02 Look names `/tmp/f171-02/`; stage 04 copies the 20 PNG files to `/tmp/f171-04/shots/`.
- **N6 — fixed.** P1 states that print stays Starlight blue; `questions.md` item 8.

Words after the fixes (`wc -w`): plan.md 1497; stages 584, 344, 698, 550, 622.
