> **Status 2026-11-07 — in progress.** Plan written (5 stages), Opus plan review PASS (round 2); left: build of stages 1–5, merge.

Git mode: worktree (`../email_assistant-wt/fake-telegram-followups`, branch `task/fake-telegram-followups`).

# Fake Telegram: follow-ups

Scope: test tooling. Needs: the fake Telegram task merged into `master`.

## Goal

Close the small gaps that the fake Telegram build found and did not fix.

## Ideas

- **Image build in CI.** CI (`.github/workflows/ci.yml`) does not build `deploy/Dockerfile`. A missing `COPY` of a workspace `package.json` breaks `bun install --frozen-lockfile` only on the VPS. Add a CI step `docker build -f deploy/Dockerfile .` and a check that `/app/tools` holds only `fake-telegram/package.json`. The 1.1 image check of the fake Telegram task was not run: the Docker daemon refuses the agent shell user.
- **Format `docs/architecture.md`.** The file is not prettier-clean at `HEAD` (about 200 lines differ, only table separators). Format it in one commit when no parallel task edits it. Then add the `TELEGRAM_API_ROOT` line (dev only, loopback host only, used by `tools/fake-telegram`) near D8 in § 6.
- **Own DB per worktree.** The fake Telegram live run and its `test:int` run used their own databases on the dev Postgres (steps in `tools/fake-telegram/README.md` § "Live run without the shared dev DB"). A script `bun run db:worktree <name>` (create, grants, migrate, print the env overrides; `--drop`) would remove the shared-DB rule for parallel tasks. See `notes/2026-11-07-parallel-agents-worktrees.md`.
- **Declare the test dependencies.** `tools/fake-telegram/test/setup.ts` imports `@ea/core` and `kysely`, but `tools/fake-telegram/package.json` does not declare them (they resolve through workspace hoisting). Add them to `devDependencies`; this changes `bun.lock`, so do it when no other task changes the lock file.
- **CLI `--chat` with negative ids.** `fake-tg` refuses `--chat -100…`. Allow it if the fake gets group chats.

## Done when

- Each idea is done or dropped, with the reason in the log.

## Plan

### Input: user decisions (2026-11-07)

- All 5 ideas are in scope. The user said: run the whole plan without asking; use the main session's proposals when not sure. Stop only for a risky decision.
- Order: plan → plan review by the `reviewer` subagent with Opus (`claude-bridge/claude-opus-5-5`, thinking high; read-only) → build. Stage reviews use the agent default model.
- Priorities: 1 = image build in CI, 2 = own DB per worktree, 3–5 = the small items.

### Facts (main session, 2026-11-07)

- `origin/master` = `d1cc845` at the start. S4 (`tasks/active/s4-drafts-approvals-delegation.md`) runs on `master` in pipeline mode. Its stage 20 edited `docs/architecture.md` § 6.3 (line ~559: "The result waits for the user's decision"). Its other open stages (19, 22, 23) do not plan edits of `docs/architecture.md` or `bun.lock`. Check the S4 status line again before stages 3, 4 and 5.
- S4 uses the database `email_assistant_s19` on the dev Postgres now. Stage 2 must never reuse or drop it (see the `db:worktree` marker in 2.1).
- Docker is not reachable for the agent user. CI is the only proof of stage 1: push the branch and open a PR to `master` (CI runs on `pull_request` to `master`).
- Push works over SSH (verified with `git push --dry-run`): `GIT_SSH_COMMAND="ssh -i ~/.ssh/github -o IdentitiesOnly=yes -o BatchMode=yes" git push -u origin task/fake-telegram-followups`. SSH push needs no `gh` `workflow` scope for the change of `.github/workflows/ci.yml`.
- `docs/architecture.md` is not prettier-clean at `d1cc845` (`npx prettier --check` warns).
- No git hook is installed (`.husky/pre-commit` exists, but `core.hooksPath` is not set and `.git/hooks` has no `pre-commit`). So lint-staged never runs at commit. Each step runs `prettier --check` explicitly. Do not run `husky` or install hooks.
- Bun versions: local Bun 1.4.4, CI Bun 1.3.14. A `bun install` with the local Bun can change the `bun.lock` format (see 3.1).

### Stage 1 — Image build in CI [risky]

