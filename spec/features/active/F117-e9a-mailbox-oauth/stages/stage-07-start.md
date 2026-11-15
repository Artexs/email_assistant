# F117 stage 07 — State, PKCE, the start and options routes

Part of [`../plan.md`](../plan.md). `[risky]` (security). Needs stage 06.

## Step 07.1 — State store

**Goal.** A single-use, short-lived `state` row per sign-in attempt (D9).

**Files.** `apps/server/src/modules/mail/oauth/state.ts` (new) and its integration test.

**Interfaces.**

```ts
export interface OAuthStart { provider: MailOAuthProvider; userId: string; mailboxId: string | null }
export async function createOAuthState(db: Db, secrets: SecretBox, ctx: TenantContext, start: OAuthStart, now: Date): Promise<{ state: string; codeChallenge: string }>;
export type ConsumeResult = { ok: true; start: OAuthStart; verifier: string } | { ok: false; code: "oauth_state_invalid" | "oauth_state_expired" };
export async function consumeOAuthState(db: Db, secrets: SecretBox, ctx: TenantContext, input: { state: string; provider: MailOAuthProvider; userId: string }, now: Date): Promise<ConsumeResult>;
```

**Rules.**
- `state` and verifier: 32 bytes from `crypto.getRandomValues`, base64url. Challenge: base64url SHA-256 of the verifier.
- The row keeps the hex SHA-256 of `state` and the verifier encrypted with AAD `oauth_state:<row id>`; `expires_at = now + 10 min`.
- At most 5 rows per user: the insert deletes the oldest beyond 4 first, in the same transaction.
- `consumeOAuthState` runs `DELETE … WHERE state_hash = $1 AND org_id = ctx AND user_id = $2 AND provider = $3 RETURNING *` and commits before the caller redeems the code (a replay finds nothing). A row found but expired → `oauth_state_expired` (it is deleted too). No row → `oauth_state_invalid` (also for another user, organization or provider: one code, no detail).
- A Reconnect state for a mailbox of another organization cannot exist (the foreign key has `org_id`).

## Step 07.2 — Routes

**Files.** `apps/server/src/modules/mail/oauth/routes.ts` (new), mounted with the mailbox routes; the composition root passes the registry, client config and flags.

**Interfaces.**
- `GET /api/mailboxes/oauth/options` (any member) → `{ providers: Array<{ provider: MailOAuthProvider; connect: boolean; reconnect: boolean }> }`. `reconnect` is true when the provider is configured; `connect` also needs the flag on for the organization.
- `POST /api/mailboxes/oauth/:provider/start` (owner; Origin check and suspended-write refusal of `/api` apply) body `{ mailboxId?: string }` → `200 { url }`.
  - Unknown provider → `404 not_found`. Not configured → `409 not_configured`.
  - No `mailboxId` and the flag off → `403 feature_off`.
  - `mailboxId` of a mailbox that is not an `oauth` mailbox of this provider in the organization → `404 not_found`.
  - The URL: `client.authorizeUrl({ state, codeChallenge, loginHint })`; `loginHint` = the mailbox address for a Reconnect only.
- No rate limit: `/api` has no per-user write limit (read at the plan base), the route is owner only, and the 5-row cap bounds the rows.

**Decisions.** D7, D8, D9, D10, D18.

**Edge cases.**
- Two tabs: two states, each valid once.
- A member (not owner) → `403 owner_only`; a suspended organization → `403 org_suspended`.
- Clock: tests set `expires_at` by SQL, never move the clock.

**Test** (integration, the app with the fake token server specs and a test `SecretBox`):
1. Owner start for `google` with the flag on → 200; the URL has `state`, `code_challenge`, `code_challenge_method=S256`, the redirect URI `<WEB_BASE_URL>/api/mailboxes/oauth/google/callback`; one row; the row has no clear `state` or verifier.
2. Flag off, no `mailboxId` → `403 feature_off`; flag off with the `mailboxId` of an OAuth Google mailbox → 200 with `login_hint`.
3. Member → `403 owner_only`; provider `yahoo` → 404; Google keys missing → `409 not_configured`.
4. Six starts → five rows remain, the first is gone.
5. `consumeOAuthState` with the right input → `ok`, verifier matches the challenge; a second call → `oauth_state_invalid`.
6. Another user of the same organization → `oauth_state_invalid`; the row is not deleted.
7. `expires_at` set 1 s in the past → `oauth_state_expired`, row deleted.
8. `options` with Microsoft configured and flag off, Google not configured → `[{ microsoft, connect: false, reconnect: true }, { google, connect: false, reconnect: false }]`.
9. Canary: captured log lines and the audit table hold no `state` or verifier value.

**Check.** The Proof.

**Done when.** The tests pass; the Proof prints `PROOF_OK`.

**Out of scope.** The callback (stage 08), the panel (stage 16).
