> **Status 2026-11-03 — in progress.** Stages 1–4 done. Left: stages 5–7.

# S0 Foundation

Scope: `docs/roadmap.md` §2, row S0. Modules: `docs/modules.md`. Needs: — (ADR review done: `tasks/done/docs-and-adr-review.md`).

## Goal
A clean base: Bun workspaces (`apps/server`, `apps/web`, `packages/core`), env check, logger, DB layer with a migration runner, tenancy tables (`organizations`, `users`, `memberships`), Compose `db` for dev, CI, `GET /health`. Old code and deps removed (`docs/architecture.md` §12). Other tables come with their slice.

## Done when
- CI is green: lint, typecheck, unit tests, integration tests against Postgres in a service container.
- `bun run db:migrate` applies all migrations on an empty Postgres 17 container; `bun run db:types` generates the Kysely types.
- The server starts and `GET /health` returns 200 with the DB status.
- The env check stops the start on a missing key (test).
- A test shows that a tenancy repository function filters by `org_id`.
- `openai`, `express`, `helmet`, `cors`, `googleapis`, `@supabase/supabase-js`, `dotenv` are not in any `package.json`; `backend/supabase/` is gone.
- One lockfile (`bun.lock`); no `package-lock.json`. Root `.env.example` lists only keys that the code reads. README says Bun, not npm.
- `docs/code-patterns.md` matches the new layout.
- The server connects as the DB role `app`, not as `migrator` or a superuser (test). `db/roles.sql` creates `migrator` (owns the tables, runs the migrations) and `app` (passwords from env); the superuser runs it once: the `db` init script on the Mac, a `psql` step in CI (service containers cannot mount repo files). Details: `docs/architecture.md` §5.
- `bun run org:create` creates the pilot organization, user and owner membership (tenancy belongs to S0).
- `bun run gemini:test` runs from the repo root (script moved to `apps/server/src/scripts/`); `tasks/active/gemini-setup.md` and `docs/roadmap.md` §5 name the new command.
- CI lints, typechecks and builds `apps/web` (the Astro starter stays as it is until S5).

## Plan

Notes: migration runner = `dbmate` (user decision 2026-11-02; plain SQL files in `db/migrations/`, ADR 0011). Query layer = Kysely + kysely-codegen (ADR 0011). Fix root lint, husky and lint-staged paths (they point to `backend/**`).
The old `ImapEmailProvider` and all other old adapters are deleted in S0 (S1a can read them with `git show 29e9522:<path>`).
The dev Mac has the Docker CLI + Colima (installed 2026-11-02, `docker run postgres:17` works).

### Facts for all stages (read before each step)

