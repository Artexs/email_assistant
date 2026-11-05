# s2-telegram — Stage 7

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

Dev DB shell for the manual checks of this stage: `D="docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml --env-file .env"`; read-only SQL with `$D exec -T db psql -U postgres -d email_assistant -c "<SQL>"`. Find the dev org and its members with `select o.id, m.user_id, m.role from organizations o join memberships m on m.org_id = o.id;`.

## Stage 7 — CLIs: `telegram:link`, `telegram:unlink`, `digest:times`

- [ ] **7.1 `bun run telegram:link`**
  - Goal: the admin makes a one-time link for one member (modules §4: CLI before S5).
  - Files: create `apps/server/src/scripts/telegram-link.ts`; change root `package.json` (`"telegram:link": "bun apps/server/src/scripts/telegram-link.ts"`); export `createLinkToken`, `LINK_TOKEN_TTL_MS` from `channels/index.ts` if not yet.
  - Interfaces: `bun run telegram:link --org-id <uuid> [--user-id <uuid>]`.
  - Decisions:
    - Style of the other scripts (`parseArgs` with `strict: true`, Zod uuid checks, `loadConfig`, `assertAppRole`, exit codes 0 / 1, usage text on bad input).
    - No `TELEGRAM_BOT_TOKEN` → `log.error("TELEGRAM_BOT_TOKEN is not set")`, exit 1.
    - No `--user-id`: `listMemberships` of the org; exactly one member → use it; none → `log.error("the organization has no members")`, exit 1; more → ``log.error(`the organization has ${n} members: pass --user-id`)``, exit 1.
    - First `checkBot(token)` (the bot user name; a bad token stops here and makes no token row), then `createLinkToken(db, { orgId }, userId, new Date())`.
    - The link goes to stdout only (never through `log`, so it is in no log file): `process.stdout.write` of three lines: `` `Open this link on the user's phone within 15 minutes (until ${HH:MM} UTC):` ``, `` `https://t.me/${username}?start=${token}` ``, `The link works once. Do not share it.`
    - One log line without the token: ``log.info(`link token made for user ${userId}, valid until ${expiresAt.toISOString()}`)``.
    - Errors: a `HardError` (our own fixed text, no data) → `log.error(error.message)`; a Telegram error → ``log.error(`failed: ${telegramErrorLabel(error)}`)``; else ``log.error(`failed: ${describeError(error)}`)``. Exit 1.
  - Test: none for the script (the functions have tests in stage 6). Manual run below.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`. Manual on the dev DB: `bun run telegram:link --org-id <dev org>` prints a `https://t.me/<dev bot>?start=…` link; `select count(*) from chat_link_tokens where user_id = '<user>' and used_at is null` → 1. Do not open the link now: nothing polls before stage 20. Run it again → the count stays 1 (the old token is gone). `--user-id` of another org → exit 1, `user is not a member of this organization`.
  - Done when: the manual checks give these results.
  - Out of scope: the `/start` handler (stage 14).

- [ ] **7.2 `bun run telegram:unlink`**
  - Goal: the admin can cut a chat off (for example a lost phone).
  - Files: create `apps/server/src/scripts/telegram-unlink.ts`; change root `package.json` (`"telegram:unlink": "bun apps/server/src/scripts/telegram-unlink.ts"`); export `unlinkUser` from `channels/index.ts`.
  - Interfaces: `bun run telegram:unlink --org-id <uuid> --user-id <uuid>`.
  - Decisions: same script style; no bot token needed. `unlinkUser(db, { orgId }, userId, new Date())` → ``log.info(`unlinked ${n} chat(s) of user ${userId}`)``, exit 0 (also for 0).
  - Test: none for the script (stage 6 tests `unlinkUser`).
  - Check: `bun run lint && bun run typecheck && bun run test:unit`. Manual on the dev DB: `bun run telegram:unlink --org-id <dev org> --user-id <user>` → `unlinked 0 chat(s)` (nothing is linked yet).
  - Done when: the manual run prints the line and exits 0.
  - Out of scope: a `/stop` command.

- [ ] **7.3 `bun run digest:times` and `setDigestTimes`**
  - Goal: the admin sets a member's digest times (P1); the pilot member gets 08:00 and 16:00 in stage 23.
  - Files: change `apps/server/src/modules/tenancy/repo.ts` and `tenancy/index.ts` (`setDigestTimes`); create `apps/server/src/scripts/digest-times.ts`, `apps/server/test/integration/tenancy-digest-times.test.ts`; change root `package.json` (`"digest:times": "bun apps/server/src/scripts/digest-times.ts"`).
  - Interfaces:
    - `setDigestTimes(db: Db | Transaction<DB>, ctx: TenantContext, userId: string, times: readonly string[]): Promise<boolean>` — `UPDATE memberships SET digest_times = <times> WHERE org_id = ctx.orgId AND user_id = userId`; true when one row changed.
    - `bun run digest:times --org-id <uuid> [--user-id <uuid>] --times <HH:MM,HH:MM | none>`
  - Decisions:
    - Input check with `parseDigestTimesInput` (step 2.2); an error → `log.error(<error>)` and the usage, exit 1.
    - The member choice without `--user-id` is the same as in step 7.1.
    - Kysely: `.set({ digest_times: [...times] })`; node-postgres sends the JS array as an array literal and Postgres casts it to `time[]` (the test proves it).
    - Output: ``log.info(`digest times of user ${userId}: ${times.join(", ") || "none"} (${timezone})`)`` with the org timezone from `getOrganization`. `false` → `log.error("no membership for this user in this organization")`, exit 1.
  - Test (`tenancy-digest-times.test.ts`, `withRollback`): `setDigestTimes(["08:00", "16:00"])` → true, and `getMembership` gives `digest_times` `["08:00:00", "16:00:00"]`, which `parseDigestTimes` turns into `["08:00", "16:00"]`; `setDigestTimes([])` → stored `[]`; another org's context → false and the row does not change.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`. Manual on the dev DB: `bun run digest:times --org-id <dev org> --times 08:00,16:00` → the log line with `Europe/Warsaw`; `--times 8:00` → exit 1 with `bad time: 8:00`.
  - Done when: the test passes and the manual runs give these results.
  - Out of scope: a web settings page (S5).
