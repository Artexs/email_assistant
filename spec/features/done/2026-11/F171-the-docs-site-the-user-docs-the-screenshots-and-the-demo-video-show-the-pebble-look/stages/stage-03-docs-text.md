# F171 stage 03 — The docs text check and the page sweep

Needs F166 stage 07: the run-time prefix list of the unused-key test (`apps/web/src/i18n/unused-keys.test.ts`). Needs the final panel texts that the docs pages name: F167 stages 04 (`PausedBanner`, quoted by the pause and FAQ pages), 05, 06; F168 stages 06, 07, 08; F169 stages 03, 06, 07, 08; F170 stages 01–07, 09. May run next to 01, 02, 04, 05.

Part of [`../plan.md`](../plan.md). Decisions P6, D4, D5, D6, D7, D11. Opus review before the land.

## Step 1 — One prefix list

- **Files:** new `apps/web/src/i18n/runtime-key-prefixes.ts`; the F166 unused-key test imports it.
- **Interface:** `export const RUNTIME_KEY_PREFIXES: readonly { prefix: string; file: string }[]`: the entries of the F166 test, moved unchanged, plus one new entry `{ prefix: "switch_", file: <the file that builds `` `switch_${name}` `` at HEAD> }` (D4; today `components/settings/ModeCard.tsx`). It defines no text.
- **Do:** move, do not copy. The F166 test keeps its cases green.

## Step 2 — The docs text check

- **Files:** new `apps/docs/src/panel-keys.ts` and `panel-keys.test.ts`.
- **Interface:**
  ```ts
  docsOnlyKeys(
    docsFiles: { path: string; text: string }[],
    panelFiles: { path: string; text: string }[],
    prefixes: readonly { prefix: string }[],
  ): { key: string; file: string }[]
  ```
  A docs key is each `k="<key>"` of a `UiText` tag. It is in the panel when its name stands as a whole word in a panel file, or it begins with a listed prefix. One result per key and docs file, sorted by file then key.
- **Docs files:** `.md`, `.mdx` under `apps/docs/src/content/`, `.astro` under `apps/docs/src/components/`, and `inPlaceSourcePaths()`.
- **Panel files:** `.ts`, `.tsx`, `.astro` of the D4 folders, without `*.test.*`.
- **Message:** `docs_key_not_in_panel <key> <docs file>`.
- The test also calls `uiText(key, "en")` and `uiText(key, "pl")` for each real docs key (D4); that import makes `check:job` run it when `en.ts` or `pl.ts` changes.

## Step 3 — `check:job` runs the check (D5)

- **Files:** `scripts/check-job.sh`.
- **Do:** with no full run due and a changed file under `apps/web/src/`, `packages/core/src/` or `apps/server/src/`, run `apps/docs/src/panel-keys.test.ts`, log line `check:job: panel changed: panel-keys.test.ts`. Update the header comment.

## Step 4 — The sweep

- **Files:** the docs pages in English and Polish (D6, D7).
- For each page under `apps/docs/src/content/docs/` and its Polish page, compare every sentence that names a panel button, heading, card, page or flow with the panel at `HEAD` (island code or `bun run ui:sheet`). Fix a sentence that is no longer true; keep structure, headings and `<Shot />` lines. The in-place pages are not swept (D6).
- Known at plan time: `start/index.mdx` names "the Account card" (Settings group "Account and security" after F170 stage 05).
- No sentence for a flag-off feature (`flagged-text.ts`; F168 D11).
- `README.md`: a panel picture there goes in the final message (P6).
- Restamp each touched Polish page (D7).

## Test

1. `docsOnlyKeys` over the real tree gives `[]`.
2. Docs `a.mdx` with `<UiText k="zz_docs_only" />`, panel `b.tsx` with `t("other")`, no prefix → `[{ key: "zz_docs_only", file: "a.mdx" }]`.
3. Docs `<UiText k="switch_move" />`, panel file holds `` t(`switch_${name}`) `` only, prefix `switch_` → `[]`.
4. Docs `<UiText k="nav_rules" />`, panel holds `t("nav_rules_hint")` only → one result (whole word).
5. One key in two docs files: two results, sorted by file.
6. Break check: add `zz_probe` to `en.ts` and `pl.ts` and use it in place of `nav_settings` in `start/index.mdx`; test 1 fails with `docs_key_not_in_panel zz_probe`; restore.
7. The F166 unused-key test passes with the moved list.
8. `bun run docs:stale --strict` exits 0 and prints `stale: 0` (the whole site, D7).
9. Every docs key passes `uiText` in both languages. Break check: add `{name}` to the `pl.ts` text of one docs key; test 9 fails with `ui_text_has_vars <key>`; restore.
10. The `check:job` log of the Proof holds `check:job: panel changed: panel-keys.test.ts` (this stage changes `apps/web/src`).

## Out of scope

New docs pages. Approvals docs (F168 D11). Shots and alt texts (stage 04). The theme (stages 01, 02).

## Done when

- Tests 1–10 pass; tests 6 and 9 failed when broken.
- The final message lists each changed page with why, and the pages read with no change.
- The Proof of `../plan.md` prints `PROOF_OK`.
