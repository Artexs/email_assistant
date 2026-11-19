# F119 plan refresh 1 — after the spike

Part of [`plan.md`](plan.md). Job `2026-11-14-f119-refresh-after-the-spike-app-849ab506`, 2026-11-14.

- Old base: `69473f4e` (plan written). New base: `4f653db8` (HEAD: `F119 stage 01: spike result`).
- Input: [`spike.md`](spike.md) (S1–S10 all PASS, findings C1–C5) and the coordinator task "apply C1–C5, decide G1, keep the size limits".

## Drift

`scripts/plan-drift.sh spec/features/active/F119-e7-t7-identity-b-oidc 69473f4e`:

```
plan base: 69473f4e 2026-11-14 20:57
HEAD:      4f653db8 2026-11-14 22:01
named paths: 27; changed since base: 1; gone: 0
changed: deploy/README.md
commits after the base that touch the named paths:
  c5334c40 11-14 21:43 deploy README: export folder owner, run with the host user ids (found at the F106 VPS check)
```

`c5334c40` changes one line of the `org:export` section of `deploy/README.md` (run the export with the host user ids). Stage 13 adds a new section "Company sign-in" to the same file. No stage text depends on the changed line: no change.

## Changes

| Finding | Stage / file | Change | Why |
| ------- | ------------ | ------ | --- |
| C1 | plan D18 (new), D4, D17 | The issuer CHECK allows `^https://` or exactly `^http://127\.0\.0\.1:[0-9]{1,5}$`. D17 names the fake IdP origin. | The fake IdP serves plain http on loopback; the old CHECK refused it (`s2-issuer-check.log`). |
| C1 | stage 02 | New CHECK in the `sso_providers` shape; test 2 adds `http://127.0.0.1`, `http://127.0.0.1:4000/x`, `http://localhost:4000`, `http://10.0.0.1:4000` refused and `http://127.0.0.1:4000` accepted. The "read spike.md first; stop and ask" line is gone (all PASS). | Fix the conflict between stages 02 and 03; pin the exact allowance. |
| C1 | stage 03 | The fake IdP interface names its issuer `http://127.0.0.1:<port>` and cites D18. | Interface between stages 02 and 03. |
| C2 | stage 05 | `ctx.path` is the route template `/sso/callback/:providerId`; match with `startsWith("/sso/callback/")`, never an exact path. | S4 trace. |
| C3 | plan D10; stage 07 | `discoverProviderConfig` gets `lookup?` (default `dns.lookup(host, { all: true })`). Outside `allowOrigins` it resolves the issuer host before discovery and each endpoint host after it. An address outside global unicast (IANA special-purpose ranges, IPv4-mapped forms too) → `discovery_private_host`; a lookup error → `discovery_dns_failed`. Test 8 adds fake-lookup cases (loopback, IPv4-mapped link-local, a mixed answer, a public answer, a private `jwks_uri` host). | Our predicate makes the plugin skip `assertEndpointResolvesPublic`, so a DNS name that points to a private address passed (`S9 dns_to_loopback`). |
| C3 | plan D10 | A DNS change between our check and the discovery fetch (rebinding) is accepted. | Only the operator types the URL, the request is a GET, and sign-in fetches keep the plugin's full check (Better Auth `trustedOrigins` lists no IdP). |
| C4 | stage 03 | Test 10 expects `error=state_mismatch` (was `invalid_state`) and a new `BETTER_AUTH_REASONS` entry, so the log reason is `state_mismatch`, not `other`. Test 8 captures stdout and stderr: `better-call` writes a 500 with `console.error("# SERVER_ERROR: ", error)`. A note: no SSO test asserts the cookie `Max-Age`. | S3 log; `better-call/dist/router.mjs:93`; `cookie_max_age=2592000` in S5. |
| C4 | stage 05 | The same cookie `Max-Age` note under the tests. | The stage 05 tests check the session row, not the cookie. |
| C5 | plan D4; stage 02 | Grants for `app` include `UPDATE`; test 9 adds: with no `app.org_id`, `app` runs `UPDATE sso_providers SET provider_id = provider_id`. | The plugin locks the provider row with that `UPDATE` as the Better Auth role (`lockSSOProviderRow`). |
| C5 | stage 04 | The adapter never answers the plugin `continue`. | With `requestSignUp: true`, `continue` makes a user (`S9 contrast_continue_request_sign_up`). |
| C5 | stage 05 | The create hook sets both `signInMethod` and `ssoStartedAt` from the current session. | The hook data on `verify-totp` and `/two-factor/disable` already has `ssoStartedAt` but `signInMethod: "password"` (`s4b.log`). |
| G1 | plan § Owner checkpoints, § Stages, § How to run, status line; stage 01 header; ticket.md § Slices (the stop clause becomes a pointer to plan.md; no progress marker in the ticket body) | "G1: passed by the coordinator on 2026-11-14 from spike.md; the owner can change Q1 (secret storage) before stage 03." Stage 02 needs stage 01, not G1. The "stop after stage 01" step is gone. | Owner order: owner checkpoints are not a stop. S1–S10 PASS and no decision D1–D17 broke. |
| Q1, Q10 | questions.md | Q1: G1 passed with the default; option (b) needs a probe before stage 03 if the owner picks it. Q10: the S10 input (a free Azure account may be enough for F119 alone; F117 still needs the seat). Both defaults stay. | Keep both as owner decisions with defaults. |
| size | plan.md, stages 02, 03, 04, 07 | Shorter wording elsewhere in the same files. The first pass also removed two stage 07 predicate cases (`https://127.0.0.1`, `https://169.254.169.254`); review 2 (N3) found it, and the new stage 07 test 7 has them again. The stage table of `plan.md` became a list (the same fields). | Lean-plan limits: plan ≤1,500 words, stage ≤700. |

