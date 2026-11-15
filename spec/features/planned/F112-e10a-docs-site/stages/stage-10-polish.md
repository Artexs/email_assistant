# F112 stage 10 — Polish set

Part of [`../plan.md`](../plan.md). Read P6, D7, D8 and stage 07 § "Shared rules for content stages". Needs stages 07, 08, 09.

Review: Opus (new user-facing Polish text, `spec/build.md` TRACK). One step. Markdown about 600 lines.

## Step 1 — Polish pages

- **Goal:** a Polish user reads the landing page, the tutorial, the how-to guides, the FAQ and how a mail is sorted in Polish.
- **Files:** `apps/docs/src/content/docs/pl/**` (one page per source), `apps/docs/src/front-matter.ts` (`POLISH_SET`), `site-map.test.ts`, the Starlight Polish UI strings only if Starlight lacks one (it ships `pl`).
- **Pages** (P6): `index` (exists, re-stamp if its source changed), `start`, every `how-to/*` page that stage 08 wrote, `faq`, `explanation/how-a-mail-is-sorted`. `POLISH_SET` = exactly these ids.
- **Decisions:**
  - Translate the meaning, not word by word. Same sections, steps and links as the English page; links point to `/pl/…` pages where a Polish page exists, else to the English page (Starlight fallback).
  - Panel labels through `<UiText>`: the Polish page gets the `pl.ts` text by itself. Never type a panel label by hand.
  - Telegram texts: quote what a Polish user sees. The capability page `digest-and-notices` says whether Telegram messages follow the member's language (`POLISH_MESSAGES_ON`); when every member gets English, the Polish page quotes the English button and message texts and says so in one sentence.
  - Terms: use the words of `apps/web/src/i18n/pl.ts` for the same things (for example the names of the pages, "tryb", the categories as the panel shows them). Form of address: the one `pl.ts` uses; check it and keep it.
  - Each page: `source: <English id>` and the hash from `bun run docs:stale --stamp <file>` after the text is final.
  - Plain Polish, short sentences. No English words where `pl.ts` has a Polish term.
- **Test:**
  - T1: `bun run docs:stale` exits 0 with `stale: 0`; `bun run docs:stale --strict` exits 0.
  - T2: `site-map.test.ts` lists each `pl/…` id.
  - T3: `bun run docs:build` passes (links, front matter, public content).
  - T4: for each pair, the count of `##` headings and of numbered steps is the same in the English and the Polish page (a small test in `apps/docs/src/polish.test.ts`).
- **Done when:** T1–T4 hold; the final message lists the terms chosen where `pl.ts` had none, as owner decisions.
- **Out of scope:** reference and operator pages in Polish (P6); English text changes (a mistake in an English page is a question, or a fix with a re-stamp named in the final message).

## Proof

The plan's chain with `NN` = `10`, then `&& bun run docs:stale --strict > /tmp/f112-s10/stale.log 2>&1 && bun test apps/docs/src/polish.test.ts > /tmp/f112-s10/polish.log 2>&1` before `&& echo PROOF_OK`.
