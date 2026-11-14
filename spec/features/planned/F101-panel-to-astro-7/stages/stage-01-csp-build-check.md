# F101 stage 01 — CSP build check

Part of [`../plan.md`](../plan.md). Read its D4, § Rules for every stage and § Proof first.

The panel is still on Astro 5.13.7 in this stage. Do not touch `package.json`, `bun.lock` or `astro.config.mjs`. Two steps, about 150 changed lines.

## Step 1 — Check one page: `cspProblem(html)`

- **Goal:** a pure function that says whether one built HTML page carries the CSP of ADR 0016 after the relax step.
- **Files:** `apps/web/integrations/csp-style-src.ts`, `apps/web/integrations/csp-style-src.test.ts`.
- **Interfaces:**

  ```ts
  export type CspProblem =
    | "csp_meta_count" // not exactly one <meta http-equiv="content-security-policy">
    | "no_default_src" // no directive exactly "default-src 'self'"
    | "no_script_src" // no directive that starts with "script-src "
    | "script_src_unsafe_inline" // the script-src directive holds 'unsafe-inline'
    | "style_src_not_relaxed"; // no directive exactly "style-src 'self' 'unsafe-inline'"

  export function cspProblem(html: string): CspProblem | null;
  ```

- **Decisions:** D4. How to read the page:
  - Find the CSP meta tags with `/<meta\b[^>]*http-equiv="content-security-policy"[^>]*>/gi` (case-insensitive, like the old `CSP_META`). The count must be 1, else `csp_meta_count`.
  - Take the `content="…"` value of that tag. Split it on `;`, trim each part, drop empty parts. These are the directives.
  - Check in this order and return the first problem: `csp_meta_count`, `no_default_src`, `no_script_src`, `script_src_unsafe_inline`, `style_src_not_relaxed`. Return `null` when all hold.
  - A directive matches `default-src 'self'` and `style-src 'self' 'unsafe-inline'` exactly (after trim). `RELAXED_STYLE_SRC` holds a trailing `;`; compare with the value without it (keep one constant for the directive text and build `RELAXED_STYLE_SRC` from it, so the two never drift).
  - `relaxStyleSrc` and its three tests stay as they are.
- **Test** (in `csp-style-src.test.ts`, `bun:test`). Fixed values:
  - `GOOD` = `<html><head><meta http-equiv="content-security-policy" content="default-src 'self';img-src 'self' data:;connect-src 'self';font-src 'self';form-action 'self';base-uri 'self';object-src 'none'; script-src 'self' 'sha256-a' 'sha256-b'; style-src 'self' 'unsafe-inline';"></head><body><p>x;</p></body></html>` (the real Astro form, plan fact F3).
  1. `cspProblem(GOOD)` is `null`.
  2. `GOOD` with the meta tag removed → `"csp_meta_count"`.
  3. `GOOD` with the meta tag twice → `"csp_meta_count"`.
  4. `GOOD` with `HTTP-EQUIV="Content-Security-Policy"` (upper case) → `null`.
  5. `GOOD` without `default-src 'self';` → `"no_default_src"`.
  6. `GOOD` without the `script-src …;` directive → `"no_script_src"`.
  7. `GOOD` with `script-src 'self' 'unsafe-inline' 'sha256-a';` → `"script_src_unsafe_inline"`.
  8. `GOOD` with `style-src 'self' 'sha256-c';` (not relaxed) → `"style_src_not_relaxed"`; and `GOOD` without any `style-src` → `"style_src_not_relaxed"`.
- **Check:** `bun test apps/web/integrations`
- **Done when:** tests 1–8 pass; the three old `relaxStyleSrc` tests pass unchanged.
- **Out of scope:** the build hook (Step 2); any other file.

## Step 2 — Check every page: `checkDist(dir)` in the build hook

- **Goal:** the build relaxes `style-src` and then checks every page; any problem, or a build with no page, stops the build.
- **Files:** `apps/web/integrations/csp-style-src.ts`, `apps/web/integrations/csp-style-src.test.ts`.
- **Interfaces:**

  ```ts
  // Relaxes style-src in every .html file under dir (rewrites a changed file), then checks each page with cspProblem.
  // Throws Error(`${problem} in ${relativePath}`) at the first bad page, Error("no html page in the build") when none exists.
  export function checkDist(dir: string): { checked: number; relaxed: number };
  ```

  The `astro:build:done` hook becomes: `const { checked, relaxed } = checkDist(fileURLToPath(dir));` then `logger.info(\`style-src relaxed in ${relaxed} page(s)\`)` and `logger.info(\`csp checked in ${checked} page(s)\`)`. The integration name `ea-csp-style-src` and the default export stay.
- **Decisions:** D4. The old throw ("style-src not found in the CSP meta of …") goes away: `style_src_not_relaxed` covers it. `relativePath` is the path relative to `dir` (use `node:path` `relative`), so the message holds no machine path. The file walk stays `htmlFiles` (recursive, `.html` only). Update the file's top comment: it relaxes and then checks (ADR 0016).
- **Test** (same file; each test makes its own folder with `mkdtempSync(join(tmpdir(), "f101-csp-"))` and removes it with `rmSync(dir, { recursive: true, force: true })` in `afterEach`):
  9. A folder with `index.html` and `legal/en/terms/index.html`, both `GOOD` with `style-src 'self' 'sha256-c';` (Astro's form before the relax) → returns `{ checked: 2, relaxed: 2 }`, and both files on disk now hold `style-src 'self' 'unsafe-inline';`.
  10. A folder with `index.html` = `GOOD` and `login/index.html` = `<html><head></head><body></body></html>` → throws an `Error` whose message is exactly `csp_meta_count in login/index.html`.
  11. A folder with `index.html` = `GOOD` but `script-src 'self' 'unsafe-inline';` → throws `script_src_unsafe_inline in index.html`.
  12. An empty folder (and a folder with only `_astro/x.js`) → throws `no html page in the build`.
  13. A folder with `index.html` = `GOOD` (already relaxed) → returns `{ checked: 1, relaxed: 0 }`.
- **Check:** `bun test apps/web/integrations && bun run web:build` — the build log shows `style-src relaxed in 16 page(s)` and `csp checked in 16 page(s)` on Astro 5. Then, as a hand check (do not commit it): change `"default-src 'self'"` in `astro.config.mjs` to `"default-src 'none'"`, run `bun run web:build`, see it fail with `no_default_src in …`, and restore the file with `git checkout apps/web/astro.config.mjs`. Write the failing line into the final message.
- **Done when:** tests 1–13 pass; the build logs both lines with 16; the hand check failed as expected and `git status` shows only the two files of this stage.
- **Out of scope:** the Astro version, the config (stage 02); docs (stage 03).

## Done when (stage)

- Steps 1 and 2 hold.
- The stage 01 Proof command of `plan.md` prints `PROOF_OK` (`/tmp/f101-s01`).