- [ ] **1.1 CI job that builds `deploy/Dockerfile` and checks `/app/tools`.** A separate job (no DB services) in `.github/workflows/ci.yml`: `docker build -f deploy/Dockerfile .`, then a check in the built image that `/app/tools` holds only `fake-telegram/package.json`. Proof: the job is green on the PR of the task branch.
  - Goal: CI fails when `deploy/Dockerfile` does not build, or when the image holds more of `tools/` than `tools/fake-telegram/package.json`.
  - Files: `.github/workflows/ci.yml` (change). Nothing else.
  - Interfaces: a new job `image` under `jobs:`, next to the job `ci`. It has `runs-on: ubuntu-latest`, `timeout-minutes: 20`, no `services:`, no `needs:` (it runs in parallel with `ci`). Steps:
    1. `- uses: actions/checkout@v4`
    2. `- name: Build the server image` / `run: docker build -f deploy/Dockerfile -t ea-server:ci .`
    3. `- name: Check that the image holds only the package.json of the test tools` with a `run: |` block:
       ```sh
       files="$(docker run --rm --entrypoint find ea-server:ci /app/tools -not -path '*/node_modules/*' -not -name node_modules -type f | sort)"
       echo "$files"
       test "$files" = "/app/tools/fake-telegram/package.json"
       ```
  - Decisions:
    - The job is separate from `ci` and has no DB or GreenMail services (plan, stage 1).
    - `timeout-minutes: 20` on the job `image`, so a hung build does not block the runner for the default 6 hours.
    - The workflow triggers stay as they are (`push` to `master`, `pull_request` to `master`). Keep `permissions: contents: read`.
    - The check lists files only (`-type f`) and ignores `node_modules` folders: `bun install` can create a `node_modules` folder in a workspace. Today `bun.lock` has `"configVersion": 0` (hoisted install), so no such folder is expected; the filter only keeps the check stable.
    - `--entrypoint find` replaces the image entrypoint, so the check does not depend on the `oven/bun` entrypoint script.
    - No build cache, no push of the image, no registry login. The image tag `ea-server:ci` exists only on the runner.
    - Do not change `deploy/Dockerfile` or `.dockerignore`. If the build fails in CI, report the error to the main session; do not "fix" the Dockerfile in this step.
    - Docker is not reachable for the agent user on the dev machine (`docker info` → permission denied). The only proof is CI: the main session pushes the branch over SSH (`GIT_SSH_COMMAND="ssh -i ~/.ssh/github -o IdentitiesOnly=yes -o BatchMode=yes" git push -u origin task/fake-telegram-followups`) and opens a PR to `master` (`gh pr create --base master`). The job `image` must be green on that PR.
    - The CI result exists only after the push. So the stage 1 commit cannot hold the PR number and the run URL. After CI is green, a follow-up commit of the task file only records them in the log (Git mode note: a task-file-only commit on the branch).
  - Test: no unit test (YAML only). A negative proof is optional: the main session can check the step logic locally with a fake list, for example `files="/app/tools/fake-telegram/package.json"; test "$files" = "/app/tools/fake-telegram/package.json" && echo ok`.
  - Check: `npx --no-install prettier --check .github/workflows/ci.yml` (exit 0); `bun run lint` (exit 0). Then, after the push and the PR: `gh pr checks <pr>` shows `image` = pass (and `ci` = pass). Record the PR number and the run URL in the log (follow-up commit, see Decisions).
  - Done when: the PR of the task branch shows the job `image` green, and its log prints exactly `/app/tools/fake-telegram/package.json` for the check step.
  - Out of scope: changes to the job `ci`, to the Dockerfile, to the compose files or to the deploy docs; image push; a matrix or caching.

### Stage 2 — Own DB per worktree [risky]

