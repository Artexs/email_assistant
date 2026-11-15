# F117 stage 08 review (Opus): result PASS, test gaps fixed, notes kept

Source: `.limen/jobs/2026-11-15-f117-review-s08-opus-oauth-callb-0039ad10/result`. Reviewed commit 9df6f936. No blocking finding.

## Fixed in the fix job

- TG1: Microsoft `tid` must be a GUID and equal the tenant segment of `iss` (parsed path segment). Before, `iss.includes("/<tid>/")` also matched the host segment (`tid` = `login.microsoftonline.com`). Test 7 has the case. Mutation g1c (old check, no GUID test) fails test 7.
- TG2: the address rule is now the `addressSchema` rule of `@ea/core` (html5 pattern and `.max(254)`; that schema is not exported, so `callback.ts` repeats it). Test 7b has a 294-character address. Mutation g2 (no max) fails 7b.
- N3: the Microsoft mail scope is accepted as the short form `IMAP.AccessAsUser.All` or the full form on `outlook.office.com` or `outlook.office365.com`. This is a subset of the stage text ("ends with"). Test 6: `https://evil.test/IMAP.AccessAsUser.All` refused, the `office365.com` form accepted. Mutation g3 (any host) fails test 6.
- Logs: `/tmp/f117-s08b/` (`envi.log`, `mut-*.log`, `mut-summary.log`).

## Carry-over written

- N1, N2, N5 go to `stages/stage-09-connect-reconnect.md` (§ Carry-over from the stage 08 review).
- U1 goes to stages 01, 02 and 21 (same heading).

## Notes left open

- N1 Login CSRF: safe in stage 08 (consume filters user, organization, provider). Holds only if stage 09 passes the session user and organization. Written to stage 09.
- N2 The stage 09 route cannot sit behind `requireSession` (401 JSON, not 303). Public route, `PUBLIC_ROUTES`, own tenant scope, apiDoc or `HIDDEN_ROUTES`. Written to stage 09.
- N4 No ID token signature check (D12, Q8): acceptable by OIDC Core §3.1.3.7 rule 6 (token from the token endpoint over TLS; constant https URLs; `redirect: "error"`). No nonce (code flow with PKCE). An audience list passes without an `azp` check.
- N5 The Microsoft `email` claim is not verified ("nOAuth"). The stage 09 login test with `user = grant.address` binds the address to the account. M12 decides the claim order.
- N6 A Reconnect mailbox removed during the redeem gives `oauth_failed`. The `org_id` filter in `getMailbox` is an equivalent mutant (composite FK plus the consume filter). The callback does not check `oauth_provider` of the Reconnect mailbox again; `createOAuthState` did.
- N7 `token_type` is not checked in `parseAnswer` (stage 06). Harmless. Idea for stage 10.
- N8 A non-OAuth exception from `redeemCode` becomes `oauth_failed`, and only the refusal line is logged. This keeps D18, but a programming error is hard to see.
- N9 `clientId` on `MailOAuthClient` and the `claims` override in the fake: harmless (public id; tests only).
- N10 The first mutation logs of `/tmp/f117-s08` predate commit 9df6f936 (m21 "PATTERN MISSING"). The reviewer re-ran all at the candidate: 28 killed.
- U1 Microsoft may return no `id_token` when the redeem sends `scope` without `openid`. Unverified offline. Rows M2 and M12 and stage 21 must record it (written to stages 01, 02, 21).
