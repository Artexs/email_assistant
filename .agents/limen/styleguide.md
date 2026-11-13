# Styleguide

> Project-owned coding practice for every coordinator, worker, and reviewer turn. Keep this file at or below 1000 lines. The injected copy is capped at 1000 lines. Edit this file to change how agents write and organize code here. It is not product scope and not speech.

Full rules: `docs/code-patterns.md` (accepted, wins on conflict). Architecture: `docs/architecture.md`, `docs/modules.md`, ADRs in `docs/decisions/`.

Checks before a commit: `bun run lint && bun run typecheck && bun run test:unit:ci && bun run test:int:ci`. The `:ci` scripts run the Bun of `.bun-version` (CI and the server image). Each Limen job has its own DB, so `test:int:ci` needs no lock; `test:e2e` runs under `flock /tmp/email-assistant-shared-tests.lock` (`CLAUDE.md`).

## Shape

- Bun workspaces: `@ea/server` (`apps/server`), `@ea/web` (`apps/web`), `@ea/core` (`packages/core`), test tools in `tools/<name>/`. App code never imports `tools/`.
- Server modules: `apps/server/src/modules/<module>/` with `index.ts` (public API), `service.ts`, `repo.ts`, `routes.ts`, `jobs.ts`, `*.test.ts` next to the code. Other modules import only from `index.ts`. No import cycles.
- `packages/core` is pure: no DB, no network, no `process.env`, no imports from `apps/*`. Planners and the policy live there.
- Ports and adapters: the port lives in the module that owns it (`mail/port.ts`); each adapter is a folder (`mail/imap/`, `mail/fake/`). Each SDK is imported only in its adapter (ESLint enforces it).
- Routes are thin: parse with `parseBody` and a `@ea/core` schema, call one service or repo function, map to JSON. The tenant comes from the session (`requireTenant`), never from the request.
- Web: one island per page; every visible string is a key in `apps/web/src/i18n/en.ts` through `t()`; data through `lib/api.ts` and `@ea/core/web` schemas.

## Prefer

- TypeScript strict. `const` / `let`. Template literals for strings with variables.
- Typed Kysely repositories: one function = one clear query; each takes a `TenantContext` and filters by `org_id` (exceptions listed in `docs/code-patterns.md`).
- Status change and its `audit_log` row in one transaction. Conditional updates (`WHERE status = …`) guard status changes. Claim work with `FOR UPDATE SKIP LOCKED`.
- Schema changes only as a new dbmate file `db/migrations/YYYYMMDDHHMMSS_<name>.sql` with up and down; then `bun run db:types`.
- Typed errors: `SoftError` (timeout, 429, 503, lost connection), `HardError` for the rest; the job runner decides the retry.
- `log` from `platform/log` with a `[module]` prefix; `describeError(error)`; for Telegram only `telegramErrorLabel(error)`.
- Config from env through the Zod schema in `platform/config`; every key in `.env.example`.
- Tests: pure core logic without mocks; repos against Postgres in a transaction that rolls back; fake and real adapters pass one contract suite. Route tests cover 401, 403, 404, 400.
- A test that waits for time-driven code polls its condition with `waitFor` (`apps/server/test/wait-for.ts`); a fake releases its holds in `stop()`.
- A prompt or model change runs `bun run eval` and must pass the go/no-go table.

## Avoid

- Central factories, generic CRUD wrappers, table names as strings (the old `.ai/AGENT.md` pattern).
- Editing `platform/db/schema.ts` by hand or an applied migration.
- Any mailbox change or send outside `actions.committer`. Retrying `send` after SMTP DATA started.
- LLM text as a recipient, folder name or command. Loose JSON reads of `actions.payload`.
- Locating mail by `SEARCH HEADER` (Interia finds nothing by `Message-ID`); use `locateMessage`.
- `console.log`, secrets or mail bodies in logs, paths from mail data in logs.
- Literal text in web components, inline `<script>`, hand-written `<style>`, hand-made shadcn components.
- Committing `.env`, keys, passwords or tokens.
- A fixed sleep over 100 ms in a test; `test.skip`, a CI retry or a longer timeout as a fix. A test that fails twice in CI without a code change is quarantined the same day with a ticket (`docs/code-patterns.md` § Tests); only the coordinator quarantines.