- [ ] **2.1 Script `bun run db:worktree <name>` (create, grants, migrate, print the env overrides; `--drop`).** Database `email_assistant_<name>`, grants as in `db/roles.sql` / `tools/fake-telegram/README.md` § "Live run without the shared dev DB", admin access as `postgres` with `POSTGRES_PASSWORD` from `.env`. Name check (safe identifier only). Never touches `email_assistant` itself. [risky]
  - Goal: one command creates (or drops) an own database on the dev Postgres for a worktree, with the grants and the migrations, and prints the two env overrides.
  - Files:
    - `apps/server/src/scripts/db-worktree-args.ts` (new): pure functions, no I/O. Same pattern as `apps/server/src/scripts/job-run-args.ts`.
    - `apps/server/src/scripts/db-worktree-args.test.ts` (new): unit tests (picked up by `bun run test:unit`, path `apps/server/src`).
    - `apps/server/src/scripts/db-worktree.ts` (new): the script (I/O).
    - `package.json` (root, change): add `"db:worktree": "bun apps/server/src/scripts/db-worktree.ts"` next to the other `db:*` scripts.
    - Only if the fallback (b) of Questions 2 is ever used: `.gitignore` (change: add the env file name). With (a) (the current decision), do not touch `.gitignore`.
  - Interfaces (`db-worktree-args.ts`):

    ```ts
    export const usage: string; // lines: "usage: bun run db:worktree <name> [--drop]", the name rule, exit codes
    export interface DbWorktreeArgs {
      name: string;
      drop: boolean;
    }
    // null on any bad argument (unknown flag, no name, two names, bad name); the script prints the usage.
    export function parseDbWorktreeArgs(argv: string[]): DbWorktreeArgs | null;
    // "fake-telegram-followups" -> "email_assistant_fake_telegram_followups"; null if the name is not safe.
    export function worktreeDatabaseName(name: string): string | null;
    // Same URL with another database (URL pathname), user, password and query unchanged.
    export function withDatabase(url: string, database: string): string;
    // Admin URL: host and port of `url`, user "postgres", the given password, database "postgres", query unchanged.
    // Sets the password as encodeURIComponent(password) (a plain `url.password = pw` loses "%").
    export function adminUrl(url: string, password: string): string;
    export function isLoopbackHost(url: string): boolean; // hostname is 127.0.0.1, localhost or [::1]
    // true only if both URLs have the same host and port (`new URL(a).host === new URL(b).host`).
    export function sameServer(a: string, b: string): boolean;
    // The mark that the script puts on each database that it creates.
    export const worktreeDbComment = "db:worktree";
    // true only if the database comment is exactly worktreeDbComment (null, "", other text → false).
    export function hasWorktreeMark(comment: string | null): boolean;
    ```

    - `parseDbWorktreeArgs` uses `parseArgs` from `node:util` with `options: { drop: { type: "boolean" } }`, `allowPositionals: true`, `strict: true`, in a `try`/`catch` that returns `null` (as `parseJobRunArgs`). Exactly one positional.

  - Interfaces (`db-worktree.ts`):
    - Reads `process.env.MIGRATOR_DATABASE_URL`, `process.env.DATABASE_URL`, `process.env.POSTGRES_PASSWORD` (Bun loads `.env` of the current folder). Check them with a small Zod object (`z.string().min(1)` each) in the script. Do not call `loadConfig()`: it needs keys that this script does not use.
    - Uses `Client` from `pg` (already a dependency of `@ea/server`; `apps/server/src/platform/db/index.ts` imports `Pool` from `pg`). One client per connection; always `await client.end()` in `finally`.
    - Logs status lines with `createLog("db-worktree")` from `../platform/log`. Prints the env override lines with `process.stdout.write(`${line}\n`)` (copy-paste output, not log lines).
    - Exit codes: 0 = done; 1 = failure (DB error, migrate failed, guard refused); 2 = usage error (`parseDbWorktreeArgs` returned `null`, or env check failed). Print the usage for code 2.
  - Decisions:
    - Name rule: `^[a-z0-9][a-z0-9_-]*$`; `-` becomes `_`; the database name is `email_assistant_<name>`; the full name is at most 63 bytes (Postgres identifier limit), else `null`. Upper case, spaces, quotes, dots and other characters are refused (no SQL injection: identifiers cannot be bound as parameters, so the name check is the guard). The SQL quotes the identifier with `"…"` too.
    - The base database is the pathname of `DATABASE_URL` (today `email_assistant`). Refuse (exit 1) if the target name equals the base name or the pathname of `MIGRATOR_DATABASE_URL`. With the prefix rule the target can never be `email_assistant`, `postgres`, `template0` or `template1`; keep the explicit check anyway.
    - Loopback guard (main session decision, Questions 1 = (a)): refuse (exit 1) unless the hosts of both `DATABASE_URL` and `MIGRATOR_DATABASE_URL` are loopback (`127.0.0.1`, `localhost`, `[::1]`), and `sameServer(DATABASE_URL, MIGRATOR_DATABASE_URL)` is true (same host and port). The dev Compose Postgres listens on `127.0.0.1:5433`. Reason: the script runs as superuser `postgres`; it must never reach the VPS DB, and the printed lines must point at the server that the script changed.
    - Admin access: user `postgres`, password `POSTGRES_PASSWORD`, host and port of `MIGRATOR_DATABASE_URL`, maintenance database `postgres`.
    - Worktree mark: each database that the script creates gets the comment `db:worktree`. The script reuses or drops only a database with this mark. Reason: other databases with the same prefix exist (for example `email_assistant_s19`, used by S4 now) and must stay untouched. The mark lookup: `SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1`.
    - Create flow (no `--drop`):
      1. As admin on `postgres`: run the mark lookup.
         - No row: `CREATE DATABASE "<db>"`, then at once `COMMENT ON DATABASE "<db>" IS 'db:worktree'`. If `CREATE DATABASE` fails with SQLSTATE `42P04` (a parallel run created it), treat it as "exists": run the mark lookup again and go on as below. If the script crashes between `CREATE DATABASE` and `COMMENT ON DATABASE` (a transaction cannot hold `CREATE DATABASE`), the database stays unmarked and the script refuses it: drop it by hand as `postgres` (README step 1 says this).
         - Row exists and `hasWorktreeMark(comment)`: log `database <db> exists, reusing it` and go on (resume after a crash; the next steps are idempotent).
         - Row exists without the mark: log `database <db> exists but db:worktree did not create it: refusing` and exit 1. Do not grant, migrate or print anything.
      2. As admin on `postgres`: `GRANT CONNECT ON DATABASE "<db>" TO migrator, app`.
      3. As admin on `<db>` (connect with `withDatabase(adminUrl(MIGRATOR_DATABASE_URL, POSTGRES_PASSWORD), db)`): `REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE, CREATE ON SCHEMA public TO migrator; GRANT USAGE ON SCHEMA public TO app;`. These are the grants of `db/roles.sql` without the `CREATE ROLE` lines: the roles `migrator` and `app` belong to the cluster and exist already. Table grants for `app` come from the migration `db/migrations/20261103000001_app_grants.sql` (`ALTER DEFAULT PRIVILEGES … TO app`).
      4. Migrate: `Bun.spawn(["bun", "run", "db:migrate"], { env: { ...process.env, MIGRATOR_DATABASE_URL: withDatabase(MIGRATOR_DATABASE_URL, db) }, stdout: "inherit", stderr: "inherit" })`; await `exited`; a non-zero code → exit 1. Process env wins over `.env` (the 2026-11-07 live run used this).
      5. Print two lines: `DATABASE_URL=<withDatabase(DATABASE_URL, db)>` and `MIGRATOR_DATABASE_URL=<withDatabase(MIGRATOR_DATABASE_URL, db)>`. These contain the dev role passwords from `.env` (main session decision, Questions 2 = (a): print the full lines to stdout, not through `log`). Never log the admin URL or `POSTGRES_PASSWORD`.
    - Drop flow (`--drop`), as admin on `postgres`:
      1. Run the mark lookup first (`DROP DATABASE IF EXISTS` gives only a NOTICE, so the script cannot tell "dropped" from "not there" without it).
      2. No row: log `no database <db>` and exit 0.
      3. Row without the mark: log `database <db> exists but db:worktree did not create it: refusing` and exit 1.
      4. Row with the mark: `DROP DATABASE "<db>"` (without `IF EXISTS`, without `WITH (FORCE)`). If Postgres says the database is in use (SQLSTATE `55006`), log `database <db> is in use: stop the server and the tests that use it` and exit 1. If it says the database does not exist (SQLSTATE `3D000`, a parallel drop), log `no database <db>` and exit 0. Else log `dropped <db>` and exit 0.
    - Error output: log errors with `describeError` from `platform/errors` (it prints only the error name and the SQLSTATE code, never the message or the connection string; verified). Never log the full `pg` error object.
    - The script never connects to the base database and never runs `DROP` on any name other than the checked, marked target.
  - Test (write first, `db-worktree-args.test.ts`):
    - `parseDbWorktreeArgs`: `["abc"]` → `{ name: "abc", drop: false }`; `["abc", "--drop"]` → `drop: true`; `[]`, `["a", "b"]`, `["abc", "--force"]`, `["--drop"]` → `null`.
    - `worktreeDatabaseName`: `"fake-telegram-followups"` → `"email_assistant_fake_telegram_followups"`; `"s4_x1"` → `"email_assistant_s4_x1"`; `""`, `"-a"`, `"_a"`, `"Abc"`, `"a b"`, `"a;drop"`, `"a\"b"`, `"a.b"` → `null`; a name that makes the full name 64 bytes → `null`, 63 bytes → ok.
    - `withDatabase("postgres://app:pw@127.0.0.1:5433/email_assistant?sslmode=disable", "email_assistant_x")` → `"postgres://app:pw@127.0.0.1:5433/email_assistant_x?sslmode=disable"`.
    - `adminUrl` of the same URL with password `"p@ss/w%41#"`: parse the result with `new URL`; user is `postgres`, `decodeURIComponent(new URL(result).password)` is `"p@ss/w%41#"`, the pathname is `/postgres`, host is `127.0.0.1:5433`, the search is `?sslmode=disable`.
    - `isLoopbackHost`: true for `127.0.0.1`, `localhost`, `[::1]`; false for `db`, `10.0.0.5`, `example.com`.
    - `sameServer`: true for two URLs on `127.0.0.1:5433` with different users and databases; false for `127.0.0.1:5433` vs `127.0.0.1:5432`; false for `127.0.0.1:5433` vs `localhost:5433`.
    - `hasWorktreeMark`: true for `"db:worktree"`; false for `null`, `""`, `"other"`, `"db:worktree "`.
  - Check:
    - `bun test apps/server/src/scripts/db-worktree-args.test.ts` (all pass); `bun run test:unit` (0 fail); `bun run typecheck` (exit 0); `bun run lint` (exit 0).
    - Live run (main session, needs the dev Postgres on `127.0.0.1:5433`; nobody else may use the name):
      1. `bun run db:worktree plancheck` → dbmate prints `Applied: …` lines, then the two env lines.
      2. Again `bun run db:worktree plancheck` → `exists, reusing it`, dbmate applies nothing, exit 0.
      3. `psql "<printed DATABASE_URL>" -c 'select count(*) from organizations'` works as `app`. `psql "<printed MIGRATOR_DATABASE_URL>" -c 'select count(*) from schema_migrations'` works as `migrator`. (The `app` role cannot read `schema_migrations`: SQLSTATE `42501`, verified.)
      4. Mark guard: as `postgres`, `CREATE DATABASE email_assistant_nomark` (no comment). Then `bun run db:worktree nomark` → exit 1 with `refusing`, and `bun run db:worktree nomark --drop` → exit 1 with `refusing`. Then drop it by hand as `postgres` (`DROP DATABASE email_assistant_nomark`). Never use `s19` or another existing name for this check.
      5. `bun run db:worktree plancheck --drop` → `dropped email_assistant_plancheck`; again → `no database email_assistant_plancheck`, exit 0.
      6. `bun run db:worktree Bad.Name` → exit 2.
      7. Record the outputs in the log (without the passwords).
  - Done when: the unit tests pass, and the live run shows create → migrate → reuse → mark refusal → drop with the exit codes above, and `email_assistant` and `email_assistant_s19` are untouched (`psql` as `postgres`: `\l` still lists both).
  - Out of scope: a port offset, `.env` copy, `bun install` or GreenMail users per worktree (the note proposes them; this task does only the DB); changes to `db/roles.sql`, `deploy/db-init/` or the CI workflow; an integration test in `test:int` (it would create databases on the shared dev Postgres).

