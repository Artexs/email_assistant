# F112 stage 04 — Front matter, stale check, UI labels

Part of [`../plan.md`](../plan.md). Read P2, P6, D7, D8 and discovery notes §4.7. Needs stage 03.

Three steps.

## Step 1 — Front matter schema

- **Goal:** each user page names the capabilities it describes; each Polish page names its source.
- **Files:** `apps/docs/src/content.config.ts` (`docsSchema({ extend })`), `apps/docs/src/front-matter.ts` (new) and test.
- **Interfaces:**
  - Fields: `capabilities?: string[]` (file names in `docs/capabilities/` without `.md`); `source?: string` (the English page id, for example `start`); `sourceHash?: string` (16 lowercase hex).
  - `USER_SECTIONS = ["start", "how-to", "reference", "explanation", "faq"]`; a page whose id starts with one of them (also under `pl/`) needs `capabilities` with at least one entry, each an existing file. Error at build: `front_matter capabilities <id>`.
  - `POLISH_SET: readonly string[]`: the English ids that need a Polish page (P6). This stage sets it to `["index"]`; stage 10 adds the P6 pages.
- **Test:**
  - T1: `capabilities: ["sync"]` passes; `["nope"]` fails with `front_matter capabilities <id>`.
  - T2: a `how-to/x` page without `capabilities` fails; `operate/install-and-run` needs none.

## Step 2 — `docs:stale`

- **Goal:** a stale Polish page is visible in CI and blocks a release (decision 6).
- **Files:** `apps/docs/scripts/stale.ts` (new) and test; root script `docs:stale`.
- **Interfaces:** `bodyHash(markdown: string): string` = first 16 hex of sha256 of the text after the closing `---` of the front matter, with `\r\n` → `\n`, lines that hold only a `<Shot … />` tag removed (stage 11: a screenshot never stales a translation), and trailing whitespace of the whole body removed.
  - `bun run docs:stale`: for each page under `pl/`: no `source` or `sourceHash` → error; `source` page missing → error; hash differs → `stale pl/<id> (source <id>)`. For each id in `POLISH_SET` without a Polish page → error `missing pl/<id>`. Errors exit 1; stale lines alone exit 0 with the count `stale: <n>`.
  - `--strict`: a stale page whose source is `index` or starts with `start` exits 1 (the public set of this ticket; F121 adds security and pricing). The E8b release checklist runs it.
  - `--stamp <pl file>`: writes the current `sourceHash` of its source into the file, changes nothing else.
- **Test:**
  - T3: `bodyHash("---\ntitle: A\n---\nHi\r\n\n")` equals `bodyHash("---\ntitle: B\n---\nHi")` and `bodyHash("---\ntitle: B\n---\nHi\n<Shot page=\"rules\" />")` (front matter, line ends and `<Shot>` lines do not count).
  - T4: a fixture with a matching hash → exit 0, `stale: 0`.
  - T5: a changed English body → exit 0, one `stale` line; with `--strict` and source `start` → exit 1.
  - T6: `POLISH_SET` id without a Polish page → exit 1, `missing pl/<id>`.
  - T7: `--stamp` on a fixture writes the hash, then T4 holds.
- **Decisions:** the stage stamps `pl/index.mdx` with `--stamp`.

## Step 3 — `<UiText>`

- **Goal:** a panel label on a doc page is the panel's own text (D8).
- **Files:** `apps/web/package.json` (`exports` for `./i18n/en` and `./i18n/pl`; keep what exists), `apps/docs/src/components/UiText.astro` (new), its test of the lookup function.
- **Interfaces:** `<UiText k="nav_settings" />` renders the text of key `k` for the page language (`Astro.currentLocale`; `root` → `en`); the type of `k` is the panel's `TextKey`. The lookup throws at build time on an unknown key (`ui_text_unknown <k>`: `astro check` does not type-check MDX) and on a text with `{var}` placeholders (`ui_text_has_vars <k>`). Output: `<span class="ui-label">…</span>`, no inline style.
- **Test:**
  - T8: lookup `nav_settings` in `en` = `Settings`; in `pl` = the `pl.ts` value.
  - T9: lookup of `trial_ends_on` throws `ui_text_has_vars trial_ends_on`.
  - T10: lookup of `no_such_key` throws `ui_text_unknown no_such_key`; a fixture `.mdx` page with that key fails `docs:build` (show one run, then remove the fixture).
- **Done when:** T1–T10 hold; `bun.lock` unchanged (stage 01 added the workspace link; a new package is a question).

## Proof

The plan's chain with `NN` = `04`, then `&& bun run docs:stale > /tmp/f112-s04/stale.log 2>&1` before `&& echo PROOF_OK`.
