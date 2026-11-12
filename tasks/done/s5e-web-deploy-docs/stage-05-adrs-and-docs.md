# s5e-web-deploy-docs — Stage 5

Part of [`../s5e-web-deploy-docs.md`](../s5e-web-deploy-docs.md). Read that file's "Done when", "Owns", "Facts checked", E12–E14, "Rules for every step" and the stage 4 log first. Read the master plan's P1–P12, U1–U10, D1–D23 with their dated lines (`tasks/active/s5-web-panel.md`) and the three facts notes (`notes/2026-11-11-web-{mailboxes,settings-rules,activity}-facts.md`). Every fact in a doc comes from the code or from these files; a doc never states a plan that the code does not hold. Run in the worktree branch `task/s5e-web-deploy-docs` (after the stage 2 merge, `git merge origin/master` first).

## Stage 5 — ADR 0015, ADR 0016, ADR 0011 line, architecture, modules, roadmap, code patterns, notes

- [x] **5.1 ADRs**
  - Goal: the two S5 decisions are recorded as accepted ADRs.
  - Files: create `docs/decisions/0015-web-panel-static-build-and-better-auth.md`, `docs/decisions/0016-web-access-tailscale-serve.md`; change `docs/decisions/README.md` (two rows, status `accepted`), `docs/decisions/0011-self-hosted-postgres.md` (one dated line, E13; the ADR README rule "never edit an accepted decision to change it": the line adds a fact and changes no decision, as the "amended by" rows of 0007 and 0010 did; if the reviewer objects, put the line in ADR 0015's Consequences only).
  - Decisions: the content lists of E12 and E13, in the ADR template (`docs/decisions/README.md`): `# NNNN — Title`, `- Status: accepted`, `- Date: <stage date>`, `## Context`, `## Decision`, `## Consequences`. STE, short sentences. Each decision names its source line (P1, D5, …) and links the master plan once. The Tailscale facts cite the stage 4 results (certificate time, Tailscale version) without the tailnet name.
  - Check: `bunx prettier --check docs/decisions/*.md`; `grep -rn 'ts\.net' docs/decisions/` → only `<machine>.<tailnet>.ts.net`.
  - Done when: both ADRs exist, the README table has rows 0015 and 0016, 0011 has the dated line.

- [x] **5.2 `docs/architecture.md`**
  - Goal: the architecture describes the web panel as built (E14).
  - Files: change `docs/architecture.md`.
  - Decisions: §2 the context diagram (Mermaid): the web box "Web panel (static build served by the server)", the user's devices → "Tailscale Serve (HTTPS, tailnet only)" → server; the text under it: "All connections from the server go out, except the web panel: Tailscale Serve on the host proxies tailnet requests to `127.0.0.1:8080` (ADR 0016)." §3 the `apps/web/` line ("Astro static build with React islands; served by the server; talks only to `/api`") and `platform/auth` (Better Auth, ADR 0015). §5 the `users` row (the login columns of Better Auth; e-mail stored lower-case) and three rows `auth_sessions`, `auth_accounts`, `auth_verifications` (written only by Better Auth; tenant-free, keyed by user). §7 web security: `WEB_AUTH_SECRET`, the session cookie (`HttpOnly`, `Secure` on `https://`, `SameSite=Lax`, 30 days sliding), the origin check, the CSP (D5), the `/api/auth/*` allow-list, the rate limit with the trusted proxy, the `delete_mailbox` function (`SECURITY DEFINER`, owned by `migrator`). §9 Playwright as built (two projects, own e2e database, 40 tests at S5d). §10 deployment: the loopback port, Tailscale Serve, the runbook section. §12 the `src/` row: the web stack is decided (ADR 0015). Remove every "decide in S5" phrase (difference 6).
  - Check: `bunx prettier --check docs/architecture.md`; `grep -n -i 'decide.* in S5\|decided in S5\|decided at the S5 start' docs/architecture.md` → no line.
  - Done when: the sections above are current.

- [x] **5.3 `docs/modules.md` and `docs/code-patterns.md`**
  - Goal: the module catalog lists the routes and pages as built.
  - Files: change `docs/modules.md`, `docs/code-patterns.md` (only if a rule is missing).
  - Decisions: §2 add the edge `tenancy → audit` (`tenancy/service.ts` writes `org.timezone_changed`, `org.style_changed`; the S5c pointer) in the text and the diagram; S5d adds no edge. §3.0 the `http` row (Hono app, session and tenant middleware, hardening, static pages, `/health`) and a new `auth` row (Better Auth instance, `platform/auth.ts`). §3.1 `tenancy`: login built in S5 (Better Auth), `web:invite`, `updateOrganizationSettings`, `listMembershipsOfUser`; "Later" keeps S6 sign-up and Phase 2 invitations. §3.10: replace the route table with the routes as built: read `apps/server/src/platform/http.ts`, `apps/server/src/web.ts` and every `apps/server/src/modules/*/routes.ts` (method, path, role, module, slice S5a–S5d); `/actions` approve and reject and the delegation routes stay "Phase 2 web". §4 pages as built: Login, Setup (first password and reset), Onboarding, Mailboxes, Settings (with the Account card: change password, sign out everywhere; the Organization card: timezone, signature), Rules, Activity; Account page (delete account) stays S6. The S5 scripts list: `web:invite`. `docs/code-patterns.md`: confirm that the rules for thin routes, the Better Auth tables, `listMembershipsOfUser`, the i18n keys and the shared Telegram words exist (they do at collect: lines 32, 55–60, 76–84); add only a missing one.
  - Check: `bunx prettier --check docs/modules.md docs/code-patterns.md`; a cross-check: every path in the new §3.10 table appears in a `routes.ts`, `web.ts` or `http.ts`. The routers are mounted under `/api` with `api.route("/", …)` (`web.ts`), so grep the path without `/api` (for example `grep -rn '"/feedback"' apps/server/src/modules`); write the count in the log.
  - Done when: §2, §3.0, §3.1, §3.10, §4 match the code.

- [x] **5.4 `docs/roadmap.md` and the deploy note**
  - Goal: the roadmap shows S5 as built and deployed; the deploy facts have one home.
  - Files: change `docs/roadmap.md`; create `notes/<date>-web-panel-deploy.md`.
  - Decisions: roadmap §1 "Sellable MVP": the web panel line gets "(built and deployed <date>, ADR 0015, 0016)"; §2 the S5 row: the state line (built in S5a–S5e, deployed on the VPS behind Tailscale Serve; the market check was not done, P9); §3 "Web: decided at the S5 start" → "Web: Astro static build with React islands, Better Auth (ADR 0015)". The note (`notes/<date>-web-panel-deploy.md`): what a later agent needs for the VPS web panel: facts 1, 4, 5 (peer, Serve headers, no OS listener), E2/E3 (the keys and the gateway rule), the stage 2 rehearsal results and times, the stage 4 results (certificate time, Tailscale version, image size, smoke results), the open items; no tailnet name. Pointer lines (one each) in `deploy/README.md` "Web panel" → the note.
  - Check: `bunx prettier --check docs/roadmap.md notes/<date>-web-panel-deploy.md deploy/README.md`.
  - Done when: the files are written and pass Prettier.

- Out of scope: any code change; `.ai/` history files; the editor rule files that still mention Supabase (`.cursor/rules/*.mdc`, `.windsurfrules`, `.github/copilot-instructions.md`: a follow-up line in stage 6 if they mislead).
