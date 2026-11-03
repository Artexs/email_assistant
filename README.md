# Email Assistant

An AI email assistant for managers. It categorizes mail, delegates tasks, filters spam and summarizes threads.
Product description: [docs/product-brief.md](docs/product-brief.md).

## Stack

- Bun workspaces: `apps/server`, `apps/web`, `packages/core`.
- Server: Hono on Bun.
- Database: Postgres 17, migrations with dbmate, queries with Kysely.
- AI: Gemini.
- Web: Astro starter (stays until S5).

Details: [docs/architecture.md](docs/architecture.md). Decisions: `docs/decisions/`.

## Setup

Requirements: [Bun](https://bun.sh) and Docker.

```bash
bun install
cp .env.example .env     # fill in the passwords; the passwords in the URLs must match the password keys
bun run db:up            # starts the Compose `db` and waits until it is healthy
bun run db:migrate
bun run org:create --org-name "Acme" --email "boss@example.com" --display-name "Boss"
bun run dev
curl http://127.0.0.1:8080/health   # {"status":"ok","db":"up"}
```

The Compose `db` listens on host port **5433**, because a local Postgres often uses 5432.
Dev URLs in `.env.example` use port 5433.

## Scripts

| Script                                                       | What it does                                         |
| :----------------------------------------------------------- | :--------------------------------------------------- |
| `bun run dev`                                                | Starts the server with file watch                    |
| `bun run start`                                              | Starts the server                                    |
| `bun run lint`                                               | Runs ESLint                                          |
| `bun run typecheck`                                          | Runs the type check in every workspace               |
| `bun run test:unit`                                          | Runs unit tests (no database)                        |
| `bun run test:int`                                           | Runs integration tests (needs the `db` and migrated) |
| `bun run db:up`                                              | Starts the `db` container                            |
| `bun run db:down`                                            | Stops the `db` container                             |
| `bun run db:migrate`                                         | Applies migrations as the `migrator` role            |
| `bun run db:rollback`                                        | Rolls back the last migration                        |
| `bun run db:types`                                           | Generates the Kysely types from the database         |
| `bun run org:create --org-name … --email … --display-name …` | Creates an organization and its first user           |
| `bun run gemini:test`                                        | Checks the Gemini API key                            |
| `bun run web:dev`                                            | Starts the Astro dev server                          |
| `bun run web:build`                                          | Builds the Astro app                                 |

## Reset the dev database

This deletes all dev data.

```bash
docker compose -f deploy/compose.yaml --env-file .env down -v
bun run db:up
bun run db:migrate
```

## License

MIT.
