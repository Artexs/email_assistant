# S5a web foundation — what the build learned (2026-11-10)

Written at the end of the S5a build (`tasks/done/s5a-web-foundation.md`, stages 1–15), for the S5b plan session and the S5e ADR writer. No secrets and no links with tokens.

## Versions as installed (2026-11-10, `bun pm ls --all` in the repo root)

- `better-auth@1.7.18` (exact pin; the same pin in `apps/server/package.json` and `apps/web/package.json`)
- `@hono/bun@1.0.1` (exact pin)
- `@playwright/test@1.65.0` (exact pin)
- `radix-ui@1.8.1` (the shadcn CLI installed it; the `sheet` and `dropdown-menu` components use it)
- `astro@5.13.7`
- Toolchain of this PC: Bun 1.4.4, Node 26.13.0, Chromium at `/usr/bin/chromium`. The `oven/bun:1.3.14` image gives the same results for Better Auth (fact 1 of the plan).

## CI: the `e2e` and `image` jobs (run on the branch after stage 14, 2026-11-10)

- The `e2e` job is green: 12 tests passed (6 cases × the projects `mobile` and `desktop`), 10.8 s of test time in a job of about 57 s, well under the 20-minute limit.
- The `image` job is green: `test -f /app/apps/web/dist/login/index.html` passes in the built image.
- The `ci` job is red on the branch **and** on `master`: the same two `testmail` unit tests (see `docs/known-alerts.md`, entry `runSend > 3: …`). They are a pre-existing `test-mail-traffic` flake, not an S5a regression.

## The server image

- Size after the web build: 1.01GB. The first local build hit a transient npm `eslint` tarball integrity error; the retry passed with the same Dockerfile and the same lockfile.
- The web dist sits at `/app/apps/web/dist` (`ENV WEB_DIST`), copied before `USER bun`; no e2e artefact reaches the image (`.dockerignore`).

## Hand check 11.3 (the dev loop, both shapes, HTTP level; 2026-11-10)

- `bun run web:dev` (Vite on 4321): the proxy forwards `/api` to 8080 and answers 401 without a session.
- The setup link from `bun run web:invite` follows `WEB_BASE_URL` and lands on `http://localhost:4321/setup?token=…`.
- `reset-password` and `sign-in` through the proxy (`Origin: http://localhost:4321`) answer 200; `/api/me` with the cookie answers 200 with role `owner`.
- The built shape (`bun run web:build && bun run dev`, 8080) signs in with `Origin: http://127.0.0.1:8080` → 200, and `/api/me` → 200 `owner`.
- The interactive part (menu, log out, both widths, CSP console) is covered by the Playwright smoke of stage 13 and by user checkpoint 1, not by this hand check.

## Deviations from the plan (each with its stage)

- **Stage 13, `nextAddress(base)`:** `apps/web/e2e/env.ts` gives each Playwright project its own address block (mobile `198.51.100.10+`, desktop `198.51.100.110+`). Reason: every project runs in its own worker, so one counter per run would reset and two tests could share an address; Better Auth's login limit (3 per 10 s per address) would then answer 429 in a later test.
- **Stage 13, `signIn` waits for hydration:** the helper waits for the island's `/api/auth/get-session` call before it fills the form. Reason: a click before hydration lands on the server-rendered form and reloads the page.
- **Stage 14, the Docker build:** the first build failed with a transient npm `eslint` tarball integrity error and passed on the retry. No change to the Dockerfile and no change to the lockfile.
- **Stage 14, the Prettier fold:** Prettier folded the `compose.yaml` healthcheck block to one line. Cosmetic; the compose file is valid and the healthcheck is unchanged.

## Further build facts a later segment needs

- **Better Auth skips its origin checks in tests (stage 8):** `bun test` sets `NODE_ENV=test`, and Better Auth's `isTest()` then sets `skipOriginCheck: true`. `createAuth` sets `advanced.disableOriginCheck: false`, so the tests run the same checks as production. S5b route tests that go through Better Auth need the same setting.
- **The seed reads the database name the way `pg` does (stage 12 fix):** a socket-style URL (`socket:/run/pg_e2e?db=…`) makes `pg` use the `?db=` value, so a path-based guard would protect the wrong name. `e2e-seed-args.ts` builds `new Client({ connectionString }).database` (no connection) and accepts only `postgres:`/`postgresql:` with `/^[A-Za-z0-9_]+_e2e$/`.
- **Playwright starts `webServer` before `globalSetup` (stage 13):** the e2e server reads its data per request, so this order is fine here. A later segment that needs migrate-before-start must do the migrate outside the webServer command.
- **The e2e seed file:** `apps/web/e2e/.seed.json` (mode 600, in `.gitignore`) holds the owner and one assistant per project with an unused setup link. It is the `SeedFile` of `e2e-seed-args.ts`.
- **The testmail flake:** `runSend > 3` and `AgentMail fake > holdResponseNext` take about 5.2 s on a CI runner and hit the 5 s default test timeout; the fix (an own timeout, like `mail-seed.test.ts`) belongs to `test-mail-traffic`. Entry in `docs/known-alerts.md`.

## Dependabot status

- `.github/dependabot.yml` exists (stage 15.1): version 2, ecosystem `bun`, `directory: /`, weekly, only `better-auth`, at most 2 open PRs, commit prefix `deps`.
- Not verified: whether Dependabot finds `better-auth` in the workspace manifests from `/`. The first weekly run after the merge tells (user step 4 of the S5a task). The fallback is a second entry with `directory: /apps/server`.
