# F119 stage 09 — `org:member`: add, end sessions, unlink

Part of [`../plan.md`](../plan.md). `[risky]` (tenant data, sessions). Needs stage 05. May run next to stages 06–08.

## Step 09.1 — Service functions

**Goal.** An SSO member must exist before the first sign-in (no just-in-time accounts, PD-041), and the operator ends a member's access on the owner's request (ADR 0026 point 7, D11, Q3, Q4). Today no CLI adds a second member (`docs/capabilities/tenancy-and-plans.md` § Limits).

**Files.** Tenancy service, repo `repo/memberships.ts` and `repo/users.ts`, `index.ts`; `auditEvents`. Session and account deletes are our SQL on Better Auth tables, as `resetTwoFactorRows` (F105 D13): put them in `platform/auth-sessions-end.ts` (Kysely only, no `better-auth` import) and list it in `docs/code-patterns.md` as the third exception (stage 13 writes the doc line).

**Interfaces.**
- `addMember(db, ctx, input: { email, displayName, role: "assistant" | "owner", locale: "pl" | "en", actor: "cli", now }): Promise<{ kind: "added"; userId: string } | { kind: "email_taken" } | { kind: "off_domain" } | { kind: "not_found" }>` — one transaction: lock the organization; the e-mail is trimmed and lower-cased; a `users` row with this e-mail anywhere → `email_taken` (one user, one organization: D16); an organization with `sso_required` and an e-mail off its provider domain → `off_domain`; else insert the user (`email_verified = true`, no `auth_accounts` row: no password) and the membership; audit `org.member_added` (`user_id`, `role`).
- `endMemberSessions(db, ctx, { userId, onlySso: boolean, actor, now }): Promise<{ kind: "ended"; count: number } | { kind: "not_member" }>` — deletes the user's `auth_sessions` rows (all, or `sign_in_method = 'sso'` only); audit `web.member_sessions_ended` (`user_id`, `count`, `only_sso`).
- `unlinkSso(db, ctx, { userId, actor, now }): Promise<{ kind: "unlinked"; sessionsEnded: number } | { kind: "none" } | { kind: "not_member" }>` — one transaction: delete the user's `auth_accounts` row of this organization's provider and the user's `sso` sessions; audit `sso.unlinked` (`user_id`, `sessions_ended`). The next SSO sign-in links again by e-mail (stage 04 rule 5).
- The membership check uses the tenant scope of `ctx` (RLS backs it); a user of another organization → `not_member`.

**Decisions.** D11, D12, D16.

## Step 09.2 — The CLI

**Files.** `apps/server/src/scripts/org-member.ts`, `org-member-args.ts` (+ unit test), `package.json` script `org:member`.

**Interfaces.**
- `bun run org:member --org-id <uuid> --add --email <e> --display-name <n> [--role assistant|owner, default assistant] [--lang pl|en, default pl]` → `added <user id>`.
- `--user-id <uuid> --end-sessions [--only-sso]` → `ended <n>`.
- `--user-id <uuid> --unlink-sso` → `unlinked, sessions <n>` or `none`.
- Exit 1 with the kind for every other result. The CLI prints ids and counts only (`docs/capabilities/account-data.md` rule 17: no address on stdout).
- To give a new member a password later: `web:invite --org-id --user-id` (unchanged).

**Test** (`apps/server/test/integration/org-member.test.ts`):

1. Add `eve@x.test` (assistant) to org A: one user without `auth_accounts`, one membership, one `org.member_added`. `Eve@X.test` again: `email_taken`.
2. Org A with `sso_required` and provider `x.test`: add `fay@y.test` → `off_domain`, nothing written.
3. Eve signs in through the fake IdP (stage 04): linked, a session.
4. Eve has 2 SSO sessions and 1 password session (seed by SQL): `--end-sessions --only-sso` ends 2; `--end-sessions` ends the last; `GET /api/me` with the old cookie answers 401.
5. `--unlink-sso`: the link and the SSO sessions go; the next SSO sign-in links again with `first_link: true`.
6. A user of org B with `--org-id` A: `not_member` for both commands; nothing changed.
7. Args unit: `--add` without `--email`, a non-UUID `--user-id`, `--role admin`, two commands: usage, exit 1.
8. stdout and the log capture of 1–6 hold no e-mail address.

**Check.** The Proof of `plan.md` (`/tmp/f119-s09`).

**Done when.** The eight tests pass; Proof prints `PROOF_OK`.

**Out of scope.** A members page or an owner route (Stage 3); removing a membership.
