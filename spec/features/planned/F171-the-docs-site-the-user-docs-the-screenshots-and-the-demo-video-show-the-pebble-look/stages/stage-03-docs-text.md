# F171 stage 03 — The docs text check and the page sweep

Needs F166 stage 07: the run-time prefix list of the unused-key test next to `apps/web/src/i18n/i18n.test.ts`. Needs the final panel texts that the docs pages name: F167 stages 05, 06; F168 stages 06, 07, 08; F169 stages 03, 06, 07, 08; F170 stages 01–07, 09. May run next to 01, 02, 04, 05 (it owns the docs pages under `apps/docs/src/content/docs/`, the new check and the moved prefix list).

Part of [`../plan.md`](../plan.md). Decisions P6, D4, D5, D6, D7, D11. Opus review before the land.

## Step 1 — One prefix list

- **Files:** new `apps/web/src/i18n/runtime-key-prefixes.ts`; the F166 unused-key test imports it.
- **Interface:** `export const RUNTIME_KEY_PREFIXES: readonly { prefix: string; file: string }[]` — the entries of the F166 test, moved unchanged. The file is not under `i18n/texts/` and defines no text.
- **Do:** move, do not copy. The F166 test keeps its own cases (its tests 7–9) green.

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
- **Docs files:** every `.md` and `.mdx` under `apps/docs/src/content/`, every `.astro` under `apps/docs/src/components/`, and `inPlaceSourcePaths()`.
- **Panel files** (D4): `.ts`, `.tsx`, `.astro` under `apps/web/src` (without `i18n/` and `*.test.*`), `packages/core/src`, `apps/server/src` (both without `*.test.*`).
- **Message:** each result fails as `docs_key_not_in_panel <key> <docs file>`.

## Step 3 — The sweep

- **Files:** the docs pages in English and Polish (D6, D7).
- For each page of the sidebar and its Polish page, read every sentence that names a panel button, heading, card, page or flow, and compare it with the panel at `HEAD` (the island code, or `bun run ui:sheet` pictures). Fix a sentence that is no longer true. Keep the page structure, headings and `<Shot />` lines.
- Known at plan time: `start/index.mdx` names "the Account card" (Settings group "Account and security" after F170 stage 05).
- A sentence for a flag-off feature stays out (`flagged-text.ts`; F168 D11 for approvals).
- `README.md`: if it now shows a panel picture, say so in the final message (P6); add none.
- Restamp each touched Polish page (D7).

## Test

1. `docsOnlyKeys` over the real tree gives `[]`.
2. Docs file `a.mdx` with `<UiText k="zz_docs_only" />`, panel file `b.tsx` with `t("other")`, no prefix → `[{ key: "zz_docs_only", file: "a.mdx" }]`.
3. Docs `<UiText k="switch_move" />`, panel file holds `` t(`switch_${name}`) `` only, prefix `switch_` → `[]`.
4. Docs `<UiText k="nav_rules" />`, panel file holds `t("nav_rules_hint")` only, no prefix → one result (a whole word, not a part of a longer key).
5. The same key in two docs files gives two results, sorted by file.
6. Break check: rename `nav_settings` in the real `start/index.mdx` to a key that only `en.ts` and `pl.ts` hold (for example add `zz_probe` to both); test 1 fails with `docs_key_not_in_panel zz_probe`; restore.
7. The F166 unused-key test passes with the moved list.
8. `bun run docs:stale` lists no stale page among the pages this stage touched.

## Out of scope

New docs pages (ticket). The approvals page docs (F168 D11). Shots and alt texts (stage 04). The theme (stages 01, 02).

## Done when

- Tests 1–8 pass; test 6 failed when broken.
- The final message lists each page changed with one line on why, and the pages read with no change.
- The Proof of `../plan.md` prints `PROOF_OK`.
