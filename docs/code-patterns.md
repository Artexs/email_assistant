# Code patterns — rules for agents and humans

> **Accepted 2026-11-02** (user). Replaces `.ai/AGENT.md` (history: it describes the old `IntegrationFactory` and generic adapters; do not use them).
> Source: `docs/architecture.md` §3–4 and `docs/modules.md` §3. When code and this file disagree, fix one of them in the same commit.

## Layout and borders

- Packages: `@ea/server` (`apps/server`), `@ea/web` (`apps/web`), `@ea/core` (`packages/core`).
- Server code lives in `apps/server/src/modules/<module>/` and `apps/server/src/platform/`. Shared pure code lives in `packages/core/`.
- Real platform paths: `platform/config.ts`, `platform/log.ts`, `platform/http.ts`, `platform/db/`, `platform/crypto.ts`, `platform/errors.ts`, `platform/scheduler.ts`, `platform/heartbeat.ts`.
- A module exposes one `index.ts`. Other modules import only from it, never from its inner files.
- Module files: `index.ts` (public API), `service.ts`, `repo.ts` (DB), `routes.ts` (HTTP), `jobs.ts` (workers), `*.test.ts` next to the code.
- `packages/core` has no I/O: no DB, no network, no `process.env`, no imports from `apps/*`.

## Ports and adapters

- A port (interface) lives in the module that owns it: `MailProvider` in `mail/port.ts`, `ChatChannel` in `channels/port.ts`.
- Each adapter is a folder in its module (`mail/imap/`, `mail/fake/`, `channels/telegram/`). A module builds its adapters from config.
- No central factory, no generic CRUD wrapper, no table names as strings.
- Only `platform/llm.ts` imports `@google/genai`. Only `mail/imap/` imports `imapflow`, `mailparser`, `nodemailer`. Only `channels/telegram/` imports `grammy`.

## Data access

- Typed repositories with Kysely. One repository function = one clear query. Column names are snake_case in TypeScript.
- Generated DB types live in `apps/server/src/platform/db/schema.ts`. Never edit this file by hand. Run `bun run db:types` after each migration.
- Every repository function takes a `TenantContext` and filters by `org_id`. A test checks each new function for the filter. Only these take no `TenantContext`:
  - `insertOrganization`, `insertUser`.
  - `listSyncTargets` (`mail/repo.ts`): the sync job lists the active mailboxes of all organizations.
  - S2, `channels/repo.ts`: `findChatLink` (the chat id gives the tenant), `listLinkedChats` (the notifier and digest jobs read all organizations), `useLinkToken` and `findLinkToken` (the token gives the tenant), `replaceChatLink` (it deletes the old link of a chat across organizations), `claimDueOutbox` (the sender claims rows of all organizations).
- Status changes and their `audit_log` row go in one transaction.
- Work items are claimed with `FOR UPDATE SKIP LOCKED`. Conditional updates (`WHERE status = …`) guard every status change.
- Schema changes only through a new dbmate file `db/migrations/YYYYMMDDHHMMSS_<name>.sql` with `-- migrate:up` and `-- migrate:down`. Never edit an applied migration.
- Migrations run as the `migrator` role with `bun run db:migrate`. The server runs as the `app` role.

## Side effects

- Only `actions.committer` changes a mailbox or sends mail. Planners and the policy are pure functions in `packages/core`.
  The exceptions are the test tools that refuse every address except `TEST_MAILBOX_ADDRESS` (`mailbox:seed`, `mailbox:probe-move`).
  The committer finds its mailboxes with `listSyncTargets`; it adds no new entry point without a `TenantContext`.
- A mail is located by identity (`locateMessage`), never by `SEARCH HEADER`: Interia finds nothing by `Message-ID`.
- Non-idempotent provider calls (`create_draft`, `send`): commit status `applying` first; add the header `X-EA-Action-Id`.
- `send` is at-most-once: never retry it by itself after SMTP DATA starts (`docs/architecture.md` §4.1 rule 6).
- No import cycles between modules: a module sets a column that another module's worker reads (`docs/modules.md` §2).
- The LLM returns data that a Zod schema checks. LLM text is untrusted: never use it as a recipient, a folder name or a command.

## Config and secrets

- All config comes from env, checked with a Zod schema at start (`platform/config`). A missing key stops the start.
- `.env.example` lists every key with a placeholder. Never commit `.env`, keys, passwords or tokens. Never log them.
- Mailbox secrets are encrypted with `platform/crypto` (AES-256-GCM, key version) before they reach the DB.

## Style

- TypeScript strict. `const` / `let` only, never `var`.
- Template literals for strings with variables, never `+` concatenation.
- Use the `log` util (`platform/log`) with a `[module]` prefix, never `console.log`. No mail bodies or secrets in logs.
- Folder keys in logs and audit rows, never paths from mail data or user input.
- Telegram errors: log only `telegramErrorLabel(error)`. Never log `error.message` of an inner error, `payload` or `description` (they can hold the bot token or message text). Other errors: `describeError(error)`.
- Errors: throw typed errors (`SoftError` for timeout / 429 / 503 / lost connection, `HardError` for the rest); the job runner decides the retry.

## Tests

- `bun run test:unit` runs unit tests; `bun run test:int` runs integration tests.
- Unit tests stay next to the code. Pure logic in `packages/core`: unit tests without mocks.
- Integration tests live in `apps/server/test/integration/`. Repositories: tests against Postgres in a container (each test in a transaction that rolls back).
- Adapters: contract tests; the fake and the real adapter pass the same suite.
- A prompt or model change runs `bun run eval` and must pass the go/no-go table.
