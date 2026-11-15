# F117 stage 14 — Microsoft: admin consent link and the spike facts

Part of [`../plan.md`](../plan.md). Needs stage 02 and gate G1 (row M3 PASS), and stages 10 and 13. Read `spike.md` first: its "Plan changes" list may name this stage.

## Step 14.1 — Admin consent link

**Goal.** When a work tenant needs admin approval, the owner gets a link to forward to their administrator (PD-088, notes §5).

**Interface.** `GET /api/mailboxes/oauth/microsoft/admin-consent` (owner) → `200 { url: string; scopes: Array<"profile" | "offline" | "imap" | "send"> }`; Microsoft not configured → `409 not_configured`.

**Rules.**
- `url` = `https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=<id>&scope=<IMAP and Mail.Send scopes, space-separated>&redirect_uri=<WEB_BASE_URL>/mailboxes/admin-consent&state=<16 random bytes>`. The authority comes from the registry (tests inject the fake). Spike M14 confirms the form.
- No state row: the result page changes nothing, and the admin is not our user. Rejected: a stored state.
- The panel page `/mailboxes/admin-consent` (stage 17) only shows "approved" or "not approved" from the query (`admin_consent=True` or `error`).
- The panel is tailnet-only (ADR 0017): an administrator outside it sees a browser error after the approval; the approval is still done. Stage 17's text says so (Q4).
- Register both redirect URIs in the app (docs, stage 19): the callback and this page.

## Step 14.2 — Spike facts for Microsoft

From `spike.md` (defaults in brackets, used when the row passed as expected):
- **Folders (M4).** Exchange has no SPECIAL-USE [R1]. imapflow 1.7.8 maps `Sent Items`, `Deleted Items`, `Junk Email` and `Junk E-mail` by name (`lib/special-use.js`). Add a test of `buildFolderMap` with the folder list of M4 that gives Drafts, Sent, Trash and Junk.
- **Address claim (M12).** Set the order in stage 08's address rule to the one that M12 found [`email`, then `preferred_username`].
- **Error codes (M1, M13, M14).** Add each AADSTS code that the spike saw and stage 06 does not list, with its reason, to the stage 06 map and its test.
- **Personal accounts (P1).** A `tid` of `9188040d-6c67-4c5b-b112-36a304b66dad` is a personal account: same hosts and Graph route. If P1 failed, the start route refuses personal accounts: add `domain_hint=organizations` and say so in the final message.
- **Rotation (M11).** If the old refresh token did not redeem after a rotation, write it in the final message; stage 10's crash rule then costs one Reconnect (no code change).

**Decisions.** D10, D12, D17.

**Test** (integration, fake token server):
1. Owner `GET …/admin-consent` → the URL has the client id, `organizations`, both scopes and the redirect `<WEB_BASE_URL>/mailboxes/admin-consent`; no client secret.
2. A member → `403 owner_only`; Microsoft keys missing → `409 not_configured`.
3. `buildFolderMap` with the M4 list → the four keys.
4. Each AADSTS code added from the spike → its reason.
5. A Microsoft connect with the consumer `tid` → `connected`, `send_via = 'graph'`.

**Check.** The Proof.

**Done when.** The tests pass; `spike.md`'s plan-change lines for this stage are done or answered in the final message; the Proof prints `PROOF_OK`.

**Out of scope.** The panel pages (stage 17), the operator doc (stage 19).

## Carry-over from the stage 06 review (2026-11-15)

- Do not compare Graph scopes by name before spike M2 records the raw string (see stage 13).
- The Microsoft redeem sends `scope` = IMAP + `offline_access`, without `openid` (stage 06 `redeemCode`). Check at spike M2 that an `id_token` still comes back; stage 08 needs it. If it does not, add `openid` to `resourceScopes.mail` (the scope check ignores identity names) and update the registry test.
