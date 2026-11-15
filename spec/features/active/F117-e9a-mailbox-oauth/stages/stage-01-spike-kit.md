# F117 stage 01 — Spike kit for the real Microsoft and Google accounts

Part of [`../plan.md`](../plan.md). `[risky]` (real system, tokens). The owner runs the kit in step U1; this job builds and tests it.

## Step 01.1 — Probe CLI

**Goal.** Per account: consent in the owner's browser, the rows below on the real mailbox, a result file without secrets.

**Files.** `tools/mail-oauth-spike/` (new; stage 19 deletes it): `probe.ts`, `rows.ts`, `redact.ts`, `redact.test.ts`, `README.md`; no `package.json` (`tools/*` is a workspace glob: it would change `bun.lock`). Use `imapflow`, `nodemailer`, `fetch` directly.

**Interface.**
- `bun tools/mail-oauth-spike/probe.ts <microsoft|microsoft-personal|google> --out <file>`.
- Env (the owner's shell only): `SPIKE_MS_CLIENT_ID`, `SPIKE_MS_CLIENT_SECRET` (optional: public client), `SPIKE_GOOGLE_CLIENT_ID`, `SPIKE_GOOGLE_CLIENT_SECRET`, `SPIKE_OWNER_ADDRESS` (the only send target).
- Redirect `http://localhost:8765/callback` on a one-shot `Bun.serve`; PKCE S256; random `state` checked.
- Output JSON: `{ provider, ranAt, rows: [{ id, verdict: "PASS"|"FAIL"|"SKIP", evidence: string }] }`. Evidence: capabilities, folder names, HTTP status, error codes, scope strings, booleans, counts; never an address (`<owner>`). Manual rows ask `y/n/skip`.

**Rows.** Microsoft business tenant (`microsoft`):

- **M1** Consent screen kind (user or admin); the error code if refused
- **M2** One authorize call with the IMAP and `Mail.Send` scopes; the code redeems for IMAP, the refresh token for Graph; the raw granted `scope` strings
- **M3** Gate: OAuth IMAP login works with security defaults on (owner confirms the setting)
- **M4** `CAPABILITY`; `LIST` with special-use flags
- **M5** Create `AI/Spike`; APPEND a test mail to INBOX; `UID MOVE` gives COPYUID
- **M6** APPEND to Drafts: editable in Outlook on the web; a reply draft with `In-Reply-To`, `References` sits in the thread (manual)
- **M7** APPEND to INBOX shows as unread new mail (manual)
- **M8** `IDLE` starts and ends within 5 s
- **M9** SMTP XOAUTH2 to `smtp.office365.com:587`: the reply code (expected `5.7.139`)
- **M10** Graph `sendMail` MIME to the `+ea-spike` plus address of `<owner>`: 202, it arrives; Sent Items copy by `SEARCH HEADER Message-ID` within 60 s; Message-ID and `X-EA-Action-Id` unchanged; `Bcc` delivered (manual); the size limit (docs)
- **M11** Refresh rotates the refresh token; the old one still redeems after it
- **M12** Which ID-token claim (`email`, `preferred_username`) equals the IMAP login user
- **M13** Error codes: a garbage refresh token; after removal in My Apps (optional)
- **M14** `…/organizations/v2.0/adminconsent` works for the owner as admin; its redirect query names

Personal account (`microsoft-personal`): **P1** `common` consent, IMAP login, Graph `sendMail` 202.

Google (`google`, testing mode):

- **G1** Unverified-app screen; the raw granted `scope` string; a refresh token comes back
- **G2** Gate: IMAP XOAUTH2 login; `CAPABILITY` (SPECIAL-USE, MOVE, UIDPLUS); `LIST`
- **G3** `UID MOVE` INBOX → `AI/Spike`: the mail leaves INBOX; the count in `[Gmail]/All Mail`
- **G4** APPEND to `[Gmail]/Drafts`, then UID EXPUNGE it; a reply draft sits in the thread (manual)
- **G5** SMTP XOAUTH2 on `smtp.gmail.com:465` to the `+ea-spike` plus address of `<owner>`, it arrives; one copy in `[Gmail]/Sent Mail` with the same Message-ID
- **G6** Refresh rotates or not; revoke answers 200; then refresh gives `invalid_grant`
- **G7** App-password IMAP login, typed at a hidden prompt (optional)

**Decisions.** D9, D12, D18. A FAIL gets no workaround.

**Test** (`bun test tools/mail-oauth-spike`, unit):
1. `redact` throws for evidence that holds `eyJ`, `ya29.`, `1//`, `M.C`, `EwB`, 40 or more base64url characters in a run, or an `@` address.
2. `redact` accepts `AUTH=XOAUTH2 UIDPLUS MOVE`, `AADSTS65001`, `202`, `Sent Items`.
3. One bad row → no file, exit 1.
4. The callback server refuses a wrong `state` (400), stops after one good one.

**Owner runbook** (in `README.md`; this is U1):
1. Buy one Microsoft 365 Business Basic seat (PD-090). Check that security defaults are on.
2. Entra: a multi-tenant app ("any organization and personal accounts"), platform Web, redirect `http://localhost:8765/callback` (refused → "Mobile and desktop", no secret); delegated `offline_access`, `openid`, `email`, `profile`, Exchange Online `IMAP.AccessAsUser.All`, Graph `Mail.Send`; a client secret.
3. Google Cloud: consent screen "External", testing mode, test user = the owner's Gmail; a web client with the same redirect.
4. Run the three probes; answer the prompts; leave the files as `spike-result-<provider>.json` in the ticket folder.

**Check.** `bun test tools/mail-oauth-spike` and the plan Proof.

**Done when.** The kit, its tests and the runbook are committed; the Proof prints `PROOF_OK`.

**Out of scope.** A real run; product code.

## Carry-over from the stage 08 review

Source: `review-8.md` (U1).

- **ID token at the code redeem.** `redeemCode` sends `scope` = the mail resource scopes only (IMAP and `offline_access`), with no `openid`. It was not checked whether Microsoft then returns an `id_token`. If it does not, `finishOAuthCallback` refuses every Microsoft connect with `oauth_failed` (no ID token, no address). Record in the rows M2 and M12: does the redeem answer hold `id_token`? Which claims does it hold (`email`, `preferred_username`, `tid`, `aud`, `iss`)? If no `id_token` comes, the fix is to add `openid email profile` to the `scope` of `redeemCode`, or to read the address another way: a stage 06/08 refresh job.
