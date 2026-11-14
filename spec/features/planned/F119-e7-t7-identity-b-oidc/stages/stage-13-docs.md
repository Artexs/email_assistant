# F119 stage 13 — Docs, ADR 0026, capability pages, runbook

Part of [`../plan.md`](../plan.md). Needs stages 11 and 12. Docs only.

## Step 13.1 — Describe what landed

**Goal.** A later agent and the operator find every SSO rule in the place the repo keeps it (PD-009: behaviour rules live in `docs/capabilities/`).

**Files and content.**
- `docs/capabilities/web-panel.md`: rule 3 (the two new `/api/auth/*` paths and the 404 rule for every other plugin path), rule 4 (company sign-in, "SSO required" refusal looks like a wrong password, the 12 h SSO session, TOTP not asked after SSO), rule 6 or 7 (`GET /api/sign-in-options` outside the session guard; `/api/me` fields), rule 8 (an operator with an SSO session gets `403 password_sign_in_required`), rule 9 (login page and Account card), Data (`sso_providers`, `organizations.sso_required`, `auth_sessions.sign_in_method`, the trigger, the audit events), Limits (no SAML, SCIM, JIT; one domain; the operator ends member sessions; no Playwright spec), Entry points, Tests. Update its "Checked against" line.
- `docs/capabilities/tenancy-and-plans.md`: `org:member` and `org:sso` (every command, its prerequisites, its audit row); remove the Limits line "No way to add a second member".
- `docs/capabilities/account-data.md`: `sso_providers` in the export map (config excluded) and the delete cascade.
- `docs/decisions/0026-identity-tier-1-oidc-totp.md`: status line (points 2–8 accepted and landed by F119); an "Amendment (F119)" section with the facts that differ from the first text: the plugin's provider and domain endpoints are closed and our CLI does both (point 3, 4); our own TXT format; the session mark and its trigger; TOTP is not asked after SSO and the console needs a password session (point 1 and 7); the operator ends member sessions in Stage 2 (point 7); the client secret is stored in clear in the provider row (Q1); `--require on` prerequisites.
- `docs/architecture.md` §5 (tables) and §7 (web security): one line each, pointing to the capability page.
- `docs/code-patterns.md` § Data access: the two new reads or writes of Better Auth tables by our SQL (`platform/auth-sessions-end.ts`, the `hasPassword` read, the `auth_accounts` reads of `resolveSsoMember`), next to the F105 exceptions.
- `deploy/README.md` § Company sign-in (new): the runbook. (1) Turn on the flag: `bun run org:flag --org-id <id> --flag sso_sign_in --on`. (2) The organization's admin registers an app in Entra or Google: redirect URI from `org:sso --org-id <id>`, scopes `openid email profile`, a tenant-specific issuer for Entra (`https://login.microsoftonline.com/<tenant-id>/v2.0`); every member must reach the panel on the tailnet (ADR 0017). (3) `org:sso --set … --client-secret-stdin` (paste the secret; never on the command line). (4) DNS: add the printed TXT record, then `--verify`; a test organization without DNS: `--attest --confirm <domain>`. (5) `org:member --add` for members who have no account. (6) Optional: a break-glass owner (`org:break-glass`, TOTP on), then `--require on`. (7) An IdP outage: `--require off` reopens passwords; the break-glass owner always gets in. (8) Offboarding: disable the user in the IdP (access ends within 12 h); at once: `org:member --end-sessions`. (9) A plugin upgrade: keep `better-auth` and `@better-auth/sso` on one version, never below 1.6.27, and run the stage 03–06 tests.
- `docs/known-alerts.md`: one entry per new log line (`sso_refused`, `sso_audit_failed`, `operator_sso_session_refused`, `password_sign_in_refused_sso`, `reset_request_refused_sso`, `sign_in_options_failed`) with source, cause and fix.
- `notes/2026-11-14-two-factor.md` § For later tickets: mark the F119 seam as done (SSO sessions are marked; the operator guard reads the mark).

**Decisions.** All of `plan.md` § Input; the defaults of `questions.md` are stated as "default, owner to confirm" where they appear.

**Test.** None new.

**Check** (`<files>` = the files this stage changed):

```
mkdir -p /tmp/f119-s13 && bunx prettier --check <files> > /tmp/f119-s13/prettier.log 2>&1 && bun run lint > /tmp/f119-s13/lint.log 2>&1 && bun run test:unit:ci > /tmp/f119-s13/unit.log 2>&1 && echo PROOF_OK
```

**Done when.** Each file above says what the code at `HEAD` does (the worker checks each claim against the code, not against this plan); `PROOF_OK`. A claim of this list that the code does not hold is a question in the final message.

**Out of scope.** Product code; the VPS.