- [ ] **2.2 Docs.** `tools/fake-telegram/README.md` step 1, 2 and 9 use the script; `tasks/README.md` § "Git mode" (shared runtime line) and `notes/2026-11-07-parallel-agents-worktrees.md` name it.
  - Goal: the docs tell the next agent to use `bun run db:worktree` instead of the manual SQL.
  - Files: `tools/fake-telegram/README.md`, `tasks/README.md`, `notes/2026-11-07-parallel-agents-worktrees.md` (changes only).
  - Interfaces: none (docs).
  - Decisions:
    - `tools/fake-telegram/README.md` § "Live run without the shared dev DB":
      - Step 1 becomes: run `bun run db:worktree <name>`. It creates `email_assistant_<name>` as `postgres` (password `POSTGRES_PASSWORD` from `.env`), marks it with the comment `db:worktree`, gives the grants of `db/roles.sql`, runs `db:migrate` and prints `DATABASE_URL=…` and `MIGRATOR_DATABASE_URL=…`. It refuses a database that it did not create. Keep the SQL block as a fallback under a short line "Manual steps (what the script does):".
      - Step 2 becomes: "The script ran the migrations. After a new migration, run `bun run db:worktree <name>` again (it reuses the database)."
      - Step 3: "`DATABASE_URL` and `MIGRATOR_DATABASE_URL`: the two lines that the script printed".
      - Step 9: replace `DROP DATABASE email_assistant_<name>;` with `bun run db:worktree <name> --drop` (it fails while a server or a test still uses the database).
      - Name rule in one line: lower-case letters, digits, `_` and `-` (`-` becomes `_`).
    - `tasks/README.md` § "Git mode", bullet "Both modes" (the shared runtime line): add one sentence: "For an own database, run `bun run db:worktree <name>` and use the two printed env lines; drop it with `--drop` at the end." Keep the rest of the bullet: GreenMail and the ports stay shared, and the rule "only one checkout runs `test:int`, `db:migrate` or a dev server at a time" stays for the shared DB.
    - `notes/2026-11-07-parallel-agents-worktrees.md`: append a dated line (2026-11-07 or the build date) under "What a worktree does NOT isolate": the DB part of the fix exists now as `bun run db:worktree <name>` (`--drop`); port offset, `.env` copy and GreenMail stay open. Do not change the rest of the note.
    - Write in ASD-STE100 style (short sentences, active voice), like the existing text. The three files are prettier-clean now. No git hook runs at commit, so run the `prettier --check` of the Check line explicitly.
    - Never put a printed URL with a password into a doc. Use `<…>` placeholders.
  - Test: none (docs). Read the new README steps 1, 2, 3, 9 against the real script output from the 2.1 live run.
  - Check: `npx --no-install prettier --check tools/fake-telegram/README.md tasks/README.md notes/2026-11-07-parallel-agents-worktrees.md` (exit 0); `grep -n "db:worktree" tools/fake-telegram/README.md tasks/README.md notes/2026-11-07-parallel-agents-worktrees.md` shows each file.
  - Done when: the three files name the script, the README steps match the script, and the check passes.
  - Out of scope: `CLAUDE.md`, `docs/architecture.md` (stages 4 and 5), `.env.example`, other README sections.

