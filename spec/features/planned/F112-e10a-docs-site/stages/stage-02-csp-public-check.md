# F112 stage 02 — CSP and public-content check [risky]

Part of [`../plan.md`](../plan.md). Read D3, D4, D9, Q6 in [`../questions.md`](../questions.md) and facts F3–F5, F8. Needs stage 01.

`[risky]`: security of a public site. Three steps.

## Step 1 — Shared CSP check

- **Goal:** one `cspProblem` for the panel and the docs.
- **Files:** `packages/core/src/web/csp.ts` (new, exported from `@ea/core/web`), its test; `apps/web/integrations/csp-style-src.ts` imports it; the panel's existing tests keep passing.
- **Interfaces:** `cspProblem(html: string): CspProblem | null` with the existing problems unchanged, plus `script_hash_missing`: an inline `<script>` (no `src`) whose sha256 (base64, of its exact text) is not in `script-src`. `checkDist` stays in each app (it uses `node:fs`).
- **Test:**
  - T1: the panel's current `csp-style-src.test.ts` cases pass against the moved function.
  - T2: a page with `<script>a()</script>` and `script-src 'self'` → `script_hash_missing`.
  - T3: the same page with `'sha256-<hash of "a()">'` in `script-src` → `null` (with the other required directives).
  - T4: a `<script src="/x.js">` needs no hash → `null`.
  - T5: `bun run web:build` logs the same page count as `master`.

## Step 2 — `cspFinalize` for the docs [risky]

- **Goal:** every docs page has a CSP that the browser accepts (F4).
- **Files:** `apps/docs/integrations/csp-finalize.ts` (new) and test; `apps/docs/astro.config.mjs`.
- **Decisions:**
  - Astro `security.csp` on, directives: `default-src 'self'`, `img-src 'self' data:`, `font-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`. No `frame-ancestors` (Q6), no `'unsafe-eval'`, no `'wasm-unsafe-eval'` (F4).
  - At `astro:build:done`, per `.html` file: add each missing inline-script hash to `script-src`, set `style-src 'self' 'unsafe-inline'`, then `cspProblem`; the first problem throws `Error("<problem> in <relative path>")`; no page throws `Error("no html page in the build")`. Log `csp checked in <n> page(s)`.
  - A page without a CSP meta is never given one by the pass: it fails (`csp_meta_count`).
- **Test:**
  - T6: a fixture page with two unhashed inline scripts → after the pass, both hashes are in `script-src` and `cspProblem` is `null`.
  - T7: a fixture page without a CSP meta → throws `csp_meta_count in <path>`.
  - T8: a page with `'unsafe-inline'` in `script-src` → throws `script_src_unsafe_inline`.
  - T9: `bun run docs:build` logs `csp checked in 2 page(s)` (landing en, pl) plus the 404 page if Starlight builds one; write the real count into the final message.

## Step 3 — Public-content check

- **Goal:** the build fails on private data or third-party assets (D4, ADR 0030 point 4).
- **Files:** `apps/docs/integrations/public-content.ts` (new) and test; `apps/docs/public-content-allow.txt` (new; lines `<exact string> | <reason>`).
- **Rules** (on every `.html`, `.xml`, `.txt`, `.json` under `dist/`, not `pagefind/`):
  - R1: a host `*.ts.net` other than the literal `<machine>.<tailnet>.ts.net` (also its HTML-escaped form).
  - R2: a mail address whose domain is not `example.com`, `example.net`, `example.org`, or ends `.example`, `.test`, `.invalid`, `.localhost`.
  - R3: an IPv4 address in `100.64.0.0/10` (tailnet), or a public address outside `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`; loopback and RFC 1918 pass.
  - R4: `src=`, `srcset=`, `<link rel="stylesheet|preload|modulepreload|icon">` or CSS `url(` to an origin other than the site; `<a href>` to other sites passes.
  - R5: `<form`.
  - R6: `document.cookie`, `gtag(`, `googletagmanager`, `plausible`, `umami`, `posthog`, `segment.com`.
  - R7: a competitor name from the deny list in the same file (`Inbox Zero`, `Fyxer`, `Superhuman`, `Shortwave`, `SaneBox`; case-insensitive).
  - A match on an allow-list string passes; an allow entry that matched nothing fails (`unused_allow <string>`). Error: `public_content <rule> in <file>: <match>`. Log `public content checked in <n> file(s)`.
- **Test** (fixtures in the test, fixed strings):
  - T10: `bob.tail1234.ts.net` → R1; `<machine>.<tailnet>.ts.net` → pass.
  - T11: `ann@firma.pl` → R2; `ann@x.test`, `ops@example.com` → pass; `a@b.com` with the allow entry → pass.
  - T12: `100.101.102.103` → R3; `172.30.0.1`, `127.0.0.1` → pass; `8.8.8.8` → R3.
  - T13: `<img src="https://cdn.example.org/a.png">` → R4; `<a href="https://github.com/">` → pass.
  - T14: `<form action="/x">` → R5; `fyxer` → R7.
  - T15: an unused allow entry → `unused_allow`.
  - T16: `bun run docs:build` passes and logs both check lines.

## Proof

The plan's chain with `NN` = `02`, then `&& grep -q 'csp checked in' /tmp/f112-s02/docs.log && grep -q 'public content checked in' /tmp/f112-s02/docs.log` before `&& echo PROOF_OK`. Also `bun run web:build` before `docs:build`.
