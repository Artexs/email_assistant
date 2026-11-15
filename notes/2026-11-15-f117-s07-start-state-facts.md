# F117 stage 07: facts for stages 08 to 18

Code: `apps/server/src/modules/mail/oauth/` (`state.ts`, `start.ts`, `routes.ts`, `api-docs.ts`), `packages/core/src/web/mail-oauth.ts`. Tests: `apps/server/test/integration/mail-oauth-start.test.ts`.

## What stage 08 and later call

- `createOAuthState(db, secrets, ctx, { provider, userId, mailboxId }, now)` → `{ state, codeChallenge }`. `consumeOAuthState(db, secrets, ctx, { state, provider, userId }, now)` → `{ ok: true, start, verifier }` or `{ ok: false, code: "oauth_state_invalid" | "oauth_state_expired" }`. Pass the pool, never a caller's transaction: the delete commits before the code redeem.
- `startMailOAuth` and `mailOAuthOptions` (`start.ts`) hold the route logic. Stage 16 reads `GET /api/mailboxes/oauth/options` (`mailOAuthOptionsSchema`) and posts `{}` or `{ mailboxId }` to `POST /api/mailboxes/oauth/:provider/start` (`{ url }`).
- New API error codes `feature_off` (403) and `not_configured` (409) in `@ea/core` `apiErrorCodes`. The web has no text for them yet: stage 16 adds `codeTexts` entries in `apps/web/src/lib/errors.ts` and the texts (en, pl). `oauth_state_invalid` and `oauth_state_expired` are not API codes yet: stage 08 maps them to a redirect result code.
- `apiRouters` takes `WebExtras.mailOAuthClients` (optional). Without it the clients come from the config and the constant registry. A route test passes `createMailOAuthClients(config, { specs: fake.specs(...) })`.

## Binding rules enforced in code

- The table's foreign keys check the user and the organization one by one, not the pair. `createOAuthState` reads the membership (`getMembership`) and throws `OAuthStateRefusedError("not_a_member")` for a user who is not a member of `ctx.orgId`. `consumeOAuthState` checks the membership again after its delete (a member removed between start and callback gets `oauth_state_invalid`; the row is gone either way).
- Membership is checked, not the owner role. The start route is owner only (`requireOwner`). **Stage 08 must check the owner role again at the callback** (a member demoted after the start must not connect).
- A Reconnect state needs an OAuth mailbox of the same provider in the same organization: `createOAuthState` checks it in its transaction (`OAuthStateRefusedError("mailbox_not_found")`); `startMailOAuth` answers 404 first.
- The cap is 5 live rows per user and organization. A transaction advisory lock keyed by organization and user makes two parallel starts safe (mutation m11 fails test 7 three times in three).
- `state` shape check: a value that is not 43 base64url characters answers `oauth_state_invalid` with no DB call (an equivalent mutant: without the check the hash lookup misses anyway).

## D18 facts

- The log field rule (`isLogValue`) accepts a 43-character base64url string in a `code` field. A state would pass it. The only guard is: never log it. The canary test (routes 8) captures `console` lines with `util.format` and checks every state, the verifier and the client secret.
- The start answer holds the state in the URL and has `cache-control: no-store`.
- No audit row is written at start. Stage 09 records `mailbox.connected` / `mailbox.reconnected` at the callback.

## Mutations (each run alone, log in /tmp/f117-s07/mut-<name>.log, source restored)

m01 clear state hash, m02 clear verifier, m03 replay (row reinserted), m04 consume without user filter, m05 without org filter (a user in both organizations), m06 without provider filter, m07 create without membership check, m08 consume without membership check, m09 no expiry check, m10 no cap, m11 no advisory lock (3 runs), m12 fixed AAD, m13 TTL 60 min, m14 Reconnect mailbox without provider filter, m15 without org filter, m16 cap over all users, m17 flag check removed, m18 `requireOwner` removed, m19 Reconnect without provider check, m20 options connect ignores the flag, m21 options reconnect needs the flag, m22 URL logged, m23 verifier logged, m24 error holds the user id, m25 no `cache-control`, m26 unknown provider answers 409, m27 state in an audit row. Each fails at least one test. Script: `/tmp/f117-s07/mut.py` (not committed).
