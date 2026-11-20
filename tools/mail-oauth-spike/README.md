# Mail OAuth spike kit (F117 stage 01)

This kit asks the real Microsoft 365 and Google servers the questions that the docs do not answer.
It runs on the owner's machine with the owner's test accounts.
It is temporary: stage 19 of F117 deletes it.
When the kit is deleted, remove `tools/mail-oauth-spike` from the `test:unit` path list in the root `package.json` and from `scripts/check-job.sh` too. A path to a missing folder fails the suite.

The kit has no `package.json` on purpose. `tools/*` is a workspace glob, and a `package.json` here would change `bun.lock`.
It uses `imapflow` and `nodemailer` from the root `node_modules`, and `fetch`.

**Status.** The unit tests use fakes. No test calls a real Microsoft or Google server, and nobody ran the kit against one yet.
A local GreenMail run checked the IMAP steps (APPEND, UID MOVE, IDLE, UID EXPUNGE, `SEARCH HEADER Message-ID`).
These facts are still unproven until U1 runs: the one authorize call with two resources, the `adminconsent` request, and Bcc in a Graph MIME mail.
A FAIL in the result is a finding. Do not work around it (decisions D9, D12, D18 of the plan).

## What the probe does

```
bun tools/mail-oauth-spike/probe.ts <microsoft|microsoft-personal|google> --out <file>
```

1. It starts a one-shot server on `http://localhost:8765/callback` and prints a consent URL (PKCE S256, random `state`).
2. You open the URL in your browser and sign in with the test account.
3. It runs the rows below in order. A manual row asks `y`, `n` or `skip`.
4. It writes one JSON file: `{ provider, ranAt, rows: [{ id, verdict, evidence }] }`.

Every evidence string passes a guard before it is shown or saved. The guard refuses a token shape (`eyJ`, `ya29.`, `1//`, `M.C`, `EwB`), a run of 40 or more base64url characters and any `@`.
One refused row means **no file and exit code 1**. The screen names the row and the rule, never the text. Tell the coordinator, and do not edit the guard.
Evidence holds capabilities, folder names, HTTP status, error codes, scope strings, booleans and counts. An address shows as `<owner>`.

The tokens stay in memory. The probe never prints a token, a code or the client secret.

## Environment (your shell only)

| Variable                     | Meaning                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `SPIKE_MS_CLIENT_ID`         | Application (client) ID of the Entra app.                                                                       |
| `SPIKE_MS_CLIENT_SECRET`     | Client secret. Optional: leave it unset for a public client ("Mobile and desktop").                             |
| `SPIKE_GOOGLE_CLIENT_ID`     | Client ID of the Google web client.                                                                             |
| `SPIKE_GOOGLE_CLIENT_SECRET` | Client secret of the Google web client.                                                                         |
| `SPIKE_OWNER_ADDRESS`        | The only send target. The probe sends to `name+ea-spike@domain` and `name+ea-spike-bcc@domain` of this address. |

Set `SPIKE_OWNER_ADDRESS` to the address of the account that you test in this run.
When it equals the signed-in mailbox, the probe checks the arrival of the test mail itself. Otherwise it asks you.
Do not put a secret in a file, a command history line you share, or a ticket. Use `read -s` or your own secret store.

## Owner runbook (U1)

1. Buy one Microsoft 365 Business Basic seat (PD-090). In Entra, check that security defaults are on.
2. In Entra, register a multi-tenant app ("any organization and personal accounts"). Use the platform "Web" and the redirect `http://localhost:8765/callback`.
   If Entra refuses a `localhost` Web redirect, use "Mobile and desktop" instead and create no secret.
   Add these delegated permissions: `offline_access`, `openid`, `email`, `profile`, Exchange Online `IMAP.AccessAsUser.All`, Microsoft Graph `Mail.Send`.
   Create a client secret (Web platform only).
3. In Google Cloud, set the consent screen to "External" in testing mode. Add your Gmail address as the test user.
   Create an OAuth client of type "Web application" with the same redirect `http://localhost:8765/callback`.
4. Run the three probes. Answer the prompts. Save each file as `spike-result-<provider>.json` in `spec/features/active/F117-e9a-mailbox-oauth/`:

```
bun tools/mail-oauth-spike/probe.ts microsoft          --out spec/features/active/F117-e9a-mailbox-oauth/spike-result-microsoft.json
bun tools/mail-oauth-spike/probe.ts microsoft-personal --out spec/features/active/F117-e9a-mailbox-oauth/spike-result-microsoft-personal.json
bun tools/mail-oauth-spike/probe.ts google             --out spec/features/active/F117-e9a-mailbox-oauth/spike-result-google.json
```

