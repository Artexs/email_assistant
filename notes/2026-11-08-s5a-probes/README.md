# S5a plan probes (2026-11-08)

Scripts that checked the facts behind the S5a plan (`spec/features/done/2026-11/F050-s5a-web-foundation/plan.md`, "Facts checked"). The files end in `.txt` so `eslint .` and `tsc` skip them. Copy them into a temp folder and remove the suffix to run them again. None of them touches the repo database `email_assistant`: they ran on `email_assistant_s5aprobe` from `bun run db:worktree s5aprobe` (dropped at the end of the session with `--drop`).

Versions: Bun 1.4.4 (this PC) and `oven/bun:1.3.14` (the server image, through `newgrp docker`, see `notes/2026-11-08-docker-socket-newgrp.md`), `better-auth` 1.7.18, `hono` 4.13.16, `@hono/bun` 1.0.1, `pg` 8.23.0, `@playwright/test` 1.65.0, Astro 5.13.7, React 19.1.1, Tailwind 4.1.13, Postgres 17, Chromium `/usr/bin/chromium`.

## Setup

1. `bun run db:worktree s5aprobe > <folder>/.db-urls` from the repo root (mode 600; the file holds the two URLs with passwords; `db-urls.ts` reads it, nothing prints it).
2. `cd <folder> && bun init -y && bun add better-auth@1.7.18 pg@8.23.0 hono@4.13.16 @hono/bun@1.0.1 && bun add -d @types/pg @playwright/test@1.65.0`.
3. `bun apply-sql.ts migrator web_panel.sql` applies the draft of the D11 migration (`web_panel.sql.txt`) as `migrator`.

## `probe-auth.ts` — Better Auth 1.7.18 on our `users` table, server-side `auth.api`

`auth.ts.txt` is the D1 shape mapped onto `users` (`name` → `display_name`, …) and `auth_sessions`, `auth_accounts`, `auth_verifications`; the pool connects as `app`. Run with `bun probe-auth.ts` (Bun 1.4.4) and `newgrp docker <<'EOF' … docker run --rm --network host -v <folder>:/p -w /p oven/bun:1.3.14 bun probe-auth.ts … EOF`.

Result: the same on both Bun versions. 19 checks pass; the two "FAIL" lines were the probe's own wrong expectations and are the facts 4 and 5 below.

1. `app` reads and writes the tables that `migrator` created (the S0 default privileges); `has_table_privilege` is true for all four tables.
2. The CHECK `email = lower(email)` refuses a mixed-case insert (`23514`); `requestPasswordReset` and `signInEmail` with an UPPER-CASE e-mail find the lower-case row.
3. The first `resetPassword` creates the `credential` account (`account.create.after` fires with the full account and `ctx.path` `/reset-password`); the token is single-use (`INVALID_TOKEN`); the URL is `<baseURL>/api/auth/reset-password/<token>?callbackURL=<redirectTo>` (120 characters); `revokeSessionsOnPasswordReset: true` leaves 0 sessions after a later reset; the used verification row is gone.
4. On a later reset the `account.update.after` hook gets a **number** (the `updateMany` count), not the account. `emailAndPassword.onPasswordReset({ user })` fires on the first and on every later reset with `user.id`: that is the `web.password_set` hook.
5. `changePassword` with `revokeOtherSessions: true` keeps 1 of 2 sessions; `account.update.after` gets the **full account** (`userId`, `providerId: "credential"`) with `ctx.path` `/change-password` and `ctx.context.session.user.id` set: that is the `web.password_changed` hook. The same call **re-creates the session**, so `session.create.after` fires with `ctx.path` `/change-password`: `web.login` must check `ctx.path === "/sign-in/email"`.
6. The cookie is `ea.session_token` (`cookiePrefix: "ea"`), `Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax`, no `Secure` on an `http://` base URL (Better Auth adds `Secure` and the `__Secure-` name prefix for `https://`).
7. `disableSignUp: true` refuses the server-side `signUpEmail` (`EMAIL_PASSWORD_SIGN_UP_DISABLED`); a wrong password and an unknown e-mail give the same `INVALID_EMAIL_OR_PASSWORD`.
8. `Bun.serve({ idleTimeout: 90 })` and `Bun.password.hash` exist on 1.3.14; `node:net` `BlockList` (`addSubnet`, `addAddress`, `check`, IPv4-mapped IPv6) works on 1.3.14 and 1.4.4.

