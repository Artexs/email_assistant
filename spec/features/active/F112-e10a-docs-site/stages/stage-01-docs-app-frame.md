# F112 stage 01 — Docs app frame [risky]

Part of [`../plan.md`](../plan.md). Read D1, D2, D13, § Rules and [`../probes/facts.md`](../probes/facts.md) F1, F2, F7, F11. Needs F101 in `done/`.

`[risky]`: new dependencies, a `bun.lock` change and the server image. Three steps.

## Step 1 — Site constants

- **Goal:** one source for the product name and the site address.
- **Files:** `packages/core/src/site.ts` (new) and its test; the `@ea/core` index.
- **Interfaces:** D2. `docsUrl(path, locale)` joins `DOCS_ORIGIN`, `DOCS_BASE`, `/pl` for `pl`, and `path`; `path` starts with `/`; the result ends with `/` for a page path.
- **Test:**
  - T1: `docsUrl("/", "en")` = `https://artexs.github.io/email_assistant/`.
  - T2: `docsUrl("/", "pl")` = `https://artexs.github.io/email_assistant/pl/`.
  - T3: `docsUrl("/start/", "en")` = `https://artexs.github.io/email_assistant/start/`.
  - T4: `docsUrl("start", "en")` throws (no leading `/`).
- **Done when:** T1–T4 pass.

## Step 2 — `apps/docs` on Starlight [risky]

- **Goal:** a Starlight site that builds from the workspace.
- **Files:** `apps/docs/` (new: `package.json`, `astro.config.mjs`, `tsconfig.json`, `src/content.config.ts`, `src/content/docs/index.mdx`, `src/content/docs/pl/index.mdx`), root `package.json` (scripts), `bun.lock`, `.gitignore` (`apps/docs/dist`, `apps/docs/.astro`), `eslint.config.js` ignores if the build output needs them.
- **Decisions:**
  - D1 versions, exact. Also the workspace dependencies `@ea/core` and `@ea/web` (`workspace:*`), used from stages 02 and 04, so that no later stage except 06 changes `bun.lock`. Add `@astrojs/markdown-remark` only if Bun does not resolve the Starlight peer (N5); say which.
  - Config: `site: DOCS_ORIGIN`, `base: DOCS_BASE`, `title: PRODUCT_NAME`, `defaultLocale: "root"`, locales `root` (`en`) and `pl`. No `editLink`, no `lastUpdated`, no `credits`, one social link to the GitHub repo. Starlight's built-in Pagefind search stays on. `markdown: { syntaxHighlight: false }` is not set: Starlight uses Expressive Code.
  - `security.csp` stays off in this stage; stage 02 turns it on together with its check.
  - The landing page (en and pl): two sentences on what the site holds, links to the sections that later stages add. F121 replaces it with the home page.
  - Root scripts: `docs:build` = `bun run --filter @ea/docs build`; `@ea/docs` `typecheck` = `astro check` (the root `typecheck` then covers it). No `docs:dev`.
  - `test:unit` gains `apps/docs/src apps/docs/integrations apps/docs/scripts` (the folders may be empty now; Bun must not fail on a missing folder, else add each when it first has a test).
- **Test:**
  - T5: `bun.lock` has one `["astro@` entry, `astro@7.4.12`, and `@astrojs/starlight@0.43.1`.
  - T6: `bun install --frozen-lockfile` passes.
  - T7: `bun run docs:build` exits 0; `apps/docs/dist/index.html`, `apps/docs/dist/pl/index.html` and `apps/docs/dist/pagefind/pagefind.js` exist.
  - T8: `bun run web:build` still logs `csp checked in <n> page(s)` with the page count of `master`.
  - T9: `bun run typecheck` 0 errors.
- **Done when:** T5–T9 hold.
- **Out of scope:** CSP (stage 02); content pages (stages 07–10).

## Step 3 — Server image

- **Goal:** the image builds with the new workspace and holds no docs source (D13).
- **Files:** `deploy/Dockerfile`, `.github/workflows/ci.yml` (`image` job check).
- **Decisions:** copy only `apps/docs/package.json` before the install, as for `tools/fake-telegram`. If the frozen install then pulls the Starlight tree into the image, use `bun install --filter` to skip `@ea/docs` only when the frozen install still passes; else keep it and say so (N3). Extend the `image` job check: `/app/apps/docs` holds only `package.json`.
- **Test:**
  - T10: `docker build -f deploy/Dockerfile -t ea-server:f112 .` exits 0 (when Docker is available; else say so, the CI `image` job proves it).
  - T11: `docker run --rm --entrypoint find ea-server:f112 /app/apps/docs -not -path '*/node_modules/*' -type f` prints only `/app/apps/docs/package.json`.
- **Done when:** T10, T11 hold, or the final message names them for CI.

## Proof

```
mkdir -p /tmp/f112-s01 && bun install --frozen-lockfile > /tmp/f112-s01/install.log 2>&1 && bun run lint > /tmp/f112-s01/lint.log 2>&1 && bun run typecheck > /tmp/f112-s01/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f112-s01/unit.log 2>&1 && bun run web:build > /tmp/f112-s01/web.log 2>&1 && bun run docs:build > /tmp/f112-s01/docs.log 2>&1 && test -f apps/docs/dist/pagefind/pagefind.js && echo PROOF_OK
```
