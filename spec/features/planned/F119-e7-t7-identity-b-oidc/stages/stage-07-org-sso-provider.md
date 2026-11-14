# F119 stage 07 — `org:sso`: show, set, remove

Part of [`../plan.md`](../plan.md). `[risky]` (security). Needs stage 04. May run next to stages 05–06 (other files).

## Step 07.1 — Service functions

**Goal.** PD-041: only the operator creates, changes and removes a provider, each with an audit row.

**Files.** Tenancy repo `repo/sso.ts`, tenancy service and `index.ts`, `auditEvents`.

**Interfaces.**
- `getSsoState(db, ctx): Promise<SsoState | null>` with `SsoState = { providerId, issuer, domain, proof: "dns" | "attested" | null, required: boolean, linkedMembers: number, breakGlassReady: boolean }` (`breakGlassReady` = a break-glass owner with TOTP on). Never the config or the secret. Stages 08, 10 use it.
- `setSsoProvider(db, ctx, input: { issuer, domain, clientId, clientSecret, config: OidcProviderConfig, actor: "cli", now }): Promise<{ kind: "new" | "secret" | "boundary" | "unchanged" } | { kind: "not_found" } | { kind: "domain_taken" }>`.
  - `config` comes from `discoverProviderConfig` (stage 03), run by the CLI before the transaction (D16).
  - One transaction: `lockOrganization`, read the row. No row → insert (`provider_id` = org id, `domain_verified = false`, `domain_proof = NULL`): `new`. Same issuer and domain, other client id or secret → update the config only; links and sessions stay: `secret`. Other issuer or domain → update; `domain_verified = false`, `domain_proof = NULL`, `organizations.sso_required = false`, delete the provider's `auth_accounts` rows and every `sso` session of those users: `boundary`. Same everything → `unchanged`, no write, no audit row.
  - Domain of another organization's provider → `domain_taken`.
  - Audit `sso.provider_set` (data `provider_id`, `change` = kind, `issuer_host`, `domain`, `links_removed`, `sessions_ended`), actor `cli`.
- `removeSsoProvider(db, ctx, { actor, now }): Promise<{ kind: "removed"; linksRemoved: number; sessionsEnded: number } | { kind: "none" }>` — one transaction: lock the organization, then the provider row (`FOR UPDATE`; a callback in flight finishes first, D16), delete links, `sso` sessions of those users, the provider, set `sso_required = false`. Audit `sso.provider_removed` (`provider_id`, `links_removed`, `sessions_ended`).
- The `oidc_config` JSON: the shape `spike.md` S2 proved (the discovered endpoints, `clientId`, `clientSecret`, `pkce: true`, `scopes: ["openid", "email", "profile"]`, `allowIdpInitiated: false`; the `OIDCConfig` type of the plugin). One builder function `buildOidcConfig` in `platform/auth-sso.ts`, so the plugin's shape lives in one file.

**Decisions.** D10, D12, D15, D16.

## Step 07.2 — The CLI

**Files.** `apps/server/src/scripts/org-sso.ts`, `org-sso-args.ts` (+ unit test), `package.json` script `org:sso`.

**Interfaces.**
- `bun run org:sso --org-id <uuid>`: show. Prints `provider <id>`, `issuer <host>`, `domain <d> <proof|unproved>`, `required <yes|no>`, `flag sso_sign_in <on|off>`, `break-glass <ready|missing>`, `linked <n>`, `redirect <WEB_BASE_URL>/api/auth/sso/callback/<id>`. Stage 08 adds the `txt` line. No provider: `no provider`.
- `--set --issuer <https url> --domain <d> --client-id <id> --client-secret-stdin`: reads one line from stdin (trimmed; empty → exit 1 `client_secret_missing`). `--client-secret <value>` does not exist (argv lands in shell history and `ps`). Prints the kind and the redirect line.
- `--remove --confirm <domain>`: `--confirm` must equal the stored domain (`confirm_mismatch`, exit 1).
- Domain input: trimmed, lower-cased, must match the stage 02 CHECK (`bad_domain`, exit 1).
- Discovery failure: exit 1 with `discovery_failed <code>` (the `DiscoveryError` code), nothing written.
- Errors are event lines; output via `process.stdout.write`; never the secret, never the config.

**Test** (`apps/server/test/integration/org-sso.test.ts`; the fake IdP as issuer, its origin trusted for the test):

1. Set on org A: `new`, one row, `domain_proof` NULL, one `sso.provider_set` (`change: new`). A second identical set: `unchanged`, no row.
2. New secret: `secret`; Ann's link and SSO session stay.
3. New issuer (a second fake IdP): `boundary`; Ann's link and SSO session gone, her password session stays, `sso_required` false, proof NULL; audit counts 1 and 1.
4. Org B sets `x.test`: `domain_taken`.
5. Remove with `--confirm x.test`: `removed`, counts right, no row, `sso_required` false; again: `none`. `--confirm y.test`: exit 1, nothing changed.
6. Args unit: missing `--org-id`, `--set` without `--issuer`, `http://` issuer, `--client-secret foo`, two commands at once: usage, exit 1.
7. Secret from stdin `s3cret-value-1\n`: stored in `oidc_config`; not in stdout, stderr, the log capture or the audit `data`.
8. Discovery against a stopped fake IdP: exit 1 `discovery_failed`, no row.
9. Show prints no `clientSecret`, no `s3cret-value-1`.

**Check.** The Proof of `plan.md` (`/tmp/f119-s07`).

**Done when.** The nine tests pass; Proof prints `PROOF_OK`.

**Out of scope.** Proof, attestation, the require switch (stage 08); the console (stage 10).
