# F119 stage 08 — Domain proof and the require switch

Part of [`../plan.md`](../plan.md). `[risky]` (security). Needs stages 06 and 07.

## Step 08.1 — Prove the domain: DNS TXT or attestation

**Goal.** PD-041: the plugin signs nobody in until the provider's domain is proved (D3); the operator proves it by DNS, or attests it for a test organization without DNS control.

**Files.** Tenancy service and repo `repo/sso.ts`; `apps/server/src/modules/tenancy/sso-domain-token.ts` (pure, `node:crypto` only); the `org:sso` CLI of stage 07.

**Interfaces.**
- `ssoDomainToken(key: Buffer, orgId: string, domain: string): string` — lower-case hex, first 32 characters of HMAC-SHA256(`key`, `${orgId}:${domain}`).
- `ssoDomainKey(credentialsKey: string): Buffer` — HKDF-SHA256 of the decoded `CREDENTIALS_KEY`, empty salt, info `ea/sso-domain/v1`, 32 bytes (the pattern of the DSR address hash, `docs/capabilities/account-data.md` rule 13).
- TXT record: name `_ea-sso.<domain>`, value `ea-sso=<token>`.
- `verifySsoDomain(db, ctx, { resolveTxt: (name: string) => Promise<string[][]>, key: Buffer, actor, now }): Promise<{ kind: "verified" | "already" | "none" | "not_found_in_dns" }>` — the DNS read runs before the transaction; a record matches when its chunks joined and trimmed equal the value exactly. Then lock the organization, re-read the row (the domain may have changed: `none` if the provider or domain is gone), set `domain_verified = true`, `domain_proof = 'dns'`, audit `sso.domain_verified` (`provider_id`, `domain`). A DNS error (`ENOTFOUND`, `ENODATA`, timeout) → `not_found_in_dns`, no write.
- `attestSsoDomain(db, ctx, { confirmDomain, actor, now }): Promise<{ kind: "attested" | "already" | "none" | "confirm_mismatch" }>` — `domain_proof = 'attested'`, audit `sso.domain_attested` (`provider_id`, `domain`).
- CLI: `org:sso --org-id <id> --verify`; `--attest --confirm <domain>`. Show gets the `txt` line while unproved. `resolveTxt` is `node:dns/promises` `resolveTxt` in the CLI; tests inject a fake. A key change makes unproved tokens new (a proved domain stays proved).

**Decisions.** D9, D12, D16.

## Step 08.2 — `--require on|off`

**Goal.** The operator switches "SSO required" only when no member gets locked out.

**Interfaces.**
- `setSsoRequired(db, ctx, { required: boolean, actor, now }): Promise<{ kind: "changed" | "unchanged" } | { kind: "refused"; reasons: SsoRequireRefusal[]; userIds: string[] }>` with `SsoRequireRefusal = "no_provider" | "unproved" | "flag_off" | "no_break_glass" | "off_domain_members"`.
- On: one transaction with the organization locked; every prerequisite checked and all failures returned: a provider exists; it is proved; `isFeatureOn(…, "sso_sign_in")` (a `FEATURES_OFF` kill counts as off); a break-glass owner with TOTP on exists (Q7); every member other than the break-glass owner has an e-mail on the domain (`userIds` lists the others). Then `sso_required = true`.
- Off: always allowed (the operator's way to reopen passwords, D8).
- Audit `sso.required_changed` (`from`, `to`) on `changed` only.
- CLI prints `required yes|no` or `refused <reason>` per reason and `member <user id>` per off-domain member; exit 1 on `refused`.

**Decisions.** D8, D10, D12.

**Test** (`apps/server/test/integration/org-sso-domain.test.ts`; unit `sso-domain-token.test.ts`):

1. Unit: a fixed 32-byte key, org `00000000-0000-4000-8000-000000000001`, domain `x.test`: the token is the same in two runs, 32 hex characters, and differs for `y.test` and for another org id. `ssoDomainKey` of the same input gives the same bytes.
2. Fake DNS returns `[["ea-sso=", "<token>"]]` for `_ea-sso.x.test`: `verified`; row `dns`; one audit row. Again: `already`, no row.
3. Fake DNS returns `["ea-sso=wrong"]`, or throws `ENOTFOUND`: `not_found_in_dns`; nothing written.
4. Attest with `--confirm x.test`: `attested`, row `attested`; `--confirm y.test`: `confirm_mismatch`.
5. After a `boundary` set (stage 07), the proof is gone and show prints the `txt` line with the token of the new domain.
6. Require on with nothing set: `refused` with `no_provider`, `flag_off`, `no_break_glass`.
7. Provider proved, flag on, break-glass owner Olaf with TOTP, member Bob `bob@y.test`: `refused` `off_domain_members` with Bob's id; after Bob's e-mail moves to `x.test` (SQL): `changed`, one `sso.required_changed`.
8. Olaf with TOTP off: `refused` `no_break_glass`.
9. `FEATURES_OFF=sso_sign_in`: `refused` `flag_off`.
10. Off: `changed`; again: `unchanged`.
11. Show prints no token after the proof, and never the secret.

**Check.** The Proof of `plan.md` (`/tmp/f119-s08`).

**Done when.** The eleven tests pass; Proof prints `PROOF_OK`.

**Out of scope.** A DNS check in CI against a real resolver; the console (stage 10).
