# F172 stage 01 — Leftover guards

Needs the last page stages (the guards read every panel source file): F169 stages 01–10 and F171 stage 03 (the docs text check reads panel keys). May run next to 02 (02 owns `token-classes.test.ts`, `components/ui/`, `package.json`; this stage owns the new guards, the text files, the ADR token table and the files it deletes). Opus review before the land (new Polish text).

Part of [`../plan.md`](../plan.md). Decisions P5, D1, D2.

## Step 1 — Emoji guard and the Telegram button text

- **Goal:** no panel text holds an emoji (ADR 0037 decision 9, DB-8). F166 stage 07 left this guard to this ticket.
- **Files:** a new unit test in `apps/web/src/i18n/`. It reads every string of `en` and `pl` (with the group files under `i18n/texts/`) and fails with `<locale>.<key>: "<emoji>"` per hit. Pattern: `\p{Extended_Pictographic}` and U+FE0F; `·`, `→`, `–`, `%`, `…` are not pictographic and pass.
- **Decisions:** P5. `cat_help` names the Telegram buttons in words: en "Rate mails with the tick or pencil button in Telegram, …"; pl "Oceniaj wiadomości przyciskiem z ptaszkiem lub ołówkiem w Telegramie, …"; the rest of each sentence stays. A docs page that quotes the old text changes in the same commit (the docs text check finds it; restamp a Polish page with `bun run docs:stale --stamp <file>`).
- **Test:**
  1. `"Rate with ✅"` in a fixture table fails with the key and `✅`.
  2. `"✏️"` (with U+FE0F) fails.
  3. `"Saved · 3 → 4 – done…"` passes.
  4. The real `en` and `pl` give an empty list.
- **Check:** break it once: put `✅` back into `cat_help` en and see test 4 fail.
- **Done when:** the test passes and fails on the broken text.

## Step 2 — Unused source file guard

- **Goal:** no file of the panel source is a leftover that nothing imports.
- **Files:** a new unit test in `apps/web/src/lib/`. It lists the `.ts`, `.tsx` and `.astro` files of `components/`, `islands/`, `lib/`, `layouts/` (no tests, `dev/`, `pages/`, `sw/`) and fails for each file that no other file under `apps/web` imports (source, page, script or e2e helper; `lib/shell-precache.ts` counts through `scripts/build-sw.ts`). No hand list. If one entry still needs a list, give it a reason and say so in the final message: stage 02 names it in ADR 0037 (D2).
- **Do:** delete `components/shell/Placeholder.tsx` and any other file the test finds, with the text keys only they read (the unused-key test then passes; DB-10).
- **Test:**
  1. A fixture set `{a.tsx imports ./b; b.tsx; c.tsx}` with entry `a.tsx` reports `c.tsx` only.
  2. An import with an extension (`./b.tsx`) and one without (`./b`) both count.
  3. The real source gives an empty list.
- **Check:** restore `Placeholder.tsx` once and see test 3 fail.

## Step 3 — Unused token guard

- **Goal:** `global.css` holds no token that nothing reads.
- **Files:** a new unit test in `apps/web/src/lib/`.
- **Rule:** a base token `--x` is used when `var(--x)` appears in `global.css` or a source file. A theme token `--color-<name>` is used when a source file holds a colour class with the suffix `-<name>` (`bg-`, `text-`, `border-`, `ring-`, `fill-`, `stroke-`, `outline-`, `from-` …, also with `/NN`). `--radius-*`, `--text-*`, `--font-*`, `--shadow-*` are used when their class (`rounded-<n>`, `text-<n>`, `font-<n>`, `shadow-<n>`) appears. A token read only by an unused token is unused.
- **Do:** delete each unused token from `global.css` and its row from the ADR 0037 token table, both schemes. Delete a category token only if the category enum lost the value (the category-look test guards the rest).
- **Test:**
  1. `--color-secondary` with no `-secondary` class reports `--color-secondary` and `--secondary`.
  2. `--avatar-3` read by `--color-avatar-3`, with `bg-avatar-3` in a file, passes.
  3. `bg-primary/50` counts for `--color-primary`.
  4. The real files give an empty list.
- **Check:** add `--color-unused-x: red;` once and see test 4 fail.

## Out of scope

Classes and variants in `components/ui/` (stage 02). The docs site. Server and Telegram texts keep their emoji.

## Proof

`mkdir -p /tmp/f172-01 && bun run check:job > /tmp/f172-01/check.log 2>&1 && bun run web:build:dev > /tmp/f172-01/build.log 2>&1 && bunx playwright test -c apps/web/e2e/playwright.config.ts settings patterns > /tmp/f172-01/e2e.log 2>&1 && bun run docs:test > /tmp/f172-01/docs.log 2>&1 && echo PROOF_OK`
