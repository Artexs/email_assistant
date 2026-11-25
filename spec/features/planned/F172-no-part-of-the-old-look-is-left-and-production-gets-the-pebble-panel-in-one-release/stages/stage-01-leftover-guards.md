# F172 stage 01 — Leftover guards

Needs every panel file in its final page form (the guards scan all of them, so the range is the real dependency): F169 stages 01–10 and F171 stage 03. Stage 02 follows (D10). Owns the new guards, the text files, `global.css`, the ADR 0037 token table and the files it deletes. Opus review (new Polish text).

Decisions P5, D1, D2, D9, D10.

## Step 1 — Emoji guard and the Telegram button text

- **Goal:** no panel text holds an emoji (ADR 0037 decision 9, DB-8).
- **Files:** a new unit test in `apps/web/src/i18n/`. It reads every string of `en`, `pl` (with `i18n/texts/`) and every form of `enPlurals`, `plPlurals`, and fails with `<locale>.<key>[.<form>]: "<emoji>"` per hit. Pattern: `\p{Extended_Pictographic}` and U+FE0F.
- **Decisions:** P5. `cat_help` names the Telegram buttons in words: en "Rate mails with the tick or pencil button in Telegram, …"; pl "Oceniaj wiadomości przyciskiem z ptaszkiem lub ołówkiem w Telegramie, …"; the rest stays. A docs page that quotes the old text changes in the same commit (restamp Polish with `bun run docs:stale --stamp <file>`).
- **Test:**
  1. `"Rate with ✅"` in a fixture fails with the key and `✅`.
  2. `"✏️"` (with U+FE0F) fails.
  3. `"Saved · 3 → 4 – done…"` passes.
  4. A fixture plural `{ one: "1 ✅", other: "# ok" }` fails with `<locale>.<key>.one`.
  5. The real `en`, `pl` and plurals give an empty list.
- **Check:** put `✅` back into `cat_help` en and see test 5 fail.

## Step 2 — Unused source file guard

- **Files:** a new unit test in `apps/web/src/lib/`. It lists the `.ts`, `.tsx`, `.astro` files of `components/`, `islands/`, `lib/`, `layouts/` (no tests) and fails for each that no other file under `apps/web` imports. An importer is any source, page, script, e2e helper or `dev/` file (D9). Imports resolve with or without an extension and through the `@/` alias of `apps/web/tsconfig.json`. No hand list; an entry that still needs one gets a reason in `sweep.md` of the ticket folder, and stage 02 names it in ADR 0037 (D2).
- **Do:** delete `components/shell/Placeholder.tsx` and any other file found (also under `components/ui/`: stage 02 has not started), with the text keys only they read (DB-10).
- **Test:**
  1. Fixtures `{a.tsx imports ./b; b.tsx; c.tsx}`, entry `a.tsx`: reports `c.tsx` only.
  2. `./b.tsx` and `./b` both count for `b.tsx`.
  3. `import { X } from "@/components/ui/b"` counts for `src/components/ui/b.tsx`.
  4. A file imported only by `dev/sections/x.tsx` is not reported.
  5. The real source gives an empty list.
- **Check:** restore `Placeholder.tsx` once and see test 5 fail.

## Step 3 — Unused token guard

- **Files:** a new unit test in `apps/web/src/lib/`: `global.css` holds no token that nothing reads.
- **Rule:**
  - `--x` is used when `var(--x)` appears in `global.css` or a source file.
  - `--color-<name>` is used when a source file holds a colour class ending `-<name>` (`bg-`, `text-`, `border-`, `ring-`, `fill-` …, also with `/NN`).
  - `--radius-*`, `--text-*`, `--font-*`, `--shadow-*` are used when their class (`rounded-<n>`, `text-<n>`, `font-<n>`, `shadow-<n>`) appears.
  - Tailwind's base styles read `--font-sans` and `--font-mono`: they are always used.
  - A companion `--<token>--<modifier>` (`--text-xs--line-height`) is used when `--<token>` is used.
  - A token read only by an unused token is unused.
- **Do:** delete each unused token and its ADR 0037 token row, both schemes. A category token goes only if the enum lost the value.
- **Test:**
  1. `--color-secondary` with no `-secondary` class reports `--color-secondary` and `--secondary`.
  2. `--avatar-3` read by `--color-avatar-3`, with `bg-avatar-3` in a file, passes.
  3. `bg-primary/50` counts for `--color-primary`.
  4. `--font-sans` with no `font-sans` class passes.
  5. `--text-xs--line-height` passes with `text-xs` in a file, and is reported with `--text-xs` when no `text-xs` appears.
  6. The real files give an empty list.
- **Check:** add `--color-unused-x: red;` once and see test 6 fail.

## Out of scope

Classes and variants of `components/ui/`, and `dev/` (stage 02). `docs/capabilities/web-panel.md` (stage 05). Server and Telegram texts keep their emoji.

## Proof

`mkdir -p /tmp/f172-01 && bun run check:job > /tmp/f172-01/check.log 2>&1 && bun run web:build:dev > /tmp/f172-01/build.log 2>&1 && bunx playwright test -c apps/web/e2e/playwright.config.ts settings patterns > /tmp/f172-01/e2e.log 2>&1 && bun run docs:test > /tmp/f172-01/docs.log 2>&1 && echo PROOF_OK`