## `server.ts` + `client.ts` — the Hono shape of D5, D6, D1 (allow-list) over HTTP

`bun server.ts & bun client.ts` (Bun 1.4.4; a fake `dist/` with `login/index.html`, `mailboxes/index.html`, `404.html`, `_astro/x.js`, `favicon.png`). Result: 34 of 35 checks pass; the one "FAIL" is fact 5.

1. `@hono/bun` `serveStatic({ root })` with an absolute root: a directory path serves its `index.html` (`/mailboxes`, `/mailboxes/`), `onFound(path, c)` sets `Cache-Control` per path (`/_astro/*` immutable, HTML `private, no-store`), a miss falls through to `app.notFound` (the `404.html` body with status 404), `..` never reaches a file.
2. A page path without a session → 302 `/login?next=<path>`; with a session `/` → 302 `/onboarding`; `HEAD` works; `POST` on a page path → 404.
3. The own origin check (D5) answers 403 `bad_origin` before Better Auth for a missing or foreign `Origin`; a good `Origin` (`WEB_BASE_URL` or `http://localhost:4321`) passes both checks and Better Auth answers 401 `INVALID_EMAIL_OR_PASSWORD` for a wrong password (no double 403).
4. The allow-list: `request-password-reset`, `sign-up/email`, `update-user`, `sign-in/social`, `ok`, `list-accounts` → 404 JSON; the eight allowed paths reach Better Auth.
5. Better Auth refuses a non-GET without an `Origin` header (`MISSING_OR_NULL_ORIGIN`, 403) even with `Sec-Fetch-Site: same-origin`. A browser always sends `Origin` on a POST, so this never hits a real client.
6. `rateLimit.customRules["/sign-in/email"] = { window: 10, max: 3 }`: the 4th wrong sign-in within 10 s → 429 (one shared bucket here, because no client IP header reached Better Auth: the `warn` line of fact 7).
7. Better Auth resolves the client IP only from request headers (`@better-auth/core/dist/utils/ip.mjs`: `getIP` walks `advanced.ipAddress.ipAddressHeaders`, default `x-forwarded-for`; with `trustedProxies` it strips the chain from the right; without, it trusts a single-value header; it never sees the TCP peer). Hence D5: Hono resolves the address and passes it in `x-client-ip`.
8. `bodyLimit({ maxSize: 64 * 1024 })` → 413 for a 70 KB body. `secureHeaders` with `strictTransportSecurity: false` sends no HSTS. Sign-out kills the session (`/api/me` 401, `/get-session` → `null`).

## Astro CSP probe (`astro.config.mjs`, `csp-style-src.mjs`, `Shell.tsx`, `shell.astro`, `global-css-dark-media.diff`, `serve-dist.ts`, `csp-check.ts`)

