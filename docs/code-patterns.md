# Code patterns — rules for agents and humans

> **Accepted 2026-11-02** (user). Replaces `.ai/AGENT.md` (history: it describes the old `IntegrationFactory` and generic adapters; do not use them).
> Source: `docs/architecture.md` §3–4 and `docs/modules.md` §3. When code and this file disagree, fix one of them in the same commit.

## Layout and borders

- Packages: `@ea/server` (`apps/server`), `@ea/web` (`apps/web`), `@ea/core` (`packages/core`).
- Server code lives in `apps/server/src/modules/<module>/` and `apps/server/src/platform/`. Shared pure code lives in `packages/core/`.
- Real platform paths: `platform/config.ts`, `platform/log.ts`, `platform/http.ts`, `platform/db/`, `platform/crypto.ts`, `platform/errors.ts`, `platform/auth.ts`, `platform/scheduler.ts`, `platform/heartbeat.ts`.
- A module exposes one `index.ts`. Other modules import only from it, never from its inner files.
- Module files: `index.ts` (public API), `service.ts`, `repo.ts` (DB), `routes.ts` (HTTP), `jobs.ts` (workers), `*.test.ts` next to the code.
- `packages/core` has no I/O: no DB, no network, no `process.env`, no imports from `apps/*`.
- Test tools live in `tools/<name>/` (workspace `tools/*`, first: `tools/fake-telegram/`). App code (`apps/*`, `packages/*`) never imports them, and the server image holds only their `package.json`.

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
  - `listSyncTargets` and `listMailboxTargets` (`mail/repo.ts`): the sync job lists the active mailboxes of all organizations; the S4 expiry job lists mailboxes of several statuses with `listMailboxTargets`.
  - `listMembershipsOfUser` (`tenancy/repo.ts`, S5a): the user gives the tenant; the web resolves the organization from the session.
  - S2, `channels/repo.ts`: `findChatLink` (the chat id gives the tenant), `listLinkedChats` (the notifier and digest jobs read all organizations), `useLinkToken` and `findLinkToken` (the token gives the tenant), `replaceChatLink` (it deletes the old link of a chat across organizations), `claimDueOutbox` (the sender claims rows of all organizations).
- The tables `auth_sessions`, `auth_accounts`, `auth_verifications` and the Better Auth columns of `users` are read and written only by the Better Auth library through `platform/auth.ts`; no repository function touches them.
- Status changes and their `audit_log` row go in one transaction.
- Work items are claimed with `FOR UPDATE SKIP LOCKED`. Conditional updates (`WHERE status = …`) guard every status change.
- Schema changes only through a new dbmate file `db/migrations/YYYYMMDDHHMMSS_<name>.sql` with `-- migrate:up` and `-- migrate:down`. Never edit an applied migration.
- Migrations run as the `migrator` role with `bun run db:migrate`. The server runs as the `app` role.

## Side effects

- Only `actions.committer` changes a mailbox or sends mail. Planners and the policy are pure functions in `packages/core`.
  The exceptions are the test tools that refuse every address except `TEST_MAILBOX_ADDRESS` (`mailbox:seed`, `testmail-target deliver`, `mailbox:probe-move`, `mailbox:probe-send`).
  The committer finds its mailboxes with `listSyncTargets`; it adds no new entry point without a `TenantContext`.
- A mail is located by identity (`locateMessage`), never by `SEARCH HEADER`: Interia finds nothing by `Message-ID`.
- Non-idempotent provider calls (`create_draft`, `send`): commit status `applying` first; add the header `X-EA-Action-Id`.
- `send` is at-most-once: never retry it by itself after SMTP DATA starts (`docs/architecture.md` §4.1 rule 6).
- SMTP errors are classified by stage (`SmtpSendError.stage`: `connect`, `login`, `envelope`, `content`, `unknown`). The committer never retries after `content` or `unknown`.
- A recipient comes only from a `delegates` row or from `emails.from_address` (a clarification). Never use LLM text as a recipient.
  The raw message is built only by `buildOutgoingMessage` (`packages/core`) and `composeMessage` (`mail`): the draft and the send share the bytes.
- `actions.payload` is parsed with the core payload schemas (`draftPayloadSchema`, `sendPayloadSchema`), never read as loose JSON.
- A module that `actions` must call back (a delegation changes with a send) gets a hooks interface in `actions` (`DelegationHooks`); `main.ts` wires the implementation. `actions` never imports `delegation`.
- No import cycles between modules: a module sets a column that another module's worker reads (`docs/modules.md` §2).
- The LLM returns data that a Zod schema checks. LLM text is untrusted: never use it as a recipient, a folder name or a command.

## HTTP routes (S5)

A route file (`routes.ts`) is thin: it parses the body with `parseBody` and a `@ea/core` schema, calls one service or repository function, and maps the result to JSON. No SQL, no business rule, no `org_id` from the request: `requireTenant` sets `ctx` from the session. Every route test covers 401 (no session), 403 (an assistant on an owner route, when the route is owner-only), 404 (another organization's id, when the route takes an id) and 400 (a bad body, `details` without the input). The platform (`platform/http.ts`) imports no module; the composition root (`apps/server/src/web.ts`) wires the module routers.

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

## Web app (`apps/web`)

- Every user-visible string is a key in `apps/web/src/i18n/en.ts` and reaches a component through `t()`. A component never holds a literal text (`react/jsx-no-literals` on the islands and the shell and auth components).
- No inline `<script>` and no hand-written `<style>`: the build hashes the scripts (D5), and styles come from Tailwind classes.
- shadcn components come from the shadcn CLI, never by hand.
- One island per page. The shell is a React component inside the island.
- Data comes from `/api/*` through `lib/api.ts`; only the auth paths (`/api/auth/*`) go through `lib/auth-client.ts`. The request and response shapes are the `@ea/core/web` schemas. The web imports core only through that subpath.

## Tests

- `bun run test:unit` runs unit tests; `bun run test:int` runs integration tests.
- Unit tests stay next to the code. Pure logic in `packages/core`: unit tests without mocks.
- Integration tests live in `apps/server/test/integration/`. Repositories: tests against Postgres in a container (each test in a transaction that rolls back).
- Adapters: contract tests; the fake and the real adapter pass the same suite.
- A prompt or model change runs `bun run eval` and must pass the go/no-go table.