### Stage 3 — Small items

- [ ] **3.1 Declare `@ea/core` and `kysely` in `tools/fake-telegram/package.json` `devDependencies`** (changes `bun.lock`; check S4 first).
  - Goal: `tools/fake-telegram` declares every package that its code imports, so it does not depend on workspace hoisting.
  - Files: `tools/fake-telegram/package.json`, `bun.lock` (both change).
  - Interfaces: `devDependencies` becomes (sorted by name):
    ```json
    "devDependencies": {
      "@ea/core": "workspace:*",
      "grammy": "^1.46.0",
      "kysely": "^0.29.8"
    }
    ```
  - Decisions:
    - Same version ranges as `apps/server/package.json` (`"@ea/core": "workspace:*"`, `"kysely": "^0.29.8"`), so the lock adds no new package version.
    - `devDependencies`, not `dependencies`: only `test/setup.ts` imports them (`import { isQuietTime, parseToolSwitches } from "@ea/core"`, `import type { Transaction } from "kysely"`).
    - Before the edit, the main session reads the status line of `tasks/active/s4-drafts-approvals-delegation.md` and `git log origin/master -- bun.lock`: if S4 (or another task) changes `bun.lock` now, wait. Rule: only one task at a time changes `bun.lock` (`tasks/README.md` § "Git mode").
    - Update the lock with `bun install` (not by hand). Then `bun install --frozen-lockfile` must pass. The `deploy/Dockerfile` copies `packages/core/package.json` and `tools/fake-telegram/package.json` before `bun install --frozen-lockfile`, so the image build still works (the job `image` of stage 1 checks this on the PR).
    - Bun versions differ: local Bun 1.4.4, CI Bun 1.3.14. `git diff bun.lock` locally, and CI `bun install --frozen-lockfile` (jobs `ci` and `image`) on the PR, catch a lock format change. If the lock header (`lockfileVersion` or `configVersion`) changes, stop and report to the main session.
    - `git diff bun.lock` must show only the `tools/fake-telegram` workspace entry gaining the two deps. If it changes other packages, versions or the header, stop and report.
  - Test: no new test. The existing `tools/fake-telegram/test/setup.test.ts` and `bun run typecheck` cover the imports.
  - Check: `bun install --frozen-lockfile` (exit 0); `bun run typecheck` (exit 0); `bun test tools/fake-telegram/src` (0 fail); `bun test tools/fake-telegram/test/setup.test.ts` (0 fail; needs no DB); `bun run lint` (exit 0); `git diff --stat` lists only the two files; `git diff bun.lock` shows no header change.
  - Done when: the two deps are in `devDependencies`, the lock diff is limited to the workspace entry, and the checks pass.
  - Out of scope: other dependency changes, version bumps, `bun update`.
