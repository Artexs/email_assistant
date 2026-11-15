# F112 stage 03 — Operator docs in place, link check

Part of [`../plan.md`](../plan.md). Read D5, D6, D9 and facts F6, F8. Needs stage 02.

Two steps.

## Step 1 — In-place loader

- **Goal:** the operator guide on the site is `deploy/README.md` itself, never a copy (ADR 0030 point 3).
- **Files:** `apps/docs/src/in-place.ts` (new) and test; `apps/docs/src/content.config.ts`; `apps/docs/public-content-allow.txt` (entries for F8: `a@b.com` (an example in the address-pattern rules) and `100.100.100.100` (Tailscale's fixed DNS address, the same in every tailnet), each with its reason).
- **Interfaces:**
  - `IN_PLACE_PAGES: readonly { id: string; path: string }[]`, first entry `{ id: "operate/install-and-run", path: "deploy/README.md" }` (path from the repo root). E8b adds its runbooks here.
  - `inPlaceLoader()`: runs Starlight's `docsLoader()` first, then for each entry sets a store entry with `id`, `data` from `parseData` (`title` = text of the first `# ` line), `body` (the source without that line), `rendered` from `renderMarkdown`, and `filePath` (F6: required).
  - `rewriteLinks(markdown, sourcePath, ref): string` (pure, tested): a relative link to another `IN_PLACE_PAGES` source → its site path under `DOCS_BASE`; to another repo file → `https://github.com/Artexs/email_assistant/blob/<ref>/<path>`; a link that leaves the repo root → throws `in_place_link_outside <link> in <source>`. `#anchor` parts stay. Absolute URLs and pure `#anchor` links stay.
  - `ref` = env `DOCS_GIT_REF`, else `master`. The deploy (stage 05) sets the tag.
- **Decisions:** the stage 02 `content_script` check also reads every `IN_PLACE_PAGES` source. A missing source file or a source without a `# ` line fails the build (`in_place_source <path>`). The section "Operate" in the sidebar lists the in-place pages. The page is English only.
- **Test:**
  - T1: `rewriteLinks("[a](../docs/architecture.md)", "deploy/README.md", "v0.1.0")` = `[a](https://github.com/Artexs/email_assistant/blob/v0.1.0/docs/architecture.md)`.
  - T2: `[b](./backup.sh#L3)` from `deploy/README.md`, ref `master` → `…/blob/master/deploy/backup.sh#L3`.
  - T3: `[c](#update)` and `[d](https://example.com/)` stay.
  - T4: `[e](../../x.md)` from `deploy/README.md` → throws `in_place_link_outside`.
  - T5: a link to another in-place source → `/email_assistant/operate/<id>/` form.
  - T6: `bun run docs:build` builds `dist/operate/install-and-run/index.html`; its `<h1>` is the first heading of `deploy/README.md`.
- **Done when:** T1–T6 hold; the public-content check passes on the page with only the two F8 allow entries (another hit in `deploy/README.md` is a question).

## Step 2 — Link check

- **Goal:** no broken link on the site (D6).
- **Files:** `apps/docs/integrations/link-check.ts` (new) and test; `astro.config.mjs` (after `cspFinalize` and the public check).
- **Rules:** for each `.html` page, each `href` and `src` that starts with `DOCS_BASE` or is relative must resolve to a built file (`<path>`, `<path>/index.html` or `<path>.html`); each `#id` link (same page or with a path) must match an `id` on the target page. Links to other origins are not fetched. Error: `broken_link <href> in <page>`. Log `links checked in <n> page(s)`.
- **Test:**
  - T7: fixture `dist` with `/email_assistant/start/` present → pass.
  - T8: `/email_assistant/nope/` → `broken_link /email_assistant/nope/ in index.html`.
  - T9: `#missing` on a page without that id → `broken_link`.
  - T10: `bun run docs:build` logs all three D9 lines.
- **Done when:** T7–T10 hold.
- **Out of scope:** checking external URLs; changing `deploy/README.md` (a real problem in it is a question).

## Proof

The plan's chain with `NN` = `03`, then `&& grep -q 'links checked in' /tmp/f112-s03/docs.log` before `&& echo PROOF_OK`.