- Bun 1.3.14 is installed on the dev Mac. `dbmate` is **not** installed globally: it comes from the npm package `dbmate` (devDependency, ships the binary; https://www.npmjs.com/package/dbmate).
- **A local Postgres already listens on `127.0.0.1:5432` on the dev Mac** (checked 2026-11-03 with `lsof`). The Compose `db` publishes on host port **5433** (`127.0.0.1:5433:5432`). Dev URLs use port 5433. CI uses port 5432 (service container).
- Current repo state: Astro starter in `src/`, `public/`, `astro.config.mjs`, `components.json`, root `tsconfig.json`, root `package.json` (name `10x-astro-starter`), root `bun.lock` **and** root `package-lock.json` (both tracked). Old server in `backend/` with its own `package.json`, `bun.lock`, `package-lock.json`, `eslint.config.js`, `.prettierrc.json`, `.vscode/`, `supabase/`, `src/`.
- `backend/.env` exists and is **not** tracked (gitignored). It holds the user's real `GEMINI_API_KEY`. There is no root `.env`. Never print, log or commit the content of any `.env` file.
- `.husky/pre-commit` runs `npx lint-staged`. The root `lint-staged` config points to `backend/**` and runs `bun fmt` / `bun fmtb` on the whole repo.
- Package names: root `email-assistant` (private), workspaces `@ea/server` (`apps/server`), `@ea/web` (`apps/web`), `@ea/core` (`packages/core`).
- Test layout: unit tests `*.test.ts` next to the code in `packages/core/src/` and `apps/server/src/`. Integration tests (need Postgres) live in `apps/server/test/integration/*.test.ts`. Root scripts: `test:unit` = `bun test packages/core apps/server/src`, `test:int` = `bun test apps/server/test`. (Bun treats the arguments as path filters.)
- Code style (from `CLAUDE.md` and `docs/code-patterns.md`): TypeScript strict; `const` / `let` only; template literals, never `+` for strings; the `log` util with a `[module]` prefix, never `console.log`; no secrets in logs; a module exposes one `index.ts`; `packages/core` has no I/O and no `process.env`.
- DB column names stay snake_case in TypeScript (no Kysely `CamelCasePlugin`).
- After each stage, these must pass: `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test:unit` (from stage 2 on). From stage 4 on, also `bun run test:int` with the Compose `db` running and migrated.

### Stage 1 — Workspaces, `packages/core`, web app move, root lint
- [x] **1.1 Root workspace and `packages/core`**
  - Goal: The root `package.json` becomes a Bun workspace root, and `packages/core` exists with one pure, unit-tested module.
  - Files: `package.json` (root, rewrite), `tsconfig.base.json` (new), `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/tenancy.ts`, `packages/core/src/tenancy.test.ts`; delete root `package-lock.json` (`git rm`); regenerate `bun.lock`.
  - Interfaces:
    - Root `package.json`: `"name": "email-assistant"`, `"private": true`, `"type": "module"`, `"workspaces": ["apps/*", "packages/*"]`. Scripts in this step: `typecheck` = `bun run --filter '*' typecheck`, `test:unit` = `bun test packages/core` (stage 2 adds `apps/server/src`). Keep `lint`, `lint:fix`, `format`. Remove `start`, `build`, `preview`, `astro`, `fmt`, `fmtb` (step 1.2 adds web scripts).
    - `tsconfig.base.json`: `target` `ES2022`, `module` `ESNext`, `moduleResolution` `Bundler`, `strict` `true`, `noUncheckedIndexedAccess` `true`, `skipLibCheck` `true`, `forceConsistentCasingInFileNames` `true`, `esModuleInterop` `true`, `noEmit` `true`, `types: ["bun"]`.
    - `packages/core/package.json`: name `@ea/core`, `private: true`, `type: module`, `exports: { ".": "./src/index.ts" }`, script `typecheck` = `tsc --noEmit`, dependency `zod`.
    - `packages/core/src/tenancy.ts`: `export const membershipRoles = ["owner", "assistant"] as const; export type MembershipRole = (typeof membershipRoles)[number]; export const membershipRoleSchema = z.enum(membershipRoles);`. `index.ts` re-exports it.
    - Root devDependencies: keep the ESLint, husky, lint-staged and `prettier-plugin-astro` entries; add `typescript`, `@types/bun`, `prettier`, `globals`. Step 1.2 moves all Astro / React / Tailwind / shadcn dependencies from the root to `apps/web`.
  - Decisions: Bun workspaces `apps/server`, `apps/web`, `packages/core` (ADR 0002). One lockfile `bun.lock`; no `package-lock.json`. `packages/core` has no I/O, no `process.env`, no imports from `apps/*`. Roles are `owner` / `assistant` (`docs/architecture.md` §5).
  - Test: `packages/core/src/tenancy.test.ts` (`bun:test`): `membershipRoleSchema.parse("owner")` and `"assistant"` pass; `"admin"` and `""` throw.
  - Check: `bun install` then `bun run test:unit` and `bun run typecheck`.
  - Done when: the core test passes; `ls package-lock.json` fails; `bun.lock` is the only lockfile at the root.
  - Out of scope: `apps/server`; `backend/` (it stays untouched until stage 2, outside the workspaces).
- [x] **1.2 Move the Astro starter to `apps/web`**
  - Goal: The Astro starter lives in `apps/web` as workspace `@ea/web`, and it lints, typechecks and builds.
  - Files: `git mv src apps/web/src`, `git mv public apps/web/public`, `git mv astro.config.mjs apps/web/astro.config.mjs`, `git mv components.json apps/web/components.json`, `git mv tsconfig.json apps/web/tsconfig.json`; new `apps/web/package.json`; change `apps/web/tsconfig.json`, `apps/web/src/env.d.ts`, `.vscode/launch.json`, `.vscode/settings.json`, `.gitignore`.
  - Interfaces:
    - `apps/web/package.json`: name `@ea/web`, `private: true`, `type: module`, scripts `dev` = `astro dev`, `build` = `astro build`, `preview` = `astro preview`, `typecheck` = `astro check`. Dependencies: all Astro, React, Radix, Tailwind, `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`, `tw-animate-css`, `@types/react*` from the old root `package.json` (same versions). devDependencies: `@astrojs/check`, `typescript`.
    - Root scripts: `web:dev` = `bun run --filter @ea/web dev`, `web:build` = `bun run --filter @ea/web build`.
    - `apps/web/tsconfig.json`: keep `extends: "astro/tsconfigs/strict"`, `include: [".astro/types.d.ts", "**/*"]`, `exclude: ["dist"]`, `jsx`, `jsxImportSource`, `baseUrl: "."`, `paths: { "@/*": ["./src/*"] }` (paths are now relative to `apps/web`).
    - `apps/web/src/env.d.ts`: remove `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY` (the code does not read them); keep an empty `ImportMetaEnv` interface.
    - `.vscode/launch.json`: command `bun run web:dev`. `.vscode/settings.json`: `eslint.workingDirectories` = `["."]`.
  - Decisions: The Astro starter stays as it is until S5 (no new pages, no stack change). Only paths, the package file and the Supabase env types change.
  - Test: none (no logic). The check is the build.
  - Check: `bun install`, `bun run web:build`, `bun run --filter @ea/web typecheck`.
  - Done when: the web build writes `apps/web/dist/`; `astro check` reports 0 errors; no root `src/`, `public/`, `astro.config.mjs`, `components.json`, `tsconfig.json` remain.
  - Out of scope: changes to pages, components or styles.
- [x] **1.3 Root lint, format, husky, lint-staged**
  - Goal: One root ESLint and Prettier config covers all workspaces, and the pre-commit hook lints only staged files.
  - Files: `eslint.config.js`, `.prettierrc.json`, `.prettierignore` (new), `package.json` (`lint-staged` block), `.husky/pre-commit`.
  - Interfaces:
    - `eslint.config.js`: keep `includeIgnoreFile(.gitignore)`, the base config (`eslint.configs.recommended`, `tseslint.configs.strict`, `tseslint.configs.stylistic`, `no-console: warn`, `no-unused-vars: off`), `eslintPluginPrettier` last. Scope the jsx-a11y, React, React hooks, React compiler and Astro configs to `files: ["apps/web/**/*.{js,jsx,ts,tsx,astro}"]`. Add a block for `files: ["apps/server/**/*.ts", "packages/**/*.ts"]` with `languageOptions.globals = globals.node`, `prefer-const: error`, `@typescript-eslint/no-unused-vars: ["warn", { argsIgnorePattern: "^_" }]`, and the `import/order` rule copied from `backend/eslint.config.js` (plugin `eslint-plugin-import`, resolver `typescript`). Add `ignores: ["backend/**", "**/dist/**", "apps/web/.astro/**"]` (stage 2 removes `backend/**`).
    - `.prettierrc.json`: unchanged, except the `prettier-plugin-astro` plugin still resolves from the root devDependencies.
    - `.prettierignore`: `bun.lock`, `**/dist/`, `apps/web/.astro/`, `backend/` (stage 2 removes this line).
    - `lint-staged`: `"*.{ts,tsx,astro}": ["eslint --fix", "prettier --write"]`, `"*.{json,css,md}": ["prettier --write"]`.
    - `.husky/pre-commit`: `bunx lint-staged`.
  - Decisions: Fix root lint, husky and lint-staged paths: they point to `backend/**` now (task notes). The hook must not format the whole repo.
  - Test: none.
  - Check: `bun run lint` (0 errors); `bunx lint-staged --help` runs.
  - Done when: `bun run lint` passes on `apps/web` and `packages/core`; no config file names `backend` except the two temporary ignore lines.
  - Out of scope: new lint rules beyond the ones listed; fixing old files in `.ai/`, `.cursor/`, `.github/copilot-instructions.md`, `.windsurfrules`.

### Stage 2 — `apps/server` base, config, log; old `backend/` removed
- [x] **2.1 `apps/server` package, env check, logger**
  - Goal: `apps/server` exists with a Zod env check that fails on a missing key and a `log` util with levels and a module prefix.
  - Files: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/platform/config.ts`, `apps/server/src/platform/config.test.ts`, `apps/server/src/platform/log.ts`, `apps/server/src/platform/log.test.ts`; root `package.json` (`test:unit` = `bun test packages/core apps/server/src`).
  - Interfaces:
    - `apps/server/package.json`: name `@ea/server`, `private: true`, `type: module`, script `typecheck` = `tsc --noEmit`; dependencies `zod`, `@ea/core` (`workspace:*`). Later steps add `hono`, `kysely`, `pg`, `@google/genai`, `imapflow`.
    - `apps/server/tsconfig.json`: `extends: "../../tsconfig.base.json"`, `include: ["src/**/*", "test/**/*"]`.
    - `config.ts`: `export const configSchema = z.object({ DATABASE_URL: z.string().url(), PORT: z.coerce.number().int().positive().default(8080), LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info") });` `export type Config = z.infer<typeof configSchema>;` `export class ConfigError extends Error { constructor(readonly keys: string[]) }` `export function loadConfig(env: Record<string, string | undefined> = process.env): Config` — throws `ConfigError` with the names of all missing or bad keys in the message. The message never contains a value.
    - `log.ts`: `export type LogLevel = "debug" | "info" | "warn" | "error"; export function setLogLevel(level: LogLevel): void; export function createLog(module: string): { debug(...args: unknown[]): void; info(...): void; warn(...): void; error(...): void }`. Each line starts with `[${module}]`. `debug`/`info` go to stdout, `warn`/`error` to stderr. Lines below the set level are dropped. Default level `info`. It is the only file with `// eslint-disable-next-line no-console`.
  - Decisions: All config from env, checked with Zod at start; a missing key stops the start (`docs/code-patterns.md`). Bun reads `.env` by itself: no `dotenv`. `utils/log.ts` is kept and extended with levels and a module prefix (`docs/architecture.md` §12): base the new file on `backend/src/utils/log.ts`. Server port default 8080 (Astro dev uses 3000). The server reads only `DATABASE_URL`, `PORT`, `LOG_LEVEL` in S0.
  - Test: `config.test.ts`: a full env passes and gives `PORT` 8080 and `LOG_LEVEL` `info` by default; an env without `DATABASE_URL` throws `ConfigError` with `keys` containing `DATABASE_URL`; `DATABASE_URL: ""` throws; `LOG_LEVEL: "loud"` throws; the error message does not contain a secret value from the input (use a URL with password `s3cret` plus a bad `PORT`, assert the message has no `s3cret`). `log.test.ts`: with `spyOn(console, "log")` / `spyOn(console, "error")`, `createLog("tenancy").info("x")` prints a line that starts with `[tenancy]`; after `setLogLevel("warn")`, `info` prints nothing and `warn` prints to stderr.
  - Check: `bun install`, `bun run test:unit`, `bun run typecheck`, `bun run lint`.
  - Done when: all listed test cases pass.
  - Out of scope: `main.ts`, HTTP, DB (later stages).
- [x] **2.2 Move the Gemini test script; root `.env` and `.env.example`**
  - Goal: `bun run gemini:test` runs from the repo root and reads the key from the root `.env`.
  - Files: `git mv backend/src/scripts/gemini_test.ts apps/server/src/scripts/gemini-check.ts` (then edit it); `apps/server/package.json` (add `@google/genai` `^2.32.0`); root `package.json` (script `gemini:test` = `bun apps/server/src/scripts/gemini-check.ts`); `.env.example` (rewrite); local move `backend/.env` → `.env` (not tracked).
  - Interfaces: The script removes the `dotenv` and `path` imports, uses `createLog("gemini-check")` from `../platform/log`, reads `process.env.GEMINI_API_KEY` and `process.env.GEMINI_MODEL`, and on a missing key logs `Missing GEMINI_API_KEY or GEMINI_MODEL in .env` and exits 1.
  - Decisions:
    - `.env` handling: if the root `.env` does not exist, run `mv backend/.env .env`. If the root `.env` exists, stop and ask the main session. Never print the file. After the move, append the new keys from `.env.example` with placeholder values only if they are missing (the user fills in passwords in stage 3).
    - Root `.env.example` lists only keys that the code reads. After this step: `GEMINI_API_KEY=###`, `GEMINI_MODEL=gemini-3.8-flash` (keep the two comment lines from `backend/.env.example`), `DATABASE_URL`, `PORT=8080`, `LOG_LEVEL=info`. Stage 3 adds `MIGRATOR_DATABASE_URL`, `POSTGRES_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`. Remove `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY`, `IMAP_USER`, `IMAP_PASSWORD`.
    - Dev `DATABASE_URL` example: `postgres://app:change-me-app@127.0.0.1:5433/email_assistant?sslmode=disable`.
  - Test: none (the script calls the real API). Do not run it in CI.
  - Check: `bun run gemini:test` from the repo root. A model reply or a Gemini `503 UNAVAILABLE` both prove the key loads (the 503 is a known alert in `docs/known-alerts.md`). A "Missing GEMINI_API_KEY" message is a FAIL.
  - Done when: the script runs from the root and reaches the Gemini API.
  - Out of scope: `platform/llm.ts` (S1b).
- [x] **2.3 Delete `backend/` and the old dependencies; update the Gemini docs**
  - Goal: The old server code, Supabase files and old dependencies are gone, and the docs name the new Gemini command.
  - Files: `git rm -r backend` (all tracked files); `rm -rf backend` for the untracked rest (`node_modules/`; check with `git status --ignored backend` first that only `node_modules/` and no `.env` is left); `eslint.config.js` and `.prettierignore` (remove the `backend` lines); `tasks/active/gemini-setup.md` (status line, done-when and "Result so far": the command is `bun run gemini:test` from the repo root, script `apps/server/src/scripts/gemini-check.ts`, env in the root `.env`); `docs/roadmap.md` §5 "Setup check" line (new command and path; keep the 503 sentence).
  - Interfaces: none.
  - Decisions: `backend/supabase/` and its migration are removed (ADR 0011). `ImapEmailProvider`, `get_provider.ts`, `OpenAIAdapter`, `SupabaseAdapter`, `test_adapter.ts` and the interfaces are deleted; S1a reads them with `git show 29e9522:<path>`. `openai`, `express`, `helmet`, `cors`, `googleapis`, `@supabase/supabase-js`, `dotenv` must not be in any `package.json`. `imapflow` stays: add `imapflow` `^1.1.1` to `apps/server/package.json` dependencies. `@google/genai` stays (step 2.2).
  - Test: none.
  - Check: `grep -rnE '"(openai|express|helmet|cors|googleapis|@supabase/supabase-js|dotenv)"' --include=package.json . --exclude-dir=node_modules` prints nothing; `ls backend` fails; `find . -name package-lock.json -not -path '*/node_modules/*'` prints nothing; `bun install`, `bun run lint`, `bun run typecheck`, `bun run test:unit` pass.
  - Done when: all checks pass.
  - Out of scope: other docs (stage 7).

### Stage 3 — DB roles, Compose `db`, dbmate runner [risky]
- [x] **3.1 `db/roles.sql`, Compose `db` with init script, dbmate, grants migration**
  - Goal: `bun run db:up` starts an empty Postgres 17 with the roles `migrator` and `app`, and `bun run db:migrate` applies the migrations as `migrator`.
  - Files: `db/roles.sql`, `deploy/compose.yaml`, `deploy/db-init/10-roles.sh` (mode 755), `db/migrations/20261103000001_app_grants.sql`, root `package.json` (devDependency `dbmate`; scripts), `.env.example`, `.gitignore` (add `db/schema.sql` in case dbmate writes it).
  - Interfaces:
    - `db/roles.sql` (run by the superuser with psql variables `migrator_password` and `app_password`):
      ```sql
      \set ON_ERROR_STOP on
      CREATE ROLE migrator LOGIN PASSWORD :'migrator_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      CREATE ROLE app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      GRANT CONNECT ON DATABASE :"DBNAME" TO migrator, app;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE, CREATE ON SCHEMA public TO migrator;
      GRANT USAGE ON SCHEMA public TO app;
      ```
      (`:DBNAME` is the psql built-in variable for the current database.)
    - `deploy/db-init/10-roles.sh`:
      ```sh
      #!/bin/sh
      set -eu
      psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
        -v migrator_password="$MIGRATOR_PASSWORD" -v app_password="$APP_PASSWORD" -f /db/roles.sql
      ```
    - `deploy/compose.yaml`: `name: email-assistant`; one service `db`: `image: postgres:17`; `environment`: `POSTGRES_USER: postgres`, `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?}`, `POSTGRES_DB: email_assistant`, `MIGRATOR_PASSWORD: ${MIGRATOR_PASSWORD:?}`, `APP_PASSWORD: ${APP_PASSWORD:?}`; `ports: ["127.0.0.1:5433:5432"]`; `volumes`: `db-data:/var/lib/postgresql/data`, `../db/roles.sql:/db/roles.sql:ro`, `./db-init:/docker-entrypoint-initdb.d:ro`; `healthcheck`: `pg_isready -U postgres -d email_assistant`, interval 2s, retries 15. Top-level `volumes: { db-data: {} }`.
    - `db/migrations/20261103000001_app_grants.sql` (dbmate format):
      ```sql
      -- migrate:up
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app;
      -- migrate:down
      ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app;
      ```
    - Root scripts: `db:up` = `docker compose -f deploy/compose.yaml --env-file .env up -d --wait db`; `db:down` = `docker compose -f deploy/compose.yaml --env-file .env down`; `db:migrate` = `dbmate -e MIGRATOR_DATABASE_URL --no-dump-schema --wait migrate`; `db:rollback` = `dbmate -e MIGRATOR_DATABASE_URL --no-dump-schema rollback`.
    - `.env.example` adds: `POSTGRES_PASSWORD=change-me-postgres`, `MIGRATOR_PASSWORD=change-me-migrator`, `APP_PASSWORD=change-me-app`, `MIGRATOR_DATABASE_URL=postgres://migrator:change-me-migrator@127.0.0.1:5433/email_assistant?sslmode=disable`. Comment: the passwords in the URLs must match the password keys.
  - Decisions:
    - `migrator` owns the tables and runs the migrations; `app` is the server's role; passwords come from env as psql variables; the superuser runs `db/roles.sql` once: the `db` init script on the Mac, a `psql` step in CI (`docs/architecture.md` §5, ADR 0011).
    - Migrations grant `app` its rights with default privileges for new tables. (`audit_log` gets only INSERT and SELECT in S1b, not now.)
    - `db` has no public port: bind to `127.0.0.1` only (ADR 0011). Host port 5433 because a local Postgres uses 5432 on the dev Mac.
    - Plain SQL files in `db/migrations/` are the source of truth. Never edit an applied migration. Use `migrate`, not `up` (`up` also tries to create the database; `migrator` has no CREATEDB).
    - The Postgres init scripts run only on an empty volume. To start again: `docker compose -f deploy/compose.yaml --env-file .env down -v`.
    - The implementer sets real local passwords in the root `.env` (not the placeholders) and never prints them.
  - Test: manual on an empty volume (write the output in the stage report): `docker compose -f deploy/compose.yaml --env-file .env down -v`, `bun run db:up`, `bun run db:migrate`, then `psql "$MIGRATOR_DATABASE_URL" -c "select current_user"` prints `migrator`; `psql "$DATABASE_URL" -c "select current_user"` prints `app`; `psql "$DATABASE_URL" -c "create table x (id int)"` fails with `permission denied for schema public`; a second `bun run db:migrate` applies nothing and exits 0.
  - Check: the commands above; `bun run lint`, `bun run typecheck`, `bun run test:unit`.
  - Done when: all manual checks give the listed results.
  - Out of scope: tables (stage 4); the `server` Compose service (S1a); backups (S1a).

### Stage 4 — Tenancy tables, Kysely DB layer, role check [risky]
- [x] **4.1 Tenancy migration, `db:types`, `platform/db`, app-role test**
  - Goal: The tenancy tables exist, Kysely types come from the DB, and the server's DB layer refuses any role except `app`.
  - Files: `db/migrations/20261103000002_tenancy.sql`; `apps/server/src/platform/db/schema.ts` (generated, committed); `apps/server/src/platform/db/index.ts`; `apps/server/src/platform/db/tenant-context.ts`; `apps/server/test/integration/helpers.ts`; `apps/server/test/integration/db-role.test.ts`; `apps/server/package.json` (dependencies `kysely`, `pg`; devDependency `@types/pg`); root `package.json` (devDependency `kysely-codegen`; scripts `db:types`, `test:int`); `eslint.config.js` and `.prettierignore` (ignore `apps/server/src/platform/db/schema.ts`).
  - Interfaces:
    - Migration `-- migrate:up`:
      ```sql
      CREATE TABLE organizations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL CHECK (length(name) > 0),
        timezone text NOT NULL,
        data_retention_days integer NOT NULL DEFAULT 30 CHECK (data_retention_days > 0),
        style_text text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL,
        display_name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
      CREATE TABLE memberships (
        org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('owner', 'assistant')),
        digest_times time[] NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (org_id, user_id)
      );
      CREATE INDEX memberships_user_id_idx ON memberships (user_id);
      ```
      `-- migrate:down`: `DROP TABLE memberships; DROP TABLE users; DROP TABLE organizations;`
    - Script `db:types` = `kysely-codegen --dialect postgres --url 'env(MIGRATOR_DATABASE_URL)' --out-file apps/server/src/platform/db/schema.ts --exclude-pattern schema_migrations` [not verified: flag names; check `bunx kysely-codegen --help`]. Script `test:int` = `bun test apps/server/test`.
    - `platform/db/index.ts`: `export type { DB } from "./schema"; export type Db = Kysely<DB>; export function createDb(databaseUrl: string): Db` (Kysely `PostgresDialect` with a `pg` `Pool`, `max: 10`); `export async function checkDb(db: Db): Promise<boolean>` (`select 1`, returns false on error, never throws); `export class DbRoleError extends Error`; `export async function assertAppRole(db: Db): Promise<void>` — runs `select current_user as role, r.rolsuper from pg_roles r where r.rolname = current_user` and throws `DbRoleError` unless `role === "app"` and `rolsuper === false`. Also re-export `TenantContext`.
    - `platform/db/tenant-context.ts`: `export interface TenantContext { readonly orgId: string; readonly userId?: string }`.
    - `test/integration/helpers.ts`: `export function testDb(): Db` (reads `process.env.DATABASE_URL`, throws a clear error if missing); `export class Rollback extends Error`; `export async function withRollback(db: Db, fn: (trx: Transaction<DB>) => Promise<void>): Promise<void>` — runs `fn` in `db.transaction().execute(...)`, then throws `Rollback`, and swallows only `Rollback`.
  - Decisions:
    - Tables and columns from `docs/architecture.md` §5: `organizations` (id, name, timezone, data_retention_days default 30, style_text), `users` (id, email, display_name; login method decided in S5), `memberships` (org_id, user_id, role `owner` / `assistant`, digest_times). Other tables come with their slice. Column names avoid SQL reserved words.
    - `users` has no `org_id`: a user joins organizations through `memberships`. `organizations` and `memberships` carry the tenant key (`id` / `org_id`).
    - `digest_times` type `time[]`, default empty; the times are read in the organization timezone (S2 sets them).
    - Types: Kysely + kysely-codegen; snake_case columns. The generated file is committed so `typecheck` works without a DB. Regenerate it after each migration.
    - The server connects as `app`, never as `migrator` or the superuser (test). Integration tests use `DATABASE_URL` (the `app` role). A normal test runs in a transaction that rolls back (`docs/architecture.md` §9).
  - Test: `db-role.test.ts`: `assertAppRole(testDb())` resolves; `select current_user` is `app`; `assertAppRole` on a Kysely made from `MIGRATOR_DATABASE_URL` rejects with `DbRoleError`; inside `withRollback`, `sql\`create table x (id int)\`.execute(trx)` rejects (no DDL right for `app`); `checkDb(testDb())` is `true`; `checkDb(createDb("postgres://app:wrong@127.0.0.1:1/none"))` is `false`. Close every pool in `afterAll` (`db.destroy()`).
  - Check: `bun run db:migrate`, `bun run db:types`, `git diff --stat` shows `schema.ts`, `bun run test:int`, `bun run lint`, `bun run typecheck`, `bun run test:unit`. Also on an empty volume: `down -v`, `db:up`, `db:migrate` applies both migrations.
  - Done when: all checks pass and `schema.ts` has `organizations`, `users`, `memberships` and no `schema_migrations`.
  - Out of scope: repository functions (stage 5); RLS (S6 option).

### Stage 5 — Tenancy module, `org_id` filter test, `org:create` [risky]
- [ ] **5.1 Tenancy repository + service, isolation test, `org:create` CLI**
  - Goal: The `tenancy` module reads only rows of the caller's organization, and `bun run org:create` creates the pilot organization, user and owner membership.
  - Files: `apps/server/src/modules/tenancy/index.ts`, `repo.ts`, `service.ts`; `apps/server/src/scripts/org-create.ts`; `apps/server/test/integration/tenancy.test.ts`; root `package.json` (script `org:create` = `bun apps/server/src/scripts/org-create.ts`).
  - Interfaces:
    - `repo.ts` (all take `db: Db | Transaction<DB>` first):
      - `getOrganization(db, ctx: TenantContext): Promise<OrganizationRow | undefined>` — `where id = ctx.orgId`.
      - `listMemberships(db, ctx: TenantContext): Promise<MembershipWithUser[]>` — join `users`, `where memberships.org_id = ctx.orgId`.
      - `insertMembership(db, ctx: TenantContext, input: { userId: string; role: MembershipRole }): Promise<void>` — writes `org_id = ctx.orgId`.
      - `insertOrganization(db, input: { name: string; timezone: string }): Promise<{ id: string }>` and `insertUser(db, input: { email: string; displayName: string }): Promise<{ id: string }>` — the only two functions without a `TenantContext`, because they create the tenant and the global user.
    - `service.ts`: `createOrganizationWithOwner(db: Db | Transaction<DB>, input: { orgName: string; timezone: string; email: string; displayName: string }): Promise<{ orgId: string; userId: string }>` — one transaction: insert organization, insert user, insert membership with role `owner`. Validate `input` with Zod first (non-empty name; `email` is an e-mail; `timezone` is valid: `Intl.supportedValuesOf("timeZone").includes(tz)`; throw before any DB write).
    - `index.ts` exports `createOrganizationWithOwner`, `getOrganization`, `listMemberships` and the row types. Other modules import only from `index.ts`.
    - `org-create.ts`: `parseArgs` from `node:util` with options `--org-name` (required), `--email` (required), `--display-name` (required), `--timezone` (default `Europe/Warsaw`). It calls `loadConfig()`, `createDb(config.DATABASE_URL)`, `assertAppRole(db)`, then `createOrganizationWithOwner`, logs `[org-create] created org <orgId> user <userId>` (ids only), destroys the pool, exits 0. On a missing option it prints usage and exits 1. On a duplicate e-mail (Postgres `23505`) it logs `user with this email already exists` and exits 1; the transaction leaves no organization row behind.
  - Decisions: Tenancy belongs to S0. Every repository function takes a `TenantContext` and filters by `org_id`; a test checks each new function for the filter (`docs/code-patterns.md`, ADR 0011). One repository function = one clear query. Use typed Kysely queries, no table names as strings outside Kysely, no generic CRUD wrapper. The CLI runs as the `app` role. No mail data and no secrets in logs.
  - Test: `tenancy.test.ts`, each case in `withRollback`: create org A with owner a@x.test and org B with owner b@x.test through `createOrganizationWithOwner(trx, ...)` (decision: the service takes `db: Db | Transaction<DB>`; when `db.isTransaction` is true it runs the three inserts in that transaction, else it opens `db.transaction()`); `listMemberships(trx, { orgId: A })` returns only a@x.test with role `owner`; `getOrganization(trx, { orgId: B })` returns B and `getOrganization(trx, { orgId: A })` does not return B; `getOrganization` with a random uuid returns `undefined`; a duplicate e-mail with other case (`A@x.test`) rejects and leaves no new organization; an invalid timezone rejects before a write. One extra test (not in a transaction, clean up after): run `bun apps/server/src/scripts/org-create.ts --org-name "Test Org" --email <unique>@x.test --display-name T` with `Bun.spawn`, expect exit 0, then delete the rows it made (as `app`; `ON DELETE CASCADE` removes the membership).
  - Check: `bun run test:int`, `bun run test:unit`, `bun run lint`, `bun run typecheck`; manual `bun run org:create --org-name "Pilot" --email <the user's address> --display-name "<name>"` is done by the user later, not by the implementer.
  - Done when: all test cases pass.
  - Out of scope: login, sessions, chat linking (S2, S5); roles checks beyond storing `owner`.

### Stage 6 — HTTP server and `GET /health`
- [ ] **6.1 Hono app with `GET /health`**
  - Goal: `GET /health` returns 200 with the DB status when the DB answers, and 503 when it does not.
  - Files: `apps/server/src/platform/http.ts`, `apps/server/src/platform/http.test.ts`, `apps/server/test/integration/health.test.ts`; `apps/server/package.json` (dependency `hono`).
  - Interfaces: `export function createApp(deps: { checkDb: () => Promise<boolean> }): Hono`. `GET /health` → DB up: status 200, JSON `{ "status": "ok", "db": "up" }`; DB down: status 503, JSON `{ "status": "error", "db": "down" }`. An error handler (`app.onError`) logs `[http]` with the error message and returns 500 `{ "error": "internal" }`. Unknown routes: Hono default 404.
  - Decisions: HTTP framework Hono (ADR 0002). `/health` shows DB reachable; "last good sync per mailbox" comes with mailboxes in S1a (`docs/architecture.md` §8). No auth on `/health`; it returns no data except these fields.
  - Test: `http.test.ts` (unit, no DB): `createApp({ checkDb: async () => true }).request("/health")` → 200 and the JSON above; with `false` → 503 and `db: "down"`. `health.test.ts` (integration): `createApp({ checkDb: () => checkDb(testDb()) })` → 200, `db: "up"`.
  - Check: `bun run test:unit`, `bun run test:int`, `bun run lint`, `bun run typecheck`.
  - Done when: all tests pass.
  - Out of scope: other routes; sessions (S5).
- [ ] **6.2 `main.ts` start-up and env-check start test**
  - Goal: `bun run dev` starts the server, and a missing env key stops the start with exit code 1.
  - Files: `apps/server/src/main.ts`, `apps/server/src/main.test.ts`; root `package.json` (scripts `dev` = `bun --watch apps/server/src/main.ts`, `start` = `bun apps/server/src/main.ts`).
  - Interfaces: `main.ts` order: `loadConfig()` (on `ConfigError`: log `[main] config error: missing or bad keys: <keys>` and `process.exit(1)`) → `setLogLevel(config.LOG_LEVEL)` → `createDb(config.DATABASE_URL)` → `await assertAppRole(db)` (on error: log and exit 1) → `createApp({ checkDb: () => checkDb(db) })` → `Bun.serve({ port: config.PORT, fetch: app.fetch })` → log `[main] listening on port <port>`. On `SIGTERM` / `SIGINT`: stop the server, `await db.destroy()`, exit 0.
  - Decisions: The env check stops the start on a missing key (test). The server connects as `app`; it refuses to start as `migrator` or a superuser. The server runs on the Mac with `bun --watch`, only `db` runs in a container (`docs/architecture.md` §9–10).
  - Test: `main.test.ts` (unit, no DB): `Bun.spawn(["bun", <absolute path of main.ts>], { cwd: os.tmpdir(), env: { PATH: process.env.PATH ?? "", DATABASE_URL: "" }, stderr: "pipe" })` — the `cwd` outside the repo stops Bun from loading the root `.env`; expect exit code 1 and stderr containing `DATABASE_URL`.
  - Check: `bun run test:unit`; manual with the `db` running: `bun run dev`, then `curl -i http://127.0.0.1:8080/health` → `HTTP/1.1 200` and `{"status":"ok","db":"up"}`; stop the `db` container (`docker compose -f deploy/compose.yaml --env-file .env stop db`) and `curl` again → 503; start it again. Manual: set `DATABASE_URL` to the migrator URL for one run → the server exits 1 with a role error.
  - Done when: the test passes and the manual checks give the listed results (write them in the stage report).
  - Out of scope: scheduler, workers, Telegram (later slices).

### Stage 7 — CI, README, docs
- [ ] **7.1 GitHub Actions CI**
  - Goal: CI runs lint, typecheck, unit tests, migrations, integration tests and the web build on every push and pull request to `master`.
  - Files: `.github/workflows/ci.yml`.
  - Interfaces: one job `ci` on `ubuntu-latest`. `services.postgres`: `image: postgres:17`, env `POSTGRES_USER: postgres`, `POSTGRES_PASSWORD: postgres`, `POSTGRES_DB: email_assistant`, `ports: ["5432:5432"]`, health options `--health-cmd pg_isready --health-interval 2s --health-timeout 5s --health-retries 15`. Job env: `DATABASE_URL: postgres://app:app_ci@localhost:5432/email_assistant?sslmode=disable`, `MIGRATOR_DATABASE_URL: postgres://migrator:migrator_ci@localhost:5432/email_assistant?sslmode=disable`. Steps: `actions/checkout@v4`; `oven-sh/setup-bun@v2` with `bun-version: 1.3.14`; `bun install --frozen-lockfile`; `bun run lint`; `bun run typecheck`; `bun run test:unit`; roles: `psql "postgresql://postgres:postgres@localhost:5432/email_assistant" -v ON_ERROR_STOP=1 -v migrator_password=migrator_ci -v app_password=app_ci -f db/roles.sql`; `bun run db:migrate`; `bun run test:int`; `bun run web:build`.
  - Decisions: CI = GitHub Actions; integration tests against Postgres in a service container; service containers cannot mount repo files, so a `psql` step runs `db/roles.sql` (task done-when, `docs/architecture.md` §5, §9). The CI passwords are throw-away test values for a container that lives only for the job; they are not secrets. CI does not run `gemini:test` (no key in CI).
  - Test: the workflow itself.
  - Check: optional, if Docker is up: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest`. The real check is the green run after the main session pushes: `gh run list --limit 1` and `gh run view <id>`.
  - Done when: the CI run on `master` is green.
  - Out of scope: deploy jobs, eval jobs, mail-server container (S1a/S1b).
- [ ] **7.2 README for Bun**
  - Goal: The README tells a new developer how to install, start the `db`, migrate and run the server with Bun.
  - Files: `README.md`.
  - Decisions: README says Bun, not npm. Remove the old stack lines that are not true now (Supabase, OpenAI, Gmail API, WhatsApp, Langfuse, Vitest, Node/npm). Content: one paragraph about the product (link `docs/product-brief.md`); stack (Bun workspaces, Hono, Postgres 17 with dbmate and Kysely, Gemini, Astro starter until S5; link `docs/architecture.md`); setup: `bun install`, `cp .env.example .env` and fill in the passwords, `bun run db:up`, `bun run db:migrate`, `bun run org:create --org-name … --email … --display-name …`, `bun run dev`, `curl http://127.0.0.1:8080/health`; scripts table (`dev`, `start`, `lint`, `typecheck`, `test:unit`, `test:int`, `db:up`, `db:down`, `db:migrate`, `db:rollback`, `db:types`, `org:create`, `gemini:test`, `web:dev`, `web:build`); reset of the dev DB (`down -v`); note that Compose `db` uses host port 5433. Language: see Question 1.
  - Test: none.
  - Check: `grep -niE 'npm|supabase|openai' README.md` prints nothing.
  - Done when: the check passes and every command in the README exists in `package.json`.
  - Out of scope: other docs.
- [ ] **7.3 Docs match the new layout**
  - Goal: `docs/` describe what S0 built.
  - Files: `docs/code-patterns.md`, `docs/modules.md` §3.0, `docs/architecture.md` §3 and §9 (only the lines below), `docs/decisions/0011-self-hosted-postgres.md` (one dated line).
  - Decisions — write exactly these facts:
    - `docs/code-patterns.md`: package names `@ea/server`, `@ea/web`, `@ea/core`; integration tests in `apps/server/test/integration/` (unit tests stay next to the code); `bun run test:unit` / `bun run test:int`; generated DB types in `apps/server/src/platform/db/schema.ts` — never edit by hand, run `bun run db:types` after each migration; migrations are dbmate files `db/migrations/YYYYMMDDHHMMSS_<name>.sql` with `-- migrate:up` / `-- migrate:down`, run as `migrator` via `bun run db:migrate`; snake_case columns in TypeScript; `platform/config.ts`, `platform/log.ts`, `platform/http.ts`, `platform/db/` are the real paths; `insertOrganization` / `insertUser` are the only repository functions without a `TenantContext`.
    - `docs/modules.md` §3.0 `db` row: "runner chosen in S0 (for example `dbmate`)" → "`dbmate` (chosen in S0)".
    - `docs/architecture.md` §3: add `db/roles.sql` and `deploy/db-init/` to the tree; §9: integration tests live in `apps/server/test/integration/`. No other changes.
    - ADR 0011: add `- 2026-11-03: S0 picked dbmate as the migration runner (user decision 2026-11-02).` under Consequences. Do not change the status.
  - Test: none.
  - Check: `grep -rn "for example \`dbmate\`" docs` prints nothing; `bun run lint` passes (Prettier on Markdown).
  - Done when: the checks pass and the reviewer finds no doc line that contradicts the code.
  - Out of scope: roadmap rows, other ADRs, `.ai/`, `.cursor/`, `.github/copilot-instructions.md`, `.windsurfrules`.

## Questions for the user
1. README language. Options: (a) a short English README that links to `docs/`; (b) keep Polish and change only the stack and setup parts. Recommendation: (a), because all docs and agent files are in English. Step 7.2 follows your answer.
   - Answer (2026-11-03): (a). The main session took the recommendation because the user said to run without a stop; the user can change it before stage 7.

## Not verified
- Kysely exposes `isTransaction` on `Kysely` / `Transaction` (step 5.1).
- `kysely-codegen` flag names `--dialect`, `--url 'env(VAR)'`, `--out-file`, `--exclude-pattern` (step 4.1). Check with `bunx kysely-codegen --help`.
- `bun run --filter '*' <script>` runs the script in every workspace that has it (steps 1.1, 1.2).
- Bun does not override an env var that the parent process sets explicitly (also an empty string) with a `.env` value, and Bun loads `.env` only from the current folder (step 6.2 test).
- `bun test` loads the root `.env` when run from the repo root (integration tests on the Mac).
- `pg` accepts `?sslmode=disable` in the connection string (dbmate needs it for a container without TLS).
- `docker compose up --wait` is supported by the installed Compose version (step 3.1); without it, use `dbmate --wait` only.
- `psql` is on the `ubuntu-latest` GitHub runner (step 7.1); if not, add `sudo apt-get install -y postgresql-client`.
- `astro build` / `astro check` run under the Bun workspace with the hoisted `node_modules`, and the Node on the runner is new enough for Astro 5 (step 1.2, 7.1).
- The npm package `dbmate` installs its platform binary under Bun without a `trustedDependencies` entry (step 3.1). If `bunx dbmate --version` fails, add `"trustedDependencies": ["dbmate"]` to the root `package.json`.
- Confirmed (https://github.com/amacneil/dbmate, `main.go`): `-e/--env` names the env var with the URL, `--no-dump-schema`, `--wait`, default migrations folder `./db/migrations`, global options come before the command.

## Done-checklist
- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log
- 2026-11-02: Created from `docs/roadmap.md` and `docs/architecture.md` §11.
- 2026-11-02: Changed after the cold review (`tasks/done/mvp-plan-review.md`) and the user's answers (IMAP, home VPS, own Postgres).
- 2026-11-03: Planner wrote the plan (7 stages; 3, 4, 5 are `[risky]`). README = English (Question 1, option a).
- 2026-11-03: Stage 1 (workspaces, `packages/core`, `apps/web`, root lint) built and reviewed: PASS. Checks: `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test:unit` (2 pass), `bun run web:build` — all pass. Deviations accepted: React/a11y lint only on `{js,jsx,ts,tsx}` (not `.astro`); `no-empty-object-type` off for `apps/web/src/env.d.ts`.
- 2026-11-03: Stage 2 (`apps/server` config + log, Gemini script, `backend/` removed) built and reviewed: FAIL, then PASS in round 2. Fix: the script is now `apps/server/src/scripts/gemini-check.ts`, because Bun's test patterns match `*_test.ts` and `test:unit` sent a real Gemini call. Checks: `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test:unit` (10 pass, 3 files) — all pass. Root `.env` moved from `backend/.env` (untracked). Kept `z.string().url()` as planned.
- 2026-11-03: Stage 3 (DB roles, Compose `db` on 5433, dbmate 2.37.0, grants migration) built and reviewed: PASS. Checks on an empty volume: `db:up` healthy; `db:migrate` applied `20261103000001_app_grants.sql`; `current_user` = `migrator` / `app`; `app` `create table` → `permission denied for schema public`; second `db:migrate` exit 0; `db:rollback` + `db:migrate` work. `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run test:unit` (10 pass) — all pass. Real local passwords set in the root `.env`. Accepted: healthcheck in CMD array form; PUBLIC keeps CONNECT on the DB (as planned).
- 2026-11-03: Stage 4 (tenancy migration, `db:types` with kysely-codegen 0.20, `platform/db`, app-role test) built and reviewed: PASS. Checks: empty volume `db:up` + `db:migrate` applied both migrations; `db:types` → 3 tables, no `schema_migrations`; `bun run test:int` (6 pass), `bun run test:unit` (10 pass), `bun run lint`, `bun run typecheck`, `bun install --frozen-lockfile` — all pass. Confirmed: kysely-codegen flags; `pg` returns `time[]` as `string[]`. `dotenv` is only a transitive dependency of kysely-codegen (in `bun.lock`, not in any `package.json`).
