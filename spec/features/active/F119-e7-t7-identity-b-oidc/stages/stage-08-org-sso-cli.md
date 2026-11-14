# F119 stage 08 — `org:sso` CLI: show, set, remove

Part of [`../plan.md`](../plan.md). `[risky]` (security). Needs stage 07; may run next to 05–06.

## Step 08.1 — An in-process runner and the commands

**Goal.** PD-041: the operator sets, shows and removes a provider. Tests reach the fake IdP (`http://127.0.0.1:<port>`, D17, D18) without a switch that also exists in production (cold review 2, B1).

**Interfaces.**
- `apps/server/src/scripts/org-sso.ts` exports `runOrgSso(argv: string[], deps: OrgSsoDeps): Promise<number>` (the exit code). `OrgSsoDeps = { db, readStdinLine: () => Promise<string>, out: (line: string) => void, err: (line: string) => void, allowOrigins: readonly string[], lookup: LookupAll, now: () => Date }`. Stage 09 adds `resolveTxt` and the domain key. Tests call `runOrgSso` in-process.
- The file's `import.meta.main` entry builds the deps from config, with `allowOrigins: []` and `dnsLookupAll`. No env key, flag or argument sets `allowOrigins`.
- `parseOrgSsoArgs(argv, { allowOrigins })` (`org-sso-args.ts`, pure): `--issuer` must be `https:`, or `http:` with an origin in `allowOrigins`. Else usage, exit 1.
- `--org-id <uuid>` alone: show `provider`, `issuer <host>`, `domain <d> <proof|unproved>`, `required <yes|no>`, `flag sso_sign_in <on|off>`, `break-glass <ready|missing>`, `linked <n>`, `redirect <WEB_BASE_URL>/api/auth/sso/callback/<id>`; or `no provider`. Stage 09 adds the `txt` line. Data from `getSsoState`.
- `--set --issuer <url> --domain <d> --client-id <id> --client-secret-stdin`: one stdin line, trimmed (empty → exit 1 `client_secret_missing`). No `--client-secret <value>` (D10). It calls `discoverProviderConfig` (with `deps.allowOrigins`, `deps.lookup`), `buildOidcConfig`, then `setSsoProvider`. Prints the kind and the redirect line.
- `--remove --confirm <domain>` (`confirm_mismatch`, exit 1), then `removeSsoProvider`; prints the kind and the counts.
- Domains are trimmed, lower-cased and checked as in stage 02 (`bad_domain`). A discovery failure: exit 1 `discovery_failed <code>`, nothing written. Errors are event lines, never the secret or the config.

**Decisions.** D10, D15, D18.

**Test** (`org-sso.test.ts` integration, `org-sso-args.test.ts` unit; the fake IdP; `allowOrigins: [fake.origin]` unless named):

1. Args unit: no `--org-id`, `--set` without `--issuer`, `--client-secret foo`, two commands, `--issuer http://idp.x.test`: usage, exit 1. `--issuer http://127.0.0.1:4000` with `allowOrigins: []`: exit 1; with `["http://127.0.0.1:4000"]`: parsed.
2. The real entry (`Bun.spawn` of `bun run org:sso … --set --issuer <fake.issuer> --client-secret-stdin`, the secret on stdin): exit 1, usage, no row.
3. Set on org A: stdout `new` and `redirect <WEB_BASE_URL>/api/auth/sso/callback/<org A id>`; again: `unchanged`.
4. Show for org A: the eight lines (`domain x.test unproved`, `required no`, `linked 0`, …). Org B: `no provider`.
5. Secret `s3cret-value-1\n` on stdin: in `oidc_config`; not in `out` or `err` of set and show, logs or audit `data`; show prints no `clientSecret`. Empty stdin: exit 1 `client_secret_missing`, no row.
6. `--remove --confirm y.test`: exit 1 `confirm_mismatch`, the row stays. `--confirm " X.TEST "`: `removed` and the counts; again: `none`.
7. `--domain x..test`: exit 1 `bad_domain`. A stopped fake IdP: exit 1 `discovery_failed <code>`, no row. Issuer `https://idp.x.test` with `lookup` → `10.0.0.1`: `discovery_failed discovery_private_host`, no row.
8. Log capture over 1–7: no client secret, no `oidc_config`, in every line.

**Check.** `plan.md` § Proof (`/tmp/f119-s08`).

**Done when.** The eight tests pass; `bun run org:sso` exists in `package.json`; `PROOF_OK`.

**Out of scope.** Proof, attestation, require (stage 09); the console (stage 11).
