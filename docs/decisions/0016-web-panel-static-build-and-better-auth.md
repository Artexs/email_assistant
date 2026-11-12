# 0016 — Web panel: Astro static build with React islands, login with Better Auth

- Status: accepted
- Date: 2026-11-12

## Context

S5 gives the owner a web panel: login, mailboxes, settings, rules and activity.
ADR 0011 puts the data in our own Postgres and removes Supabase, so Supabase Auth is not available.
Today one user works with the panel. External customers come in S6 (sign-up is not in S5).

Decisions and facts: the S5 master plan, `tasks/active/s5-web-panel.md` (lines P1, P2, D1–D9).
Probes: `notes/2026-11-08-s5-probes/` and `notes/2026-11-08-s5a-probes/`.

## Decision

- **Login = Better Auth** (P1, D1, D2).
  - The library runs inside the Hono server, on our Postgres, with our dbmate migrations.
  - Better Auth uses our `users` row as its user. Its tables are `auth_sessions`, `auth_accounts` and `auth_verifications`.
  - E-mail and password only. `disableSignUp` is on. The password has 12 to 128 characters.
  - The first password and every reset use the reset flow. `bun run web:invite` prints a one-time link (24 hours).
  - Only these `/api/auth/*` routes are open: `sign-in/email`, `sign-out`, `get-session`, `reset-password` (POST, and GET `reset-password/<token>`), `change-password`, `revoke-other-sessions`, `revoke-sessions`, `list-sessions`. Every other path answers 404.
  - The session lasts 30 days and renews every day. There is no cookie cache, so a revoked session ends at the next request.
  - `better-auth` has an exact version pin. Dependabot opens a weekly pull request. The upgrade path is in `docs/known-alerts.md`.
- **Web = Astro static build with React islands** (P2, D6, D17).
  - The Hono server serves `apps/web/dist` from one origin. A page without a session redirects to `/login`.
  - The browser talks only to the JSON API under `/api` (D9).
  - The routes are thin: parse, call one service, map to JSON (D8). The session middleware gives the tenant (D3). The client never sends an `org_id`.
  - The web, Telegram and the CLI call the same services (D10). Undo, feedback, the go/no-go gate and the settings use one code path.
- **Hardening on every request** (D5).
  - The header CSP holds only `frame-ancestors 'none'`. The Astro meta CSP holds `default-src 'self'` and the other fixed directives, with hashes for the inline island scripts.
  - `style-src` has `'unsafe-inline'`, because the Radix scroll lock injects a style. `script-src` never has it.
  - The origin check covers every non-safe method under `/api`. `bodyLimit` is 64 KB. `Referrer-Policy` is `same-origin`.
  - HSTS is on only when `WEB_BASE_URL` starts with `https://`.
- **One tenant-filter exception** (D3): `listMembershipsOfUser` has no `TenantContext`, because the user gives the tenant.
  The three Better Auth tables are tenant-free and keyed by user. Only the library reads and writes them.

## Consequences

- Good:
  - We write no own crypto. Later login methods are plugins (Google, magic link, passkeys, the Organization plugin).
  - One container serves the panel and the API.
- Bad:
  - The database dump (and so each backup) holds live `auth_sessions` tokens, password hashes and reset tokens. After a real restore, run `delete from auth_sessions;` and ask the members to sign in again.
  - A library upgrade needs the auth integration tests and the Playwright login test (known-alerts entry).
  - The hashed CSP depends on the Astro `experimental.csp` flag.
  - A static build shows a loading state on each page, because the page arrives before its data.
- Rejected options:
  - Hosted Supabase: the data and the login would leave the user's machines.
  - Self-hosted GoTrue: a third container and JWT work for one user.
  - Own login code: it stays the fallback if Better Auth fails on Bun.
  - SSR: a second runtime and logic in two places.
  - A separate Vite SPA: no public pages for S6.
