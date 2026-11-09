# s5a-web-foundation — Stage 12

Part of [`../s5a-web-foundation.md`](../s5a-web-foundation.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 12 — `e2e-seed.ts` (D19, W10) [risky]

The seed deletes an organization by name and writes into a database: that is why the stage is `[risky]` (D19: it must never touch the dev database or another task's worktree database).

- [ ] **12.1 The seed script and its guards**
  - Goal: an idempotent script makes the fixed `E2E` organization with an owner who has a known password and two assistants (`mobile`, `desktop`) who each have an unused setup link, on the e2e database only, and refuses every other database.
  - Files: create `apps/server/src/scripts/e2e-seed.ts`, `apps/server/src/scripts/e2e-seed-args.ts` (pure helpers and constants, unit-tested), `apps/server/src/scripts/e2e-seed-args.test.ts`, `apps/server/test/integration/e2e-seed.test.ts`; change `apps/server/src/modules/tenancy/index.ts` (export `insertUser` and `insertMembership`: a script imports a module through its index, as `pick-member.ts` does; second cold review, finding 10), the root `package.json` (`"e2e:seed": "bun apps/server/src/scripts/e2e-seed.ts"`), `.gitignore` (`apps/web/e2e/.seed.json`, `apps/web/e2e/test-results/`, `apps/web/e2e/playwright-report/`).
  - Interfaces:

    ```ts
    // e2e-seed-args.ts
    export const E2E_ORG_NAME = "E2E";
    export const E2E_OWNER_EMAIL = "e2e-owner@x.test";
    export const E2E_OWNER_PASSWORD = "e2e-correct-horse-battery"; // 25 characters; a test value, not a secret
    export const E2E_PROJECTS = ["mobile", "desktop"] as const;
    export type E2eProject = (typeof E2E_PROJECTS)[number];
    export const E2E_ASSISTANT_EMAILS: Record<E2eProject, string>; // e2e-assistant-mobile@x.test, e2e-assistant-desktop@x.test
    export interface SeedFile {
      orgId: string;
      owner: { userId: string; email: string; password: string };
      assistants: Record<E2eProject, { userId: string; email: string; setupUrl: string }>;
    }
    export function databaseNameOf(url: string): string | null; // new URL(url).pathname without the leading "/"; null when it does not parse
    export function isE2eDatabaseName(name: string | null): boolean; // name !== null && name.endsWith("_e2e")
    export function seedTargetOk(
      appUrl: string,
      migratorUrl: string
    ): { ok: true; database: string } | { ok: false; reason: string }; // both names parse, both end in "_e2e", both are the same name
    export function seedFilePath(repoRoot: string): string; // `${repoRoot}/apps/web/e2e/.seed.json`
    ```

    `bun run e2e:seed` reads `DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `WEB_BASE_URL`, `WEB_AUTH_SECRET` (plus the usual `loadConfig` keys) from the environment; exit 0 and the line `[e2e-seed] seeded org <id> owner <id> assistants <id>,<id>`; exit 1 with `refusing: <reason>` (`DATABASE_URL is not an e2e database (<name>)`, `MIGRATOR_DATABASE_URL is not an e2e database (<name>)`, `the two URLs name different databases (<a>, <b>)`, `WEB_BASE_URL is empty`).

  - Decisions:
    - Steps: (1) `loadConfig()`; `seedTargetOk(config.DATABASE_URL, process.env.MIGRATOR_DATABASE_URL ?? "")` not ok → refuse before any connection (cold review of this plan, finding 5: the destructive statements run on the migrator URL, so both URLs are checked, and only names that end in `_e2e` pass — `email_assistant_e2e` from user step 2, difference 5; another task's worktree database such as `email_assistant_s5b` is refused); (2) through a `pg.Client` on `MIGRATOR_DATABASE_URL`: `DELETE FROM organizations WHERE name = $1` (`E2E`; the cascades remove mailboxes, mail, actions, memberships and the audit rows — a cascade runs as the table owner, so the migrator URL is a choice of clarity, not a need; `app` may not `DELETE` audit rows directly, `20261104000001_triage.sql:120`), then `DELETE FROM users WHERE email = ANY($1)` (the three fixed addresses; users are global and the organization cascade does not remove them), then `DELETE FROM auth_verifications WHERE value NOT IN (SELECT id::text FROM users)` (leftover tokens of a half-failed run); (3) `createDb(config.DATABASE_URL)` as `app`: `createOrganizationWithOwner(db, { orgName: "E2E", timezone: "Europe/Warsaw", email: E2E_OWNER_EMAIL, displayName: "E2E Owner" })`; `insertUser` + `insertMembership(role "assistant")` for each project's assistant (`displayName: "E2E Assistant mobile"` and `… desktop`); (4) `createAuth({ …, onEvent: auditWebEvent(db), sendResetPassword: capture })`: `requestPasswordReset` for the owner, `resetPassword` with `E2E_OWNER_PASSWORD`; `requestPasswordReset` for each assistant and keep its URL (unused: the test consumes it; one per project because `globalSetup` runs once per run and both projects run test 4: cold review of this plan, finding 2); (5) write `SeedFile` to `seedFilePath(repoRoot)` with `repoRoot = resolve(import.meta.dir, "../../../..")` (the script lives in `apps/server/src/scripts/`; mode 600; the file holds one-time URLs); (6) `close()` and `db.destroy()`.
    - S5b extends this script (a GreenMail mailbox and synthetic mail); the `SeedFile` shape grows then.
  - Test:
    1. `e2e-seed-args.test.ts`: `databaseNameOf("postgres://app:x@127.0.0.1:5433/email_assistant_e2e")` → `email_assistant_e2e`; `isE2eDatabaseName("email_assistant_e2e")` true, `("email_assistant")` false, `("email_assistant_s5b")` false, `("other_e2e")` true, `(null)` false; `seedTargetOk(e2eApp, e2eMigrator)` ok with `database "email_assistant_e2e"`; `(devApp, e2eMigrator)` not ok with the `DATABASE_URL` reason; `(e2eApp, devMigrator)` not ok with the `MIGRATOR_DATABASE_URL` reason; `("postgres://…/a_e2e", "postgres://…/b_e2e")` not ok with the "different databases" reason; `seedFilePath("/r")` → `/r/apps/web/e2e/.seed.json`.
    2. `e2e-seed.test.ts` (integration): running the script as a subprocess with `DATABASE_URL` and `MIGRATOR_DATABASE_URL` = the test database (`email_assistant` or the worktree's `email_assistant_s5a`) → exit 1 and a `refusing: DATABASE_URL is not an e2e database` line, and no `E2E` organization exists afterwards (count 0); with `DATABASE_URL` pointing at `…/email_assistant_e2e` and `MIGRATOR_DATABASE_URL` at the test database → exit 1 with the `MIGRATOR_DATABASE_URL` reason and no connection was opened (the process ends before `pg` connects: assert the stderr has no connection error). The positive path runs in stage 13 against the real e2e database.
  - Check: the database guard (segment file, user step 0; it must print `/email_assistant_s5a /email_assistant_s5a`, else stop), then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass and `git status` shows no `.seed.json` (gitignored).
  - Out of scope: the Playwright config and specs (stage 13), mailboxes and mail in the seed (S5b).
