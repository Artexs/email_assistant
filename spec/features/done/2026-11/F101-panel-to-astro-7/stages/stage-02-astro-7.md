# F101 stage 02 — Astro 7 [risky]

Part of [`../plan.md`](../plan.md). Read its D1–D11, § Rules, § Proof (`18` = pages at the plan base) and [`../probes/facts.md`](../probes/facts.md). Needs stage 01 landed.

`[risky]`: dependencies and the CSP of every page; the only `bun.lock` change (D11). Three steps; about 40 lines plus `bun.lock`.

## Step 1 — Versions, lockfile, config, font [risky]

- **Goal:** Astro 7.4.12 with the same pages, CSS values and CSP meta.
- **Files:** `apps/web/package.json`, `bun.lock`, `apps/web/astro.config.mjs`, `apps/web/src/styles/global.css`; nothing else (D6).
- **Baseline first** (before any change): build, run `../probes/css-vars.ts.txt` (as `/tmp/f101-s02/css-vars.ts`) on the joined `dist/_astro/*.css` into `/tmp/f101-s02/vars-before.txt`.
- **Decisions:**
  - D1: the four versions exactly as D1; every other `package.json` line stays (also `uqr`, `@astrojs/check`). From the root: `bun install`, then `bun update @astrojs/astro2tsx`; the second must change no `package.json` (if it does, revert that file and say so).
  - D2 and D3 in the config; the D3 line has a comment with its reason.
  - D6 (b): directly above `@theme inline {`, this block (then prettier on the file):

    ```css
    /* Tailwind 4.1 font stack: Tailwind 4.3 changed the default (ticket F101, D6). */
    @theme {
      --font-sans:
        ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol",
        "Noto Color Emoji";
    }
    ```

  - D6 (a): only on a compiler error in an `.astro` file; list file, line, error.

- **Test:**
  - T1: `git diff --name-only` lists exactly the four files (plus a D6 (a) file).
  - T2: `bun.lock` holds one `["astro@` entry, `astro@7.4.12`, `@astrojs/react@7.1.9`, `@astrojs/astro2tsx@0.1.4`.
  - T3: equal to `master` (values at the plan base): `better-auth@1.7.18`, `@better-auth/sso@1.7.18`, `react@19.1.1`, `react-dom@19.1.1`, `hono@4.13.16`, `typescript@5.9.3`, `@playwright/test@1.65.0`, `eslint@9.23.0`, `prettier@3.6.2`, `radix-ui@1.8.1`, `uqr@0.1.3`, `age-encryption@0.3.1`. A difference: stop and ask. Expected Astro-tree extras (F8, R1): `esbuild` removed, `sharp` 0.35.5, `ci-info` 4.5.0; name them.
  - T4: `bun install --frozen-lockfile` passes.
  - T5: `bun run web:build` logs `csp checked in 18 page(s)`, no `[WARN]`; 18 `.html` files.
  - T6: `bun run typecheck` in `apps/web`: 0 errors, 0 warnings.
  - T7: the CSP meta of `dist/login/index.html` has the F3 directives, 7 `'sha256-…'` hashes in `script-src`, and `style-src 'self' 'unsafe-inline';`.
  - T8 (CSS): `vars-after.txt` from the new build; `diff vars-before.txt vars-after.txt > /tmp/f101-s02/vars.diff` (exit 1 expected). Its `<` and `>` lines equal those of `../probes/css-vars-expected.diff`; hunk headers may differ (R1). `--font-sans` is `ui-sans-serif,system-ui,sans-serif,"AppleColorEmoji","SegoeUIEmoji","SegoeUISymbol","NotoColorEmoji"`. An extra line must be the same value in another form; list it. A changed `--font-*`, `--color-*`, `--radius*`, `--spacing`, `--text-*` size or `--shadow*` value: stop and ask.
- **Done when:** T1–T8 hold; one commit; keep `/tmp/f101-s02/vars*` (T8 proof).
- **Out of scope:** CI (Step 2); any other bump; a newer Astro.

## Step 2 — Node 24 in the CI `ci` job

- **Goal:** the `ci` job has a Node the Astro 7 CLI accepts.
- **Files:** `.github/workflows/ci.yml`.
- **Decisions:** D5. In the `ci` job, before `bun install --frozen-lockfile`, `actions/setup-node@v4` with `node-version: 24` and a comment with the reason. `e2e` keeps its step; `image` needs none (F10).
- **Test:**
  - T9: `actions/setup-node@v4` occurs 2 times in the file.
  - T10: `bun -e "console.log(Object.keys(Bun.YAML.parse(await Bun.file('.github/workflows/ci.yml').text()).jobs).join(' '))"` prints `ci e2e image`.
- **Done when:** T9, T10 hold; one commit.

## Step 3 — Image path and full e2e

- **Goal:** a Bun-only build (the image) works, and the panel works end to end.
- **Files:** none; a failure is a question (except D6 (a)).
- **e2e DB first:** `sed -i -E '/^E2E_(MIGRATOR_)?DATABASE_URL=/d' .env`, then `bun run db:worktree f101_s02_e2e | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' | sed 's/^/E2E_/' >> .env`. Never the shared `email_assistant_e2e`. The e2e server serves `apps/web/dist`: build first.
- **Test:**
  - T11: `bun --bun run --cwd apps/web build` exits 0 and logs `csp checked in 18 page(s)`.
  - T12: `test:e2e` (as in the Proof): `mobile` and `desktop` pass, 0 failed, no new skips against `master`; this includes "the pages keep the CSP and show the 404 page" (Radix scroll-lock style) and every `cspErrors` check.
- **Done when:** T11, T12 pass.
- **Out of scope:** new specs; flaky-spec fixes (report name and error).

## Done when (stage)

- Steps 1–3 hold; the stage 02 Proof prints `PROOF_OK` (`/tmp/f101-s02`).
- The final message lists: resolved `astro`, `@astrojs/react`, Tailwind, `vite`, `@astrojs/astro2tsx`; e2e totals per project; T3 extras; extra `vars.diff` lines; any D6 (a) fix.
