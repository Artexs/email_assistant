# s5a-web-foundation — Stage 14

Part of [`../s5a-web-foundation.md`](../s5a-web-foundation.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 14 — CI `e2e` job with its own database, the CI trigger for task branches, the image builds the web, the image check, `.dockerignore` [risky]

- [ ] **14.1 CI: the `e2e` job and the branch trigger (D20)**
  - Goal: every push runs the Playwright smoke on a second database next to the existing `ci` job, with traces kept on failure, inside 20 minutes; the workflow also runs on task branches, so a stage's CI evidence arrives before the merge.
  - Files: change `.github/workflows/ci.yml`.
  - Interfaces: `on.push.branches` becomes `[master, "task/**"]` and `on.workflow_dispatch: {}` is added (the existing `pull_request: [master]` stays); a new job `e2e` (no `needs`: it runs in parallel with `ci`):

    ```yaml
    e2e:
      runs-on: ubuntu-latest
      timeout-minutes: 20
      services: { postgres: <the same block as ci>, greenmail: <the same block as ci> } # GreenMail is unused in S5a; S5b connects a mailbox
      env:
        TEST_IMAP_HOST: 127.0.0.1
        TEST_IMAP_PORT: "3143"
        TEST_IMAPS_PORT: "3993"
        TEST_SMTP_PORT: "3025"
        E2E_DATABASE_URL: postgres://app:app_ci@localhost:5432/email_assistant_e2e?sslmode=disable
        E2E_MIGRATOR_DATABASE_URL: postgres://migrator:migrator_ci@localhost:5432/email_assistant_e2e?sslmode=disable
        DATABASE_URL: postgres://app:app_ci@localhost:5432/email_assistant_e2e?sslmode=disable
        MIGRATOR_DATABASE_URL: postgres://migrator:migrator_ci@localhost:5432/email_assistant_e2e?sslmode=disable
      steps:
        - uses: actions/checkout@v4
        - uses: oven-sh/setup-bun@v2
          with: { bun-version: 1.3.14 }
        - run: bun install --frozen-lockfile
        - name: Generate a test credentials key
          run: echo "CREDENTIALS_KEY=$(openssl rand -base64 32)" >> "$GITHUB_ENV"
        - name: Create database roles and the e2e database
          run: |
            psql "postgresql://postgres:postgres@localhost:5432/email_assistant" -v ON_ERROR_STOP=1 -v migrator_password=migrator_ci -v app_password=app_ci -f db/roles.sql
            psql "postgresql://postgres:postgres@localhost:5432/email_assistant" -v ON_ERROR_STOP=1 -c 'CREATE DATABASE email_assistant_e2e'
            psql "postgresql://postgres:postgres@localhost:5432/email_assistant_e2e" -v ON_ERROR_STOP=1 -c 'GRANT CONNECT ON DATABASE email_assistant_e2e TO migrator, app' -c 'REVOKE CREATE ON SCHEMA public FROM PUBLIC' -c 'GRANT USAGE, CREATE ON SCHEMA public TO migrator' -c 'GRANT USAGE ON SCHEMA public TO app'
        - run: bun run db:migrate
        - run: bun run web:build
        - run: bunx playwright install --with-deps chromium
        - run: bun run test:e2e
        - uses: actions/upload-artifact@v4
          if: failure()
          with: { name: playwright-results, path: apps/web/e2e/test-results/, retention-days: 7 }
    ```

  - Decisions: the `e2e` job uses the e2e database for everything (`DATABASE_URL` = the e2e URL too, so the seed's guard passes and `db:migrate` targets it); `db/roles.sql` is cluster-wide (the roles) plus a grant on `email_assistant` (its `:"DBNAME"` is the connected database), so the e2e database needs the four grant statements of `db-worktree.ts` `grantSchema`; `bunx playwright install --with-deps chromium` installs Playwright's Chromium and its libraries (`CHROMIUM_PATH` is unset in CI); `actions/upload-artifact@v4` keeps the traces (`trace: "retain-on-failure"`, stage 13.1). The `ci` job keeps `bun run web:build` as its last step. The branch trigger (cold review of this plan, finding 33): without it a push to `task/s5a-web-foundation` runs nothing, and the `ci` and `image` jobs then also run on every task branch push, which is the intent (the user may veto this in the end summary; the alternative is a draft PR, which is outward-facing). The job's wall time is a not-verified item: read it from the first run and write it in the log.
  - Test: the CI run on the branch after the push of this stage (pipeline mode pushes after PASS): the `e2e` job is green, `12 passed`, under 20 minutes; the `ci` and `image` jobs are green too. Locally: review the YAML by eye in `git diff` (no validator is installed).
  - Check: `bun run lint && bun run typecheck` (unchanged), `bunx prettier --check .github/workflows/ci.yml`, the CI run after the push.
  - Done when: the three jobs pass on the branch; the `e2e` duration is in the log line.
  - Out of scope: the fake Telegram as a second `webServer` (S5b), Dependabot (stage 15).

- [ ] **14.2 The image builds the web (D21); the image check; `.dockerignore`**
  - Goal: the server image carries the built web app at `/app/apps/web/dist` and the Compose service points `WEB_DIST` at it; the CI `image` job proves the file exists; no e2e artefact enters the image.
  - Files: change `deploy/Dockerfile`, `deploy/compose.yaml`, `.dockerignore`, `.github/workflows/ci.yml` (the `image` job).
  - Interfaces:

    ```dockerfile
    # deploy/Dockerfile, after `COPY apps/server apps/server`
    COPY apps/web apps/web
    # … after `COPY tsconfig.base.json ./`
    RUN bun run web:build
    ENV WEB_DIST=/app/apps/web/dist
    USER bun
    ```

    `.dockerignore` gains `apps/web/e2e/.seed.json`, `apps/web/e2e/test-results`, `apps/web/e2e/playwright-report` (cold review of this plan, finding 14: `COPY apps/web` would copy a one-time URL and traces into the image). `deploy/compose.yaml` `server.environment` gains `WEB_DIST: /app/apps/web/dist` (D21; the Dockerfile `ENV` is the default, Compose makes it explicit). The `image` job gains the step:

    ```yaml
    - name: Check that the image holds the built web app
      run: docker run --rm --entrypoint test ea-server:ci -f /app/apps/web/dist/login/index.html
    ```

  - Decisions: `.dockerignore` already excludes `apps/web/dist` and `apps/web/.astro`, so the image builds fresh; the build runs as root before `USER bun` (write access to `/app/apps/web/dist`); `bun install --frozen-lockfile` in the image installs the web's devDependencies too (Astro needs them to build), as it does for dbmate today. The port on loopback and the web keys in the VPS `.env` are S5e. The image grows by the web toolchain (Astro, Vite, React): accepted (one container, roadmap §3); note the size in the log (`docker image ls ea-server`).
  - Test: locally through `newgrp docker <<'EOF'` / `docker build -f deploy/Dockerfile -t ea-server:local .` / `docker run --rm --entrypoint test ea-server:local -f /app/apps/web/dist/login/index.html && echo web ok` / `docker run --rm --entrypoint find ea-server:local /app -path '*/e2e/.seed.json' -o -path '*/e2e/test-results*'` → nothing / `docker run --rm --entrypoint find ea-server:local /app/tools -not -path '*/node_modules/*' -not -name node_modules -type f` → only `/app/tools/fake-telegram/package.json` / `EOF` (fact 20); then the CI `image` job after the push.
  - Check: the local build and the three `docker run` checks (run by the main session in the worktree); `bunx prettier --check deploy/compose.yaml .github/workflows/ci.yml`.
  - Done when: the local image has the file and no e2e artefact, the tools check still holds, the CI `image` job is green.
  - Out of scope: the deploy (S5e).