- [ ] **3.2 `fake-tg --chat` accepts negative ids** (for example `--chat -1001234`), with a CLI test and the README usage line.
  - Goal: `bun run fake-tg <command> --chat -1001234` and `--chat=-1001234` work for `send`, `press`, `read` and `wait`.
  - Files: `tools/fake-telegram/src/cli.ts`, `tools/fake-telegram/src/cli.test.ts`, `tools/fake-telegram/README.md` (changes).
  - Interfaces:
    - `toNumber(name, value, integer)` in `cli.ts` gets a 4th parameter `allowNegative = false`. Only the `--chat` call passes `true`: `toNumber("chat", values.chat, true, true)`. All other options (`--port`, `--message`, `--timeout`, `--last`, `--after`) still refuse negative values. The error text stays `--<name> needs a whole number, got "<value>"`.
    - A small pure helper before `parseArgs` in `execute`: `joinNegativeChat(argv: string[]): string[]`. It turns the pair `"--chat", "-<digits>"` (regex `^-\d+$`) into one token `"--chat=-<digits>"`. It changes nothing else (it joins only `--chat`, no other option). Reason: `parseArgs` with `strict: true` refuses a value that starts with `-` in the split form ("argument is ambiguous"). Bun 1.4.4 does this too (verified), so the helper is necessary.
  - Decisions:
    - The fake server already accepts negative chat ids: `control.ts` uses `optionalInt` (any integer) and the regex `^\/chats\/(-?\d+)$`; `server.ts` uses `Number(payload.chat_id)`. So only the CLI changes.
    - The fake still has only private chats (`chat.type` is `"private"` in `state.ts`). A negative id gives a "private" chat with a negative id. Group chats are not part of this task; the README says so in one line.
    - Telegram group ids are negative and supergroup ids start with `-100` (README example `-1001234`).
  - Test (write first, `cli.test.ts`, inside `describe("fake-tg cli")`, using `start()` and `run()`):
    - Put the send, `read`, `=` form and `wait` cases in one test: `afterEach` stops the fake, so a second test does not see the messages of the first.
      - `send "hello" --chat -1001234` → code 0; then `read --chat -1001234` → code 0 and the output holds `hello`.
      - `read --chat=-1001234` (the `=` form) → code 0 and the output holds `hello`.
      - `send "/start x" --chat -1001234`, then `wait "hi" --chat -1001234 --timeout 5` → code 0 (the test bot answers `hi x`).
    - `read --chat -5 --last=-1` → code 2, stderr holds `--last needs a whole number, got "-1"` (the split form `--last -1` cannot reach `toNumber`: `parseArgs` throws "--last argument is ambiguous" first, because `joinNegativeChat` joins only `--chat`).
    - `read --chat=-1.5` → code 2, stderr holds `--chat needs a whole number`.
    - `read --chat -1.5` → code 2 (only the exit code; the error text comes from `parseArgs`, because `-1.5` does not match `^-\d+$`).
  - Check: `bun test tools/fake-telegram/src/cli.test.ts` (0 fail); `bun test tools/fake-telegram/src` (0 fail); `bun run typecheck` (exit 0); `bun run lint` (exit 0); `npx --no-install prettier --check tools/fake-telegram/README.md` (exit 0).
  - README (`tools/fake-telegram/README.md` § "CLI"): after the line "Defaults: chat `5550001`; …", add: "`--chat` takes a negative id too (for example `--chat -1001234`), but the fake has only private chats." Keep the command table as it is.
  - Done when: the new tests pass and the README line exists.
  - Out of scope: group or supergroup chat types in the fake, changes to `state.ts`, `server.ts`, `control.ts` or `driver.ts`.

