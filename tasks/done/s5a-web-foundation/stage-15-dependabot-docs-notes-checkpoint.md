# s5a-web-foundation — Stage 15

Part of [`../s5a-web-foundation.md`](../s5a-web-foundation.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 15 — Dependabot, known alerts, notes, the `.env.example` review; the group review; user checkpoint 1; the merge

- [x] **15.1 Dependabot (D1, S13, W11)**
  - Goal: an upgrade of `better-auth` arrives as a weekly pull request that runs the auth tests and the login smoke in CI before anyone merges it.
  - Files: create `.github/dependabot.yml`.
  - Interfaces:

    ```yaml
    version: 2
    updates:
      - package-ecosystem: "bun"
        directory: "/"
        schedule:
          interval: "weekly"
        allow:
          - dependency-name: "better-auth"
        open-pull-requests-limit: 2
        commit-message:
          prefix: "deps"
    ```

  - Decisions: `bun` is the ecosystem for `bun.lock` (fact 17); `directory: "/"` is where `bun.lock` lives; only `better-auth` (S13); the pins are exact, so Dependabot proposes the bump of `apps/server/package.json` and `apps/web/package.json` together with `bun.lock`. Not verified: whether Dependabot finds the dependency in the workspace manifests from `/` (the first weekly run after the merge tells: user step 4; the fallback is a second entry with `directory: "/apps/server"`).
  - Test: none runnable locally; the file is reviewed against the GitHub docs page (fact 17).
  - Check: `bunx prettier --check .github/dependabot.yml`.
  - Done when: the file exists and passes Prettier.
  - Out of scope: other dependencies, security updates (not offered for `bun` by Dependabot).

- [x] **15.2 Known alerts, the `.env.example` review, the code-patterns read-through**
  - Goal: every new log line has its entry in `docs/known-alerts.md` with cause and fix, the Better Auth upgrade path is written down, and the code-patterns lines of stages 2, 3, 8 and 9 read as one text.
  - Files: change `docs/known-alerts.md`, `.env.example` (comments only, if the stage 2 text needs a correction after the build), `docs/code-patterns.md` (only if the read-through finds a contradiction between the lines that stages 2, 3, 8 and 9 added).
  - Decisions: `docs/known-alerts.md` entries (the file's template: alert text, cause, fix, status), one per new line: `web is off (WEB_BASE_URL is empty)` (info; expected until S5e sets the key on the VPS); `web is on: <origin>, dist <path>` (info); `web: dist folder missing, pages are off` (warn; run `bun run web:build` or check `WEB_DIST`; pages answer 503, the API works); `WEB_BASE_URL is http:// on a non-loopback host: cookies are not Secure` (warn; use `https://` behind Tailscale Serve); `web: reset requested for user <id>` (info; a `request-password-reset` reached the server instance — it cannot happen over HTTP in S5 (the route is closed), so a line means a code path changed: investigate); `better-auth: Invalid password`, `better-auth: User not found` and `better-auth: Reset Password: User not found` (warn; one per failed login or reset; many per minute from one address = someone guessing: the rate limit answers 429 after 3 in 10 s; S6 adds the lockout, `tasks/planned/web-public-hardening.md`); `better-auth: Invalid callbackURL: <url>` (error; a request to `/api/auth/reset-password/<token>` or another auth path carried a `callbackURL` outside `WEB_BASE_URL` and `WEB_TRUSTED_ORIGINS`: a hand-edited or foreign link; `cleanLogText` hides the URL itself; many lines = someone probes the route); `better-auth: Rate limiting could not determine a client IP …` (warn; must not appear: the server sets `x-client-ip` (W1); if it appears, `webDeps` or the auth mount changed); `web: user <id> has <n> memberships; using the oldest` (warn; S5 has no organization switcher); `web: no organization for user <id>` (warn; a user without a membership signed in or reset a password: `org:create` or an invite is missing); `web: audit <kind> failed: <label>` and `web: onEvent <kind> failed: <label>` (error; the audit row of a login or password change was not written; the login itself succeeded; check the DB); `POST /api/… 403` bursts in the debug access log (`bad_origin`: a client without a trusted `Origin`; check `WEB_TRUSTED_ORIGINS` or the proxy). Plus the **Better Auth upgrade path** entry (D1, master plan finding 22): "A Dependabot PR `deps: bump better-auth …`: read the release notes (security releases are listed on better-auth.com/blog), run `bun run test:int` (the `web-auth*` tests) and `bun run web:build && bun run test:e2e`, then merge and deploy (S5e runbook)."
  - Test: `bunx prettier --check docs/known-alerts.md docs/code-patterns.md`; a grep that every alert text matches a `log.*` call: `grep -rn "web is off\|dist folder missing\|non-loopback\|reset requested\|has .* memberships\|no organization for user\|audit .* failed\|onEvent .* failed" apps/server/src` finds each.
  - Check: the Prettier check and the grep.
  - Done when: the entries exist and the grep finds every text.
  - Out of scope: `docs/architecture.md`, `docs/modules.md`, `docs/roadmap.md`, the ADRs (S5e, D23).

- [x] **15.3 Notes, the S5a log, the pointer for S5b**
  - Goal: what the build learned is in `notes/`, so that S5b's plan session and S5e's ADR writer start from facts.
  - Files: create `notes/<date>-web-foundation-build.md`; change `tasks/active/s5a-web-foundation.md` (the log line, the "Not verified" list with the results of stages 11.3, 13.2 and 14, the done-when evidence); `tasks/planned/s5b-web-mailboxes-onboarding.md` gets one log line: "S5a built: the islands are `islands/<Page>Page.tsx` with `AppShell` inside (stage 10.2), the seed is `scripts/e2e-seed.ts` with `SeedFile` (stage 12), `requireOwner` and `parseBody` are exported from `platform/http.ts`, `WebDeps.routers` mounts a module router from `web.ts`, every web import of core goes through `@ea/core/web`".
  - Decisions: the note holds: the versions as installed (`bun pm ls | grep -E "better-auth|@hono/bun|@playwright/test|radix-ui|astro"`), the CI `e2e` duration and the image size, the result of the `web:dev` hand check (11.3), anything that differed from the plan (each with the stage), the Dependabot status if known. No secrets, no URLs with tokens.
  - Test: none; a read-through.
  - Check: `bunx prettier --check notes/<date>-web-foundation-build.md tasks/active/s5a-web-foundation.md tasks/planned/s5b-web-mailboxes-onboarding.md`.
  - Done when: the note exists and the segment file's log and not-verified list are current.
  - Out of scope: the S5e docs.

- [x] **15.4 Group review, user checkpoint 1 (= master checkpoint 1), the merge**
  - Goal: the segment is reviewed as a whole on Opus high (the review model), the user has used the result on the dev machine, and `master` gets the merge.
  - Files: none; the main session runs it (`tasks/README.md` § "Pipeline mode" 7, § "Git mode" worktree step 3).
  - Decisions:
    - **Order:** (1) the group review after every stage has PASS; (2) the user's walk-through; (3) the merge. (The group review first, so that the user tries a reviewed build.)
    - **Group review:** the `reviewer` on Opus high over the commit range of stages 1–15 with the stage ids; in the worktree it runs `bun run lint && bun run typecheck && bun run test:unit && bun run test:int && bun run web:build && bun run test:e2e` (the main session runs `test:int` and `test:e2e` for it when the review copy has no database); it looks for drift between stages (the `WebDeps` shape of stages 5, 6 and 8, the `en.ts` keys used by stages 10–13, the `SeedFile` of stage 12 against the specs of stage 13), duplicated code, missing tests across the range, and the security list of the master plan ("No secret or private text in a log line, an error body or an audit row").
    - **User checkpoint 1** (in the worktree folder, with the worktree's `.env` from user steps 0–2): `bun run dev` and `bun run web:dev`; `bun run web:invite --org-id <dev org id>` (the id from `org:create`'s log or `SELECT id FROM organizations`); open the printed link as printed (it lands on `http://localhost:4321/setup?token=…`), set a password, land on `/onboarding`; then `bun run web:build` and open `http://127.0.0.1:8080/login` (the built shape): sign in, see the shell at a phone width (browser devtools) and the desktop width, open the menu, sign out, sign in again. The user says go or names what is wrong.
    - **Migration order (final review, 2026-11-10):** `master` has `20261109083501_sync_folders.sql`, which sorts after `20261109000001_web_panel.sql`. Steps in the worktree, in this order: (1) run the database guard, then `bun run db:rollback` on `email_assistant_s5a`; then the same with the `E2E_*` URLs as `DATABASE_URL` and `MIGRATOR_DATABASE_URL` on `email_assistant_e2e` (or drop and re-create both with `db:worktree`). Do this **before** the rename: dbmate cannot roll back an applied version whose file is gone. (2) `git merge origin/master`; conflicts are expected only in `docs/known-alerts.md`, one or two hunks (both sides add entries: keep both). (3) `git mv` the S5a migration to a version after `20261109083501`. (4) `bun run db:migrate`, `bun run db:types`, then the full check line. Why rename: dbmate 2.37 applies an older version out of order by default (`--strict` is off), so the old name would work, but a fresh database would then apply the migrations in another order than the dev database, and `db:rollback` would undo the wrong one.
    - **Merge:** in the worktree `git merge origin/master`, the full check line passes; in the main checkout `git merge --no-ff task/s5a-web-foundation` and push; `bun run db:migrate` on the dev database (the dev database gets the `web_panel` migration with the merge; the other active tasks merge `master` before their next stage); the task files move as `tasks/README.md` says (`git mv tasks/active/s5a-web-foundation.md tasks/done/` with its folder, status `done`, after the done-checklist); the master plan's segment list ticks S5a. Then `bun run db:worktree s5a --drop` and `git worktree remove`.
    - Risk to other work: S5a changes `bun.lock` and adds a migration; `test-mail-traffic` stage 9 and `llm-provider-switch` must run `bun install` and `bun run db:migrate` after they merge `master`; the dev database gets the three auth tables (no effect on the jobs) and the `users` CHECK (their tests pass: the S5a stage 1 change of `tenancy.test.ts` arrives with the merge).
  - Test: the group review report (PASS) and the user's walk-through.
  - Check: the full check line above, run by the main session in the worktree before the merge.
  - Done when: PASS, the user says the walk-through worked, the merge is pushed, the dev database is migrated, the S5a task file is in `tasks/done/` with its done-when evidence, and the master plan's segment list has S5a ticked.
  - Out of scope: S5b.
