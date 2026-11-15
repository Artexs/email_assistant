# F112 stage 02 — CSP and public-content check [risky]

Part of [`../plan.md`](../plan.md). Read D3, D4, D9, Q6 in [`../questions.md`](../questions.md) and facts F3–F5, F8. Needs stage 01.

`[risky]`: security of a public site. Three steps.

## Step 1 — Shared CSP check

- **Goal:** one `cspProblem` for the panel and the docs.
- **Files:** `packages/core/src/web/csp.ts` (new, exported from `@ea/core/web`) and test; `apps/web/integrations/csp-style-src.ts` imports it.
- **Interfaces:**
  - `cspProblem(html: string): CspProblem | null`, the current problems unchanged, plus `script_hash_missing`: an inline `<script>` (no `src`) whose sha256 (base64, of its exact text) is not in `script-src`.
  - `docsCspProblem(html)`: `cspProblem`, then `docs_directive_missing <d>` unless `object-src 'none'`, `base-uri 'self'`, `form-action 'none'` and `connect-src 'self'` are present.
- **Test:**
  - T1: the panel's current `csp-style-src.test.ts` cases pass against the moved function.
  - T2: `<script>a()</script>` with `script-src 'self'` → `script_hash_missing`; with the hash of `a()` added → `null`; `<script src="/x.js">` needs no hash.
  - T3: a docs page without `form-action 'none'` → `docs_directive_missing form-action`.

## Step 2 — `cspFinalize` for the docs [risky]

- **Goal:** every docs page has a CSP the browser accepts (F4); no content source adds a script.
- **Files:** `apps/docs/integrations/csp-finalize.ts` (new) and test; `apps/docs/astro.config.mjs`.
- **Decisions:**
  - Astro `security.csp` on: `default-src 'self'`, `img-src 'self' data:`, `font-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`. No `frame-ancestors` (Q6), `'unsafe-eval'` or `'wasm-unsafe-eval'` (F4).
  - At `astro:build:done`, per `.html` file: add each missing inline-script hash to `script-src`, set `style-src 'self' 'unsafe-inline'`, then `docsCspProblem`; the first problem throws `Error("<problem> in <relative path>")`; no page throws `no html page in the build`. Log `csp checked in <n> page(s)`. A page without a CSP meta fails (`csp_meta_count`).
  - The pass hashes Starlight's own scripts. So that content cannot add one: before the build, every `.md`/`.mdx` under `src/content/docs` and every `IN_PLACE_PAGES` source (stage 03) must hold no `<script`, no `javascript:` and no ` on<letters>=` attribute (`content_script <file>:<line>`).
- **Test:**
  - T4: a fixture page with two unhashed inline scripts → after the pass, both hashes are in `script-src` and `docsCspProblem` is `null`.
  - T5: no CSP meta → throws `csp_meta_count in <path>`; `'unsafe-inline'` in `script-src` → throws `script_src_unsafe_inline`.
  - T6: a fixture `.mdx` with `<img onerror=x>` → `content_script`.
  - T7: `bun run docs:build` logs `csp checked in <n> page(s)`; write `<n>` into the final message.

## Step 3 — Public-content check

- **Goal:** the build fails on private data or third-party assets (D4).
- **Files:** `packages/core/src/web/public-content.ts` (new, `@ea/core/web`: stage 11 uses it too) and test; `apps/docs/integrations/public-content.ts` (walks `dist`); `apps/docs/public-content-allow.txt` (lines `<exact string> | <reason>`).
- **Interfaces:** `publicContentProblems(text: string, allow: readonly string[]): { rule: string; match: string }[]`. Each rule runs on the raw text and on the text with HTML tags removed.
- **Rules** (files under `dist/` with `.html .xml .txt .json .css .js .svg .webmanifest`, not `pagefind/`):
  - R1: a host `*.ts.net` other than the literal `<machine>.<tailnet>.ts.net` (also HTML-escaped).
  - R2: a mail address whose domain is not `example.com`, `example.net`, `example.org` and does not end `.example`, `.test`, `.invalid`, `.localhost`.
  - R3: an IPv4 address in `100.64.0.0/10`, or public outside `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`. Loopback, RFC 1918 and `0.0.0.0` pass.
  - R4: `src=`, `srcset=`, `<link rel="stylesheet|preload|modulepreload|icon">` or CSS `url(` to another origin; `<a href>` to other sites passes.
  - R5: `<form`. R6: `document.cookie`, `gtag(`, `googletagmanager`, `plausible`, `umami`, `posthog`, `segment.com`.
  - R7: `Inbox Zero`, `Fyxer`, `Superhuman`, `Shortwave`, `SaneBox` (case-insensitive).
  - An allow-list string passes; an unused allow entry fails (`unused_allow <string>`). Error `public_content <rule> in <file>: <match>`. Log `public content checked in <n> file(s)`.
- **Test** (fixed strings):
  - T8: `bob.tail1234.ts.net` → R1; `<machine>.<tailnet>.ts.net` → pass; `bob.<span>tail1234</span>.ts.net` → R1.
  - T9: `ann@firma.pl` → R2; `ann@x.test`, `ops@example.com` → pass; `a@b.com` with an allow entry → pass.
  - T10: `100.101.102.103`, `8.8.8.8` → R3; `172.30.0.1`, `127.0.0.1`, `0.0.0.0` → pass.
  - T11: `<img src="https://cdn.example.org/a.png">` → R4; `<a href="https://github.com/">` → pass; `<form action="/x">` → R5; `fyxer` → R7.
  - T12: an unused allow entry → `unused_allow`.
  - T13: `bun run docs:build` passes and logs both check lines.

## Proof

The plan's chain with `NN` = `02`, with `bun run web:build > /tmp/f112-s02/web.log 2>&1 &&` before `docs:build`, then `&& grep -q 'csp checked in' /tmp/f112-s02/docs.log && grep -q 'public content checked in' /tmp/f112-s02/docs.log` before `&& echo PROOF_OK`.