## D18 in full (C1: the issuer CHECK)

Decision: `issuer ~ '^https://' OR issuer ~ '^http://127\.0\.0\.1:[0-9]{1,5}$'` in the migration.

Why it is safe in production:

1. The CHECK is a shape guard. The URLs that the plugin fetches are the endpoints in `oidc_config`, and the CHECK does not cover them. The real protection for fetches is elsewhere.
2. Sign-in fetches refuse a loopback host that is not in Better Auth `trustedOrigins` (F6, `assertEndpointResolvesPublic`). Production lists no IdP origin there. A loopback row fails closed: no session.
3. `org:sso --set` refuses an IP literal (stage 07 predicate), a DNS name with a private answer (C3), and an `http:` issuer whose origin is not in `allowOrigins`; the script entry leaves `allowOrigins` empty and nothing sets it (stage 08, review 2 B1). Only a direct DB write can make such a row, and that writer can change any row anyway.
4. Dependency (review 2): Better Auth `trustedOrigins` (`WEB_TRUSTED_ORIGINS`) must list no loopback origin on the VPS. `.env.example` ships loopback origins for local work; `deploy/README.md` says to empty the key. Stage 15 check 9 proves it.

Rejected:

- A TLS fake IdP (`https://127.0.0.1:<port>`): `node:crypto` makes no X.509 certificate, so it needs `openssl` or a new dependency, and Better Auth's own fetch would need TLS checks off (or an extra CA at process start) in every SSO test.
- A test setup that drops and re-adds the CHECK: the tests then run against another schema than production, the `app` role cannot alter the table, and DDL in parallel integration test files on one checkout DB races.

## Facts checked, no change needed

- `betterAuthLogReason` and `BETTER_AUTH_REASONS` exist in `apps/server/src/platform/auth.ts` (stage 03 adds one entry).
- The `tenant_rows` policy of `20261114100002_rls_tenant_policies.sql` admits every row when `app.org_id` is unset, as C5 says.
- Stage 11 `ssoErrorText` maps unknown codes, so `state_mismatch`, to `login_sso_error_generic`: no text change.
- Stage 07 lock order (organization, then provider row `FOR UPDATE`) agrees with the plugin's own row lock (C5): a removal waits for a callback in flight.
- The `accountKey.issuer` and `verifiedIdTokenClaims` shape (C5) agrees with stage 03 `SsoIdentity`.
- D16 "discovery and DNS run before the transaction" also covers the C3 lookups.

