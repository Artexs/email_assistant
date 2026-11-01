# 0002 — One repo, Bun workspaces, modular monolith
- Status: proposed
- Date: 2026-11-01

## Context
One developer. The old docs planned three backend apps (API, triage worker, batch jobs) and talked about microservices.
The repo already has an Astro app in `src/` and a Bun package in `backend/`.

## Decision
- Keep one repository. Use Bun workspaces: `apps/web`, `apps/server`, `packages/core`.
- `apps/server` is one process with modules (tenancy, mail, triage, actions, delegation, reports, channels, config, audit).
  Entry flags can later start only `api`, `worker` or `scheduler` from the same code.
- `packages/core` holds pure domain logic and Zod schemas, shared by server and web.
- HTTP framework: Hono (replaces the unused Express dependency).

## Consequences
- One deploy, one CI pipeline, shared types.
- Module borders are kept by convention: import only from a module's `index.ts`.
- Splitting into services stays possible because modules talk through their public API.