### Stage 4 — Format `docs/architecture.md`

- [ ] **4.1 Prettier format of `docs/architecture.md` alone** (no content change).
  - Goal: `docs/architecture.md` is prettier-clean, so later small edits do not reformat the whole file.
  - Files: `docs/architecture.md` only.
  - Interfaces: none.
  - Decisions:
    - Before the step, the main session checks that no parallel task edits `docs/architecture.md`: the S4 status line (`tasks/active/s4-drafts-approvals-delegation.md`) and `git log origin/master -3 -- docs/architecture.md`. S4 stage 20 edited § 6.3 (line ~559). Run `git merge origin/master` in the branch first, so the format applies to the newest text. If S4 plans an edit of the file now, wait.
    - Run only `npx --no-install prettier --write docs/architecture.md` (repo `.prettierrc`: `printWidth` 120). No hand edits in this step.
    - This stage has its own review and its own commit, with no other file than `docs/architecture.md` and the task file update. Commit message: `docs: fake-telegram-followups stage 4 — prettier format of docs/architecture.md (no content change)`. (Main session decision, Questions 3 = (b).)
    - At `d1cc845` about 207 lines differ (106 insertions, 101 deletions, only table separators); the count can change after the merge.
  - Test: content check, expected no output:
    ```sh
    git diff -w --word-diff=porcelain docs/architecture.md | grep -E '^[-+]' | grep -vE '^(\+\+\+|---) ' | grep -vE '^[-+]\|[- |]+$'
    ```
    Any output line is a possible content change: the reviewer reads it; if it is not only whitespace, table padding, a list marker or an escape change, stop.
  - Check: `npx --no-install prettier --check docs/architecture.md` (exit 0, "All matched files use Prettier code style!"); `git diff --stat` lists only `docs/architecture.md` (plus the task file).
  - Done when: the check passes and the diff has no content change.
  - Out of scope: any wording change, the new line of stage 5, other files.

### Stage 5 — `TELEGRAM_API_ROOT` line