## Cold review 2 and what it changed

Review: [plan-review-2.md](plan-review-2.md) (job `2026-11-14-f119-plan-review-2-7441239e`, `claude-opus-5-5`, candidate `6222d69d`). Model reason: `[risky]` auth, migration and security stages. Verdict FAIL, 1 blocking, 8 notes. It confirmed D18 (safe in production) and C3 (complete for the discovery fetch) from the plugin source.

| Finding | Disposition | Where |
| ------- | ----------- | ----- |
| B1 the CLI refuses the `http:` fake IdP, and no interface brings `allowOrigins` into the CLI | Fixed. `runOrgSso(argv, deps)` runs in-process in tests; the script entry passes `allowOrigins: []`; nothing in env or argv sets it. The parser accepts `http:` only for an origin in `allowOrigins`. Tests: args with empty and with set `allowOrigins`; the real entry refuses the fake IdP. The added text did not fit in stage 07 (700 words), so stage 07 became two stages (below). | stage 08 (new) |
| N1 which address ranges | Fixed. Reuse the mail guard `isLocalAddress`, `LookupAll`, `dnsLookupAll`; they move to `platform/net-address.ts` (`platform/` imports no module). NAT64 case in the test. | stage 07 step 07.1, test 8 |
| N2 no test for `discovery_dns_failed` | Fixed: `ENOTFOUND` case. The check is a named function, `checkPublicHosts`, so its test makes no network call. | stage 07 test 8 |
| N3 two predicate cases lost | Fixed: back in test 7, plus `https://localhost.` (trailing dot) and `https://[::1]`. | stage 07 test 7 |
| N4 `state_mismatch` reason label covers every state failure | Fixed: the reason is `oauth_state_failed` for the message start `Failed to parse state`, with a `docs/known-alerts.md` row. | stage 03 test 10 |
| N5 `/two-factor/disable` untested | Fixed: third run in test 5. | stage 05 test 5 |
| N6 G1 by the coordinator differs from 05-execution-plan §2.4; no owner-decisions entry | The coordinator's order decides G1 for this job. Recorded as Q11 `[important: rule-exception]` for `docs/owner-decisions.md` (the coordinator writes it). | questions.md Q11 |
| N7 D18 cites D10 for the IP-literal rule | Fixed: D18 cites stages 07–08. | plan D18 |
| (plausible) `trustedOrigins` must hold no loopback origin | Fixed: D18 names the dependency; stage 15 check 9 reads `WEB_TRUSTED_ORIGINS` on the VPS. | plan D18; stage 15 |
| N8 size | Fixed: stage 07 split; counts in `plan.md` § Planning progress. | plan.md |

### Stage split and new numbers

Old stage 07 (`org:sso`: show, set, remove) became:

- new 07 `stage-07-sso-provider-service.md`: the address guard move, discovery with the DNS check, `buildOidcConfig`, `getSsoState`, `setSsoProvider`, `removeSsoProvider`, `platform/auth-sessions-end.ts`. Tests at service level. Needs 04.
- new 08 `stage-08-org-sso-cli.md`: `runOrgSso`, the argument parser, show, set, remove. Needs 07.

Old stages 08–15 are now 09–16 (file names, titles, step numbers, `/tmp/f119-sNN`, and every cross reference in `plan.md`, `ticket.md`, `questions.md` and the stage files). `spike.md`, `plan-review-*.md` and stage 01 keep the old numbers: they are records. The F105 references (`stage 15 deployed`, F105's `stages/stage-15-vps.md`) did not change. Old stage 08 (domain proof, now 09) needs 06 and 08, and its `resolveTxt` is a `runOrgSso` dep. Old stage 09 (`org:member`, now 10) still needs 05 and 07.

