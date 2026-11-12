# S5 plan probes (2026-11-08)

Scripts that checked the facts behind the S5 plan (`tasks/done/s5-web-panel.md`, "Facts checked"). The files end in `.txt` so `eslint .` and `tsc` skip them. Copy them into a temp folder and remove the `.txt` suffix to run them again. None of them touches the repo database `email_assistant`.

## Better Auth on Bun + Hono + Postgres (`auth.ts`, `server.ts`, `client.ts`, `setup-db.ts`, `schema.sql`)

Run on 2026-11-08 with Bun 1.4.4, `better-auth` 1.7.18, `hono` 4.13.16, `pg` 8.23, Postgres 17 (the dev Compose `db` on `127.0.0.1:5433`).

1. `cd <probe folder> && bun init -y && bun add better-auth@1.7.18 pg kysely hono @types/pg`.
2. From the repo root (so Bun loads the repo `.env` with `POSTGRES_PASSWORD`): `bun <probe folder>/setup-db.ts`. It creates the role `ea_probe` and the database `ea_s5_probe` and writes the connection URL to `<probe folder>/.probe-url` (mode 600). `--drop` removes both.
3. `bunx @better-auth/cli@latest generate --config ./auth.ts --output ./schema.sql -y` writes the SQL of the four tables (the result is `schema.sql.txt`: snake_case names through `modelName` and `fields`, `uuid` ids from `gen_random_uuid()`, `auth_accounts.password` holds the scrypt hash).
4. `psql "$(cat .probe-url)" -f schema.sql`, then `bun server.ts &` and `bun client.ts`.

Result: 10 of 10 checks pass: sign-up 200; wrong password 401; sign-in sets the cookie `better-auth.session_token` with `Max-Age`, `Path`, `HttpOnly`, `SameSite` (no `Secure`, because the base URL was `http://`; Better Auth adds it for an `https://` base URL); `/api/me` 200 with the cookie and 401 without; a `POST` with a foreign `Origin` gets 403 (`trustedOrigins`); sign-out 200 and the cookie is dead after it; a duplicate sign-up 422; a password under `minPasswordLength` 400.
Server log: one `WARN` that the rate limiter found no client IP and uses one shared bucket per path. Behind Tailscale Serve the plan sets `advanced.ipAddress.ipAddressHeaders` and `trustedProxies`.
Not verified: the same run on the server image Bun 1.3.14 (the Docker socket is not open to the agent on this PC).

## `Bun.password` (`bun-password.ts`)

`bun bun-password.ts` on Bun 1.4.4: the hash starts with `$argon2id$v=19$m=65536`, verify gives `true` for the right password and `false` for a wrong one. This was the fallback login design before Better Auth was chosen.

## Playwright 1.65 under Bun and Node (`playwright.config.ts`, `playwright-smoke.spec.ts`)

`bun add -d @playwright/test@latest` (1.65.0), the config points `launchOptions.executablePath` at `/usr/bin/chromium`. `bunx playwright test` passes (748 ms) and `npx playwright test` passes (587 ms). Playwright 1.65 runs the test runner under Bun with `bunx --bun playwright test`; without `--bun` it runs on Node.

## Better Auth: the first password of a CLI-created user (`probe2-first-password.ts`)

Run on 2026-11-08 against the same throwaway database, with server-side `auth.api` calls (no HTTP), twice: `DISABLE_SIGNUP=1` and `DISABLE_SIGNUP=0`.

- `emailAndPassword.disableSignUp: true` refuses the server-side `auth.api.signUpEmail` too (`BAD_REQUEST EMAIL_PASSWORD_SIGN_UP_DISABLED`). So the CLI cannot create users through sign-up while public sign-up is off.
- A user row inserted by SQL (name, email, `email_verified` true; no `auth_accounts` row) can go through the reset-password flow: `auth.api.requestPasswordReset({ body: { email, redirectTo } })` calls the configured `sendResetPassword({ user, url, token })` (the URL has the form `<baseURL>/api/auth/reset-password/<token>?callbackURL=<redirectTo>`, 120 characters); `auth.api.resetPassword({ body: { newPassword, token } })` creates the `credential` account with the password hash; `auth.api.signInEmail` then succeeds; the same token a second time is refused (`INVALID_TOKEN`).
- Both results are the same with `disableSignUp` on and off.

Design consequence (P1, D-lines of the master plan): public sign-up stays off in S5; `org:create` keeps inserting the user with our code; the setup link is Better Auth's reset-password link, requested by the CLI (`web:invite`) through `auth.api.requestPasswordReset` with a `sendResetPassword` callback that prints the URL in the CLI and sends an e-mail in S6.
