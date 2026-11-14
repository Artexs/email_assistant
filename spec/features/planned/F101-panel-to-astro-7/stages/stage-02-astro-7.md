# F101 stage 02 — Astro 7 [risky]

Part of [`../plan.md`](../plan.md). Read its D1–D7, D10, D11, facts F1–F12, § Rules for every stage and § Proof first. Needs stage 01 landed (the build check of D4 guards this stage).

`[risky]`: dependencies and the CSP of every page. This is the only stage of the ticket that changes `bun.lock` and a `package.json` (D11). Three steps; Step 1 is the risky one. About 30 changed lines plus `bun.lock`.

## Step 1 — Versions, lockfile and config [risky]

- **Goal:** `apps/web` builds on Astro 7.4.12 with the same 16 pages and the same CSP meta as on Astro 5.
- **Files:** `apps/web/package.json`, `bun.lock`, `apps/web/astro.config.mjs`. Nothing else (D6).
- **Interfaces:** none. The built pages keep their paths; the CSP meta keeps its form (plan F3).
- **Decisions:** D1, D2, D3, D6.
  1. In `apps/web/package.json`, `dependencies`, set exactly: `"astro": "7.4.12"`, `"@astrojs/react": "7.1.9"`, `"@tailwindcss/vite": "^4.3.5"`, `"tailwindcss": "^4.3.5"`. Leave every other line, also `"@astrojs/check": "^0.9.4"`.
  2. From the repo root: `bun install` (it rewrites `bun.lock`), then `bun update @astrojs/astro2tsx` (plan F6: 0.1.3 breaks `astro check`; 0.1.4 fixes it). The second command must not change any `package.json`; if it does, revert that file and say so.
  3. In `apps/web/astro.config.mjs`: rename the key `experimental` to `security`; keep the `csp: { directives: [...] }` object and its 7 directives exactly. Add `markdown: { syntaxHighlight: false },` after the `build` line, with a one-line comment above it: `// No Markdown in the panel; Shiki writes inline styles that the CSP (ADR 0016) does not allow.`
  4. Do not change any file under `apps/web/src/`. Only if `bun run web:build` stops with an Astro compiler error in an `.astro` file (an unclosed tag or invalid nesting, plan F12), close the tag or fix the nesting in that file, and list file, line and error in the final message (D6).
- **Test:** no new test file. The checks below are the test.
  1. `git diff --name-only` lists exactly `apps/web/package.json`, `apps/web/astro.config.mjs`, `bun.lock` (plus a D6 file, if any).
  2. `grep -c '\["astro@' bun.lock` prints `1`; `grep -o '\["astro@[^"]*' bun.lock` prints `["astro@7.4.12`; `grep -o '\["@astrojs/react@[^"]*' bun.lock` prints `["@astrojs/react@7.1.9`; `grep -o '\["@astrojs/astro2tsx@[^"]*' bun.lock` prints `["@astrojs/astro2tsx@0.1.4`.
  3. These stay the same as on `master` (compare `grep -o '\["<name>@[^"]*' bun.lock` before and after): `better-auth@1.7.18`, `react@19.1.1`, `react-dom@19.1.1`, `hono@4.13.16`, `typescript@5.9.3`, `@playwright/test@1.65.0`, `eslint@9.23.0`, `prettier@3.6.2`, `radix-ui@1.8.1`. If `master` moved one of them after this plan, it must equal `master`'s value. Any difference: stop and ask.
  4. `bun install --frozen-lockfile` passes.
  5. `bun run web:build`: the log has `csp checked in 16 page(s)` and no `[WARN]` line; `find apps/web/dist -name '*.html' | wc -l` prints `16` (or the new page count, see plan § Proof).
  6. `cd apps/web && bun run typecheck` reports `0 errors`, `0 warnings`.
  7. `grep -o '<meta http-equiv="content-security-policy"[^>]*>' apps/web/dist/login/index.html` shows the directives of plan F3, 7 `'sha256-…'` hashes in `script-src`, and `style-src 'self' 'unsafe-inline';`.
- **Check:** the commands of tests 1–7.
- **Done when:** tests 1–7 hold; one commit holds the three files (`git add apps/web/package.json apps/web/astro.config.mjs bun.lock`).
- **Out of scope:** CI (Step 2); docs (stage 03); any other dependency bump; a newer Astro than 7.4.12.

## Step 2 — Node 24 in the CI `ci` job

- **Goal:** the `ci` job builds the web app with a Node that the Astro 7 CLI accepts, independent of the runner image.
- **Files:** `.github/workflows/ci.yml`.
- **Interfaces:** none.
- **Decisions:** D5. In the `ci` job, after the `oven-sh/setup-bun@v2` step and before `bun install --frozen-lockfile`, add:

  ```yaml
      # The Astro 7 CLI needs Node 22.23.4 or later; `bun run web:build` starts it with the runner's Node.
      - uses: actions/setup-node@v4
        with:
          node-version: 24
  ```

  The `e2e` job already has the same step (keep it). The `image` job needs nothing (the image has no Node; Bun runs the CLI, plan F10).
- **Test:**
  8. `grep -c 'actions/setup-node@v4' .github/workflows/ci.yml` prints `2`.
  9. The YAML parses: `bun -e "console.log(Object.keys(Bun.YAML.parse(await Bun.file('.github/workflows/ci.yml').text()).jobs).join(' '))"` prints `ci e2e image` (checked on Bun 1.4.4 in planning).
- **Check:** tests 8 and 9.
- **Done when:** tests 8 and 9 hold; one commit with the file.
- **Out of scope:** other CI jobs or steps; the Bun version.

## Step 3 — The image path and the full e2e suite

- **Goal:** prove that the build works with Bun as the only runtime (the server image) and that the panel works end to end on Astro 7.
- **Files:** none, unless a check fails (then: stop and ask, except the D6 fix).
- **Decisions:** D5, D6. Set up the job's own e2e database first (plan § Rules, e2e). The e2e server serves `apps/web/dist` (`apps/web/e2e/env.ts`), so build before the e2e run.
- **Test:**
  10. `bun --bun run --cwd apps/web build`: exit 0, the log has `csp checked in 16 page(s)`.
  11. `flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e`: every test of both projects (`mobile`, `desktop`) passes, 0 failed, 0 skipped that were not skipped on `master`. This includes `auth.spec.ts` "the pages keep the CSP and show the 404 page" (it opens a Radix overlay: the scroll-lock style of ADR 0016) and the `cspErrors` checks of every spec.
- **Check:** tests 10 and 11 (the Proof runs both again).
- **Done when:** tests 10 and 11 pass.
- **Out of scope:** new e2e specs; a fix of a flaky spec (report it with its name and the error; the coordinator quarantines by `docs/code-patterns.md` § Tests).

## After the land (coordinator)

User step C1 of `plan.md`: the first `master` CI run after the land must be green in the `ci`, `e2e` and `image` jobs (plan N1, N3). Write the run id and the result into `plan.md` § Log.

## Done when (stage)

- Steps 1–3 hold.
- The stage 02 Proof command of `plan.md` prints `PROOF_OK` (`/tmp/f101-s02`).
- The final message lists: the resolved versions of `astro`, `@astrojs/react`, `tailwindcss`, `@tailwindcss/vite`, `vite`, `@astrojs/astro2tsx`; the e2e totals per project; any D6 fix.