Folder `/tmp/ea-s5-review/web` (the cold review's Astro probe) extended with `bunx --bun shadcn@latest add sheet dropdown-menu` (it installed the `radix-ui` package), an island with a Sheet, a DropdownMenu and a counter, and the dark-mode variables moved into `@media (prefers-color-scheme: dark)`. `bun run build`, then `bun serve-dist.ts` (the header CSP) and `bun csp-check.ts` (headless Chromium, 412 × 915, light and dark; records console errors and page errors; opens the Sheet and the menu).

1. **Header `default-src 'self'` with no `script-src` blocks the hashed inline scripts** ("Executing inline script violates … 'default-src 'self''. … 'script-src' was not explicitly set, so 'default-src' is used as a fallback"): the island never hydrates (the counter stays at 0), the Sheet never opens. A header and a meta policy intersect, so the header must not carry `default-src`. The cold review's fix (finding 1) was incomplete.
2. With the header reduced to `frame-ancestors 'none'` the island hydrates and the Sheet and the menu open. `frame-ancestors` inside the meta logs "ignored when delivered via a <meta> element": it stays out of the Astro directives.
3. Radix overlays inject a scroll-lock `<style>` when they open (`react-remove-scroll-bar`; `<style>` count 1 → 2); the strict `style-src 'self' <hashes>` blocks it ("Applying inline style violates…", body `overflow` stays `visible`). Its text holds the scrollbar width, so no fixed hash exists.
4. `experimental.csp.styleDirective.resources: ["'self'", "'unsafe-inline'"]` does not help: Astro always appends its style hashes (`runtime/server/render/csp.js`, `renderCspContent`), and Chromium says "'unsafe-inline' is ignored if either a hash or nonce value is present".
5. The integration `csp-style-src.mjs` (`astro:build:done`: rewrite `style-src [^;]*;` to `style-src 'self' 'unsafe-inline';` in every built HTML file) gives **zero console errors**, the Sheet and the menu open, the scroll lock applies (body `overflow: hidden`), in light and dark. The final meta: `default-src 'self';img-src 'self' data:;connect-src 'self';font-src 'self';form-action 'self';base-uri 'self';object-src 'none'; script-src 'self' <7 sha256 hashes>; style-src 'self' 'unsafe-inline';`.
6. The page holds 2 inline `<script>` (the island runtime), 1 inline `<style>` (Astro's `astro-island{display:contents}`), 0 external scripts, 1 stylesheet, also with `inlineStylesheets: "never"`.
7. Dark mode through the media query works without a script: body background `oklch(1 0 0)` in light and `oklch(0.145 0 0)` in dark.

## Other facts read from sources (2026-11-08)

- Dependabot supports `package-ecosystem: bun` for version updates (not security updates) with the text `bun.lock` of Bun ≥ 1.1.39 (https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories). Workspace detection for Bun is not documented: not verified.
- Playwright 1.65 types: `webServer` is one entry or an array (`command`, `cwd`, `env`, `port` or `url`, `reuseExistingServer`, `timeout`, `stdout`, `stderr`, `wait`, `gracefulShutdown`, `name`); `globalSetup` is a path or an array; `devices["Pixel 7"]` exists (bundled in `playwright-core/lib/coreBundle.js`).
- Node 26.13 has `process.loadEnvFile` (a function), so the Playwright config can read `.env` without a package.
- Better Auth 1.7.18 endpoints (`createAuthEndpoint` paths in `api/routes/*.mjs`): `/sign-in/email`, `/sign-in/social`, `/sign-up/email`, `/sign-out`, `/get-session`, `/list-sessions`, `/revoke-session`, `/revoke-sessions`, `/revoke-other-sessions`, `/update-session`, `/request-password-reset`, `/reset-password`, `/reset-password/:token`, `/change-password`, `/verify-password`, `/update-user`, `/change-email`, `/delete-user`, `/delete-user/callback`, `/send-verification-email`, `/verify-email`, `/link-social`, `/unlink-account`, `/list-accounts`, `/account-info`, `/get-access-token`, `/refresh-token`, `/callback/:id`, `/ok`, `/error`. `isDevelopment()` is `NODE_ENV` `dev` or `development`; `isProduction` is `production`; neither is set in the server image.
- Hono 4.13.16 `secureHeaders` options: `contentSecurityPolicy`, `xFrameOptions`, `strictTransportSecurity`, `crossOriginEmbedderPolicy` (default off), `permissionsPolicy`; `serveStatic` options: `root`, `precompressed`, `rewriteRequestPath`, `onFound`, `onNotFound`. `@hono/bun` exports `serveStatic`, `getConnInfo` (reads `server.requestIP(c.req.raw)`; needs the Bun server as the second `fetch` argument, which `Bun.serve({ fetch: app.fetch })` passes), `getBunServer`.

## After the cold review of the S5a plan (2026-11-08): two more probes

- **Bun and an empty environment value** (`env LOG_LEVEL= TELEGRAM_BOT_TOKEN= bun -e …` from the repo root, where `.env` holds both keys with values): Bun keeps `""` and does not refill it from `.env`; the same for a `Bun.spawn` child started with `env: { ...process.env, LOG_LEVEL: "" }`. So an e2e server started with `TELEGRAM_BOT_TOKEN: ""` stays off Telegram (fact 21).
- **`Origin` on a same-origin POST** (`serve-dist-rp.ts` serves the built shell with a configurable `Referrer-Policy` and echoes the headers of `POST /api/echo`; `origin-check.ts` runs a `fetch` POST with a JSON body and one with a form body from the page in headless Chromium): under `no-referrer`, `same-origin` and `strict-origin-when-cross-origin` the request carries `Origin: http://127.0.0.1:4183` and `Sec-Fetch-Site: same-origin`; only `Referer` follows the policy (absent under `no-referrer`). The Fetch specification allows `Origin: null` under `no-referrer`, so the plan sets `Referrer-Policy: same-origin` (fact 22). Firefox and Safari were not probed.