- [ ] **5.1 `TELEGRAM_API_ROOT` line near D8 in § 6:** dev only, loopback host only, used by `tools/fake-telegram`.
  - Goal: the architecture doc names `TELEGRAM_API_ROOT` and its limits.
  - Files: `docs/architecture.md` only.
  - Interfaces: none (docs).
  - Decisions:
    - Needs stage 4 (the file is prettier-clean). Own review and own commit (Questions 3 = (b)). Commit message: `docs: fake-telegram-followups stage 5 — TELEGRAM_API_ROOT line in docs/architecture.md`.
    - Place: § 6.2 Telegram, a new bullet directly after the bullet "Token handling (D8): …" and its second line about `telegramErrorLabel`.
    - Content (facts from the code; write in ASD-STE100 style):
      - `TELEGRAM_API_ROOT` is dev only: it points the bot at a local fake Bot API (`tools/fake-telegram`). Empty = the real Telegram.
      - `platform/config` (`isLoopbackApiRoot`) accepts only `http(s)://127.0.0.1`, `localhost` or `[::1]`, with an optional port, no path, no query and no trailing `/`. Any other value stops the start.
      - When it is set, the server logs one `warn` line at start: the bot talks to that Bot API, not to Telegram (`apps/server/src/main.ts`).
      - `telegram:check`, `telegram:link` and `job:run` use the same key. (`telegram:unlink` does not use it.)
      - Never set it on the VPS.
    - Suggested text (one bullet, two lines; the second line is indented by two spaces, like the D8 bullet):

      ```markdown
      - Fake Bot API (dev only): `TELEGRAM_API_ROOT` points the bot at the local fake `tools/fake-telegram`. Empty = the real Telegram.
        The config accepts only a loopback root (`127.0.0.1`, `localhost`, `[::1]`, no path, no trailing `/`); other values stop the start. The server logs one `warn` line when it is set. `telegram:check`, `telegram:link` and `job:run` use the same key. Never set it on the VPS.
      ```

    - No git hook runs at commit. Run `npx --no-install prettier --check docs/architecture.md` explicitly; it must pass with no change.

  - Test: none (docs).
  - Check: `npx --no-install prettier --check docs/architecture.md` (exit 0); `git diff docs/architecture.md` shows only the new bullet; `grep -n "TELEGRAM_API_ROOT" docs/architecture.md` shows it in § 6.2.
  - Done when: the bullet is in § 6.2 after D8 and the check passes.
  - Out of scope: other § 6 changes, ADR changes, `.env.example`.

## Questions for the user

The user does not answer questions in this task. Each item has a planner recommendation. The main session decides.

**Main session decision (2026-11-07): 1 = (a); 2 = (a) (if (b) is ever used, add `.gitignore` to the files of 2.1); 3 = (b).**

1. **Loopback guard in `db:worktree` (2.1).** The plan does not ask for it. Options: (a) refuse a non-loopback DB host; (b) no host check. Decision: (a). The script runs as superuser `postgres` and must never reach the VPS DB. The steps use (a).
2. **Passwords in the printed env lines (2.1).** The two printed lines hold the dev passwords of `app` and `migrator` (copies of the `.env` values with another DB name). The code rules say "never log secrets". Options: (a) print the full lines to stdout, not via `log`, and docs use only `<…>` placeholders; (b) write the lines to a gitignored file (for example `.env.worktree`) and print only the path; (c) print the URLs with `***` passwords (not usable as-is). Decision: (a). These are local dev passwords that `.env` already holds, and the plan says "print the env overrides". The steps use (a). If (b) is ever used, 2.1 also changes `.gitignore`.
3. **Two commits in one stage.** The rule is one commit per stage, but the format must be its own commit. Options: (a) one stage with two commits; (b) the format is a stage of its own. Decision: (b). Stage 4 = format only, stage 5 = the `TELEGRAM_API_ROOT` line. Each stage has its own review and commit.

## Not verified

- The oven/bun image build in CI: `bun install --frozen-lockfile` and the `find` result in the image were not run (Docker is not reachable for the agent user). Stage 1 CI proves it.
- Process env wins over `.env` for the child `bun run db:migrate` (the 2026-11-07 live run relied on it; not re-checked).
- The dev Postgres runs on `127.0.0.1:5433` at build time (needed for the 2.1 live run; `bun run db:up` needs Docker, which the agent user cannot reach).

Resolved by the Opus plan review (2026-11-07), now facts in the steps:

- Bun 1.4.4 `parseArgs` with `strict: true` refuses `--chat -1001234` ("argument is ambiguous"): the 3.2 helper is necessary.
- `describeError` (`platform/errors`) prints only the error name and the code: 2.1 uses it.
- The `app` role cannot read `schema_migrations` (SQLSTATE `42501`): the 2.1 live check uses `organizations` for `app` and the migrator URL for `schema_migrations`.
- SSH push works (`git push --dry-run` with `GIT_SSH_COMMAND="ssh -i ~/.ssh/github -o IdentitiesOnly=yes -o BatchMode=yes"`); no `gh` `workflow` scope needed.

## Log

- 2026-11-07: Created at the end of the fake Telegram build.
- 2026-11-07: Opus plan review round 1: FAIL, 16 findings (1 major, 11 minor, 4 questions), all put into the step detail. Stage 4 split into stage 4 (format) and stage 5 (`TELEGRAM_API_ROOT` line). Round 2: PASS, 4 minors fixed by the main session.
