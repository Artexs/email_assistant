# F101 stage 01 — CSP build check

Part of [`../plan.md`](../plan.md). Read its D4, § Rules and § Proof (`18` = page count at the plan base).

Still Astro 5.13.7; do not touch `package.json`, `bun.lock` or `astro.config.mjs`. Two steps, about 150 lines, in `apps/web/integrations/csp-style-src.ts` and its test file.

## Step 1 — Check one page: `cspProblem(html)`

- **Goal:** a pure function: does one built page carry the ADR 0016 CSP after the relax?
- **Interfaces:**

  ```ts
  export type CspProblem =
    | "csp_meta_count" // not exactly one <meta http-equiv="content-security-policy"> (case-insensitive)
    | "no_default_src" // no directive exactly "default-src 'self'"
    | "no_script_src" // no directive named "script-src"
    | "script_src_unsafe_inline" // script-src, script-src-elem or script-src-attr holds 'unsafe-inline'
    | "unsafe_eval" // any directive holds 'unsafe-eval'
    | "style_src_not_relaxed" // no directive exactly "style-src 'self' 'unsafe-inline'"
    | "style_src_split"; // a style-src-elem or style-src-attr directive exists (it overrides the relaxed style-src)

  export function cspProblem(html: string): CspProblem | null;
  ```

- **Decisions:** D4.
  - Directives: the meta `content` split on `;`, trimmed, empty parts dropped; the name is the first word.
  - Return the first problem in the order of the type above; `null` when all hold.
  - `-elem` and `-attr`: Astro 7 can write them (facts F2); the panel config writes none.
  - Exact matches compare after trim. Build `RELAXED_STYLE_SRC` (trailing `;`) from one directive constant, so the two never drift.
  - `relaxStyleSrc` and its three tests stay as they are.
- **Test** (`bun:test`). Fixture `GOOD` = `<html><head><meta http-equiv="content-security-policy" content="default-src 'self';img-src 'self' data:;connect-src 'self';font-src 'self';form-action 'self';base-uri 'self';object-src 'none'; script-src 'self' 'sha256-a' 'sha256-b'; style-src 'self' 'unsafe-inline';"></head><body><p>x;</p></body></html>` (the real Astro form, facts F3).
  - T1: `GOOD` → `null`.
  - T2: Meta removed → `csp_meta_count`.
  - T3: Meta twice → `csp_meta_count`.
  - T4: `HTTP-EQUIV="Content-Security-Policy"` (upper case) → `null`.
  - T5: Without `default-src 'self';` → `no_default_src`.
  - T6: Without the `script-src …;` directive → `no_script_src`.
  - T7: `script-src 'self' 'unsafe-inline' 'sha256-a';` → `script_src_unsafe_inline`.
  - T8: `style-src 'self' 'sha256-c';` → `style_src_not_relaxed`; no `style-src` at all → `style_src_not_relaxed`.
  - T14: Plus `script-src-elem 'self' 'unsafe-inline';` → `script_src_unsafe_inline`.
  - T15: Plus `script-src-attr 'unsafe-inline';` → `script_src_unsafe_inline`.
  - T16: `script-src 'self' 'unsafe-eval' 'sha256-a';` → `unsafe_eval`.
  - T17: Plus `style-src-elem 'self';` → `style_src_split`; plus `script-src-elem 'self' 'sha256-a';` → `null`.
- **Check:** `bun test apps/web/integrations`
- **Done when:** T1–T8, T14–T17 and the three old tests pass.
- **Out of scope:** the build hook (Step 2).

## Step 2 — Check every page: `checkDist(dir)` in the build hook

- **Goal:** the build relaxes, then checks every page; a problem or no page stops it.
- **Interfaces:**

  ```ts
  // Relaxes style-src in every .html file under dir (rewrites a changed file), then checks each page with cspProblem.
  // Throws Error(`${problem} in ${relativePath}`) at the first bad page, Error("no html page in the build") when none exists.
  export function checkDist(dir: string): { checked: number; relaxed: number };
  ```

  The `astro:build:done` hook calls it and logs `style-src relaxed in <relaxed> page(s)` and `csp checked in <checked> page(s)`. Name `ea-csp-style-src` and default export stay.

- **Decisions:** D4. The old throw goes (`style_src_not_relaxed` covers it). `relativePath` is relative to `dir`: no machine path. Walk: recursive, `.html` only.
- **Test** (own temp folder each, removed in `afterEach`):
  - T9: `index.html` and `legal/en/terms/index.html`, both `GOOD` with `style-src 'self' 'sha256-c';` → `{ checked: 2, relaxed: 2 }`; both files now hold `style-src 'self' 'unsafe-inline';`.
  - T10: `index.html` = `GOOD`, `login/index.html` = `<html><head></head><body></body></html>` → throws exactly `csp_meta_count in login/index.html`.
  - T11: `index.html` = `GOOD` with `script-src 'self' 'unsafe-inline';` → throws `script_src_unsafe_inline in index.html`.
  - T12: An empty folder, and a folder with only `_astro/x.js` → throws `no html page in the build`.
  - T13: `index.html` = `GOOD` (already relaxed) → `{ checked: 1, relaxed: 0 }`.
- **Check:** `bun test apps/web/integrations && bun run web:build`: both lines with `18`. Hand check, not committed: `default-src 'none'` in `astro.config.mjs`, build, see `no_default_src in …`, `git checkout` the file; quote the line in the final message.
- **Done when:** T1–T17 pass; both log lines show the page count; the hand check failed; only the two files changed.
- **Out of scope:** stage 02 and 03 work.

## Done when (stage)

- Steps 1 and 2 hold.
- The stage 01 Proof of `plan.md` prints `PROOF_OK` (`/tmp/f101-s01`).