Then tell the coordinator. The coordinator commits the files. Stage 02 reads them.
Read each file once before you hand it over. It must hold no token and no address.

## Rows

Microsoft business tenant (`microsoft`):

| Row | Question                                                                                                                                                                                                                                                  | Manual part                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| M1  | Consent screen kind (user or admin); the error code if refused.                                                                                                                                                                                           | Which screen you saw.                                               |
| M2  | One authorize call with the IMAP and `Mail.Send` scopes. The code redeems for IMAP, the refresh token for Graph. The raw granted `scope` strings.                                                                                                         |                                                                     |
| M3  | Gate: OAuth IMAP login works with security defaults on.                                                                                                                                                                                                   | You confirm the setting.                                            |
| M4  | `CAPABILITY`; `LIST` with special-use flags.                                                                                                                                                                                                              |                                                                     |
| M5  | Create `AI/Spike`; APPEND a test mail to INBOX; `UID MOVE` gives COPYUID.                                                                                                                                                                                 |                                                                     |
| M6  | APPEND to Drafts: editable in Outlook on the web; a reply draft sits in the thread.                                                                                                                                                                       | You look in Outlook.                                                |
| M7  | APPEND to INBOX shows as unread new mail.                                                                                                                                                                                                                 | You look in Outlook.                                                |
| M8  | `IDLE` starts and ends within 5 s.                                                                                                                                                                                                                        |                                                                     |
| M9  | SMTP XOAUTH2 to `smtp.office365.com:587`: the reply code (expected `5.7.139`).                                                                                                                                                                            |                                                                     |
| M10 | Graph `sendMail` with a MIME body to the `+ea-spike` address: 202, it arrives. Sent Items copy by `SEARCH HEADER Message-ID` within 60 s. Message-ID and `X-EA-Action-Id` unchanged. Bcc delivered. The size limit comes from the docs, not from a probe. | Bcc arrival (and arrival, if the owner address is not the mailbox). |
| M11 | Refresh rotates the refresh token; the old one still redeems after it.                                                                                                                                                                                    |                                                                     |
| M12 | Which ID-token claim (`email`, `preferred_username`) equals the IMAP login user.                                                                                                                                                                          |                                                                     |
| M13 | Error codes: a garbage refresh token; after removal in My Apps (optional).                                                                                                                                                                                | The removal step: it ends the grant.                                |
| M14 | `https://login.microsoftonline.com/organizations/v2.0/adminconsent` works for you as admin; the names of its redirect query.                                                                                                                              | You approve as admin.                                               |

Personal account (`microsoft-personal`): **P1** `common` consent, IMAP login, Graph `sendMail` 202.

Google in testing mode (`google`):

| Row | Question                                                                                                                               | Manual part                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| G1  | The unverified-app screen; the raw granted `scope` string; a refresh token comes back.                                                 | You say if you saw the screen.                     |
| G2  | Gate: IMAP XOAUTH2 login; `CAPABILITY` (SPECIAL-USE, MOVE, UIDPLUS); `LIST`.                                                           |                                                    |
| G3  | `UID MOVE` INBOX to `AI/Spike`: the mail leaves INBOX; the count in `[Gmail]/All Mail`.                                                |                                                    |
| G4  | APPEND to `[Gmail]/Drafts`, then UID EXPUNGE it. A reply draft sits in the thread.                                                     | You look in Gmail.                                 |
| G5  | SMTP XOAUTH2 on `smtp.gmail.com:465` to the `+ea-spike` address: it arrives. One copy in `[Gmail]/Sent Mail` with the same Message-ID. | Arrival (if the owner address is not the mailbox). |
| G6  | Refresh rotates or not. Revoke answers 200. Then refresh gives `invalid_grant`. It ends the grant.                                     |                                                    |
| G7  | App-password IMAP login, typed at a hidden prompt (optional).                                                                          | You type the password.                             |

A verdict is `PASS`, `FAIL` or `SKIP`. A `SKIP` means a missing earlier step or a skipped prompt. The evidence says which.

## After the run

- The probe leaves the folder `AI/Spike` and a few test mails (subjects start with `EA spike`). Delete them by hand when you want.
- M13 (removal) and G6 (revoke) end the grant. Run the probe again for a new grant.
- The probe listens on port 8765 of both `127.0.0.1` and `::1`. If either address is taken, the first row fails with a bind error code and no consent URL shows.
- Run a probe again for one provider only if the coordinator asks. Each run asks for a new consent.
