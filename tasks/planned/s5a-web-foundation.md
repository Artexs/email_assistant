> **Status 2026-11-08 — planned.** Left: the detailed stage plan (an own `plan-task` session: one file per stage with Goal, Files, Interfaces, Decisions, Test, Check, Done when, Out of scope), then the build with `run-task`.

# S5a Web foundation

Scope: the S5 master plan `tasks/active/s5-web-panel.md` (P1–P12, U1–U10, D1–D9, D17–D21, the API contract, "Rules for every step", the review model). Needs: S4 built (done). First segment of S5; S5b–S5e build on it.
Git mode: worktree (`task/s5a-web-foundation`). Run mode: pipeline.

## Goal

The server authenticates a web user with Better Auth, serves the static Astro build from the same origin, guards every page and API route with the session and the tenant context, and the owner can set a first password through a CLI link and log in. Playwright and CI are ready for the next segments.

## Done when

- `bun run web:invite --org-id … --user-id …` prints a one-time link; the setup page sets a password; `/login` signs the owner in; `/api/me` returns the user, the organization, the role and the scopes; sign-out ends the session (integration tests and the Playwright smoke test in the `mobile` and `desktop` projects).
- Without a session: `/api/*` answers 401 JSON; a page path redirects to `/login?next=…`; `/login`, `/setup`, `/_astro/*`, `/health`, `/api/auth/*` stay public. An assistant gets 403 `owner_only` on an owner route (route test matrix: 401, 403, 404 for another organization, 400 for a bad body).
- Public sign-up is off; `POST /api/auth/request-password-reset` answers 404 over HTTP; the reset token is single-use (tests).
- The hardening of D5 is on: CSP, frame denial, origin check on non-safe `/api/*` methods (403 `bad_origin`), body limit, HSTS only on `https://` base URLs; a log test proves that no token, cookie, secret, e-mail address or raw path reaches a log line.
- With `WEB_BASE_URL` empty the server starts as today and logs `web is off (WEB_BASE_URL is empty)`; the existing unit, integration and CLI tests stay green.
- `bun run web:build` produces `apps/web/dist` with the shell (U2, U3: bottom tabs under 1024 px, sidebar above), `/login`, `/setup`, `/404` and placeholder app pages; every string comes from `apps/web/src/i18n/en.ts`.
- CI has the `e2e` job (Playwright, Chromium) and the server image builds the web (`test -f /app/apps/web/dist/login/index.html` in the `image` job).

## Owns (from the master plan)

- Decisions D1 (auth instance), D2 (first password and resets), D3 (session middleware), D4 (login audit), D5 (hardening), D6 (static serving), D7 (config keys), D8 (composition), D9 (API conventions), D17 (Astro and React), D18 (dev loop), D19 (Playwright setup and the seed script), D20 (CI job), D21 (image).
- Contract rows: `/api/auth/*`, `GET /api/me` (the `onboarding` and `telegram` fields are `null` until S5b fills them; the shape is fixed here).
- New files (expected): `db/migrations/<version>_web_panel.sql`, `apps/server/src/platform/auth.ts`, `apps/server/src/web.ts`, `apps/server/src/modules/tenancy/routes.ts`, `apps/server/src/scripts/web-invite.ts`, `apps/server/src/scripts/e2e-seed.ts`, `packages/core/src/web/` (shared schemas: `me.ts`, `errors.ts`), `apps/web/src/{layouts,islands,lib,i18n,components/ui}`, `apps/web/e2e/`, the CI job, the Dockerfile lines.
- Changed files (expected): `apps/server/src/platform/{config,http}.ts`, `main.ts`, `tenancy/{repo,index}.ts`, `.env.example`, `apps/web/{astro.config.mjs,package.json}`, `deploy/{Dockerfile,compose.yaml}` (`WEB_DIST` only; the port comes in S5e), `.gitignore`, `docs/code-patterns.md` (the routes rule, the `listMembershipsOfUser` exception, the i18n rule).

## Stage sketch (the plan session turns each line into a stage file)

1. **Facts and probes** `[risky]`: Better Auth 1.7.18 on the image's Bun 1.3.14 against the dev DB with tables created by `migrator` and read by `app`; sign-in e-mail normalisation; `@hono/bun` `serveStatic` with a directory path and a `404.html` fallback; Hono `csrf()` next to Better Auth `trustedOrigins`; the strict CSP against a throwaway Astro build. Results go under "Facts checked"; a failed fact changes the D-line in the master plan first.
2. **Migration `web_panel`** `[risky]`: `users` columns, `auth_sessions`, `auth_accounts`, `auth_verifications` (D11 first part), `bun run db:types`, schema tests.
3. **Auth instance, config keys, invite CLI** `[risky]`: `platform/config.ts` (D7), `platform/auth.ts` (D1, D4 hooks), `tenancy.listMembershipsOfUser`, `scripts/web-invite.ts` (D2), the server-side `sendResetPassword` no-op; integration tests through `auth.api` (probe 2 as a test), the log test.
4. **HTTP platform** `[risky]`: `createApp({ checkDb, web })` with the middleware order of D5, `requireSession` and `requireOwner` (D3), static serving and redirects (D6), the `request-password-reset` block, `tenancy/routes.ts` with `/api/me`, `web.ts` (D8), `main.ts` wiring; the route test matrix; the error mapping.
5. **Astro static shell**: `astro.config.mjs` (D17), the dependency change, layouts and nav (U3), `i18n/en.ts` and `t()`, `lib/api.ts`, `lib/auth-client.ts`, `lib/use-resource.ts` (U7), `lib/time.ts` (U8), dark mode module, shadcn components through the CLI, pages `/login`, `/setup`, `/404` and placeholder app pages; `bun run web:build`, lint.
6. **Playwright setup** `[risky]`: `apps/web/e2e/playwright.config.ts` (D19), `scripts/e2e-seed.ts`, `test:e2e`, the login, setup and sign-out smoke in both projects, `.gitignore` entries, the local run with the system Chromium documented.
7. **CI and image**: the `e2e` job (D20), the Dockerfile web build and `WEB_DIST` (D21), the image check.
8. **Docs touch and notes**: `docs/code-patterns.md` lines, `notes/<date>-web-foundation-facts.md`, `.env.example` comments; group review; **user checkpoint 1** (the user logs in on the dev machine, both widths, signs out).

## Page-level questions for the plan session

Login page (fields, error texts, "no password yet" help text), setup page (password rules shown, success path), the shell (word mark, menu items while onboarding is open, the user menu), the 404 page, placeholder texts.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded (the S5 ADRs are written in S5e; S5a adds the facts they need to `notes/`).
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-08: Created by the S5 master plan session (`tasks/active/s5-web-panel.md`, P11).
