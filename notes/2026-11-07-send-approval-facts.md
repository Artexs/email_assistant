# S4 send and approval facts (2026-11-07)

Facts that the S4 task (`tasks/active/s4-drafts-approvals-delegation.md`) checked or still must check. A later agent reads this note before it changes the draft, send or approval code.
Sources are named in each line. Interia details: `notes/2026-11-03-interia-imap-capabilities.md`, "Send probe". The probe scripts: `notes/2026-11-07-s4-probes/`.

State of the S4 stages that give facts: stage 1 (Interia probe) done; stage 20 (eval) done with **one gate miss, waits for the user**; stage 19 (dev run) **not done**; stages 22 and 23 (VPS) **not done**.

## Facts checked

### nodemailer 10.3.1 (probes 1, 2 and 4, 2026-11-07, Bun 1.4.4, scripted fake SMTP server)

Source: `node_modules/nodemailer/dist/esm/smtp-connection/index.js` (`_formatError`, `_actionDATA`, `_advanceEnvelope`) and the scripts `probe.ts.txt`, `probe2.ts.txt`, `probe4.ts.txt`.

Every SMTP error has `code`, `command`, and with a server reply `response`, `responseCode` (number) and `permanent` (5xx). The table shows what each failure gives:

| Failure (scripted server)        | `code`        | `command`    | Reply     | Stage in the S4 rule                                |
| -------------------------------- | ------------- | ------------ | --------- | --------------------------------------------------- |
| Port refused                     | `ESOCKET`     | `CONN`       | none      | `connect` (soft: `ECONNREFUSED`)                    |
| Close after the greeting         | `ECONNECTION` | `CONN`       | none      | `connect` (soft)                                    |
| `421` to EHLO                    | `ECONNECTION` | `EHLO`       | 421       | `connect` (soft)                                    |
| `535` to AUTH                    | `EAUTH`       | `AUTH PLAIN` | 535       | `login` (`MailAuthError`)                           |
| `550` to MAIL FROM               | `EENVELOPE`   | `MAIL FROM`  | 550       | `envelope`, permanent                               |
| `550` or `450` to RCPT TO        | `EENVELOPE`   | `RCPT TO`    | 550 / 450 | `envelope` (`permanent` true / false)               |
| `554` to the DATA command        | `EENVELOPE`   | `DATA`       | 554       | `envelope`, permanent                               |
| `552` or `451` after the content | `EMESSAGE`    | `DATA`       | 552 / 451 | `content`                                           |
| Drop during or after the content | `ECONNECTION` | `CONN`       | none      | `unknown` (same as a drop after the greeting)       |
| Timeout after the content        | `ETIMEDOUT`   | `CONN`       | none      | `unknown`                                           |
| Success                          | none          | none         | 250 line  | `info.response`, `accepted`, `rejected`, `envelope` |

- A drop during or after the content looks the same as a drop after the greeting (`ECONNECTION` / `CONN` / "Connection closed unexpectedly"). So the stage cannot come from the error alone.
- Probe 2 (`SMTPConnection` used directly): `lastServerResponse` held `354 go` after the content. Probe 4 showed that nodemailer accepts any 2xx or 3xx reply to `DATA` (`250 go ahead` and then a drop gives the same error), so a test on `354` is wrong. **The rule in the code:** a server reply after the client `DATA` line (seen by the logger hook, `transactionLog: true`) starts the content phase, whatever the code. The logger gets the client command text (`DATA`) and the server replies; the message content is logged only with `debug: true`, so the hook never sees mail text.
- PIPELINING: with the EHLO capability `PIPELINING` nodemailer writes MAIL FROM, every RCPT TO and DATA at once. In both cases the `DATA` reply is the `(2 + recipients)`-th server reply after the client `MAIL FROM` line (code: `mail/imap/smtp.ts`, `updateMarks`).
- `MailComposer` (`nodemailer/lib/mail-composer`): two builds of the same mail object (with `messageId` and `date`) are byte-equal; header names are normalized (`X-EA-Action-Id` becomes `X-Ea-Action-ID`; the IMAP fetch and the mapper are case-insensitive); a non-ASCII subject becomes RFC 2047 words. `sendMail(mailObject)` gives bytes that differ from the composer build, so the system sends the composer bytes as `raw` through `SMTPConnection`.
- `SMTPConnection` (read in `node_modules`) has `connect`, `login`, `send`, `quit`, `close` and the public property `lastServerResponse`. `apps/server/package.json` pins `nodemailer` to `10.3.1` (the marker depends on its log shape).

### imapflow 1.7.8 on GreenMail 2.1.15 (probe 3, 2026-11-07)

- `append(path, raw, ["\\Draft"], idate)` returns `{ destination, uidValidity, uid }`. The fetched message has the flag, `internalDate` = the given date, `size` = the raw length, the ENVELOPE `messageId` and `date`, and the header block through `headers: ["x-ea-action-id"]`.
- `search({ since })` and `search({ header: … })` both find the message on GreenMail. At Interia the header search finds nothing (S1a), so the system locates by `SINCE` and a header FETCH.
- `messageDelete(uid, { uid: true })` returns true, and true again for a UID that is already deleted. The adapter checks the UID with `hasUid` first.

### Interia, send probe (stage 1, `bun run mailbox:probe-send`, run by the user, 2026-11-07)

Source: the task file, "Results", Stage 1; the Interia note, "Send probe".

- Folders `Wersje robocze` (`\Drafts`) and `Wysłane` (`\Sent`) exist; UIDPLUS true; SMTP PIPELINING true.
- Draft APPEND with `\Draft` gives APPENDUID (38939); `SEARCH SINCE` finds it; the FETCH returns the `x-ea-action-id` header; ENVELOPE `Message-ID`, RFC822.SIZE (= raw length), INTERNALDATE and the flag are kept; `UID EXPUNGE` deletes it.
- SMTP on port 465: the `DATA` reply is 354, the final reply 250.
- Sent copy APPEND (38940): header fetched, `SEARCH SINCE` in Sent finds it.
- **The SMTP server saves no copy in `Wysłane`** (polled 60 s), so the committer APPENDs one.
- **A mail sent to the mailbox's own address is in INBOX after 1 s** with `X-EA-Action-Id` intact (38941), so the own-mail skip is needed.
- One UID counter for the whole mailbox (38939, 38940, 38941 in three folders).
- Run 1 printed only up to the Sent copy step; its INBOX mail (subject `EA probe send …`) may still be in INBOX: check by hand.
- Effect on the plan (checkpoint 1): every "Not verified" Interia item held, so no decision changed.

### Eval of `classifier-v2` (stage 20, 2026-11-07, OpenAI `gpt-6-luna`, reasoning effort none)

Source: `evals/results/2026-11-07-gpt-6-luna-classifier-v2.md`; the task file, "Results", Stage 20.

- 108 cases (80 synthetic, 12 injection, 12 delegation, 4 new injection), 0 errors, about $0.02 per run. Run 1 missed the gate (`needs_reply` precision 79.2%); one clause was added to the `delegation` and `needs_reply` meanings; run 2 is the result below.
- Injection 16/16, whitelist 12/12, delegate pick 8/8, draft kind 16/16.
- **The gate has one miss:** on the same 92 old cases, `info` precision falls from 75.0% to 69.2% (−5.8 points, limit 5). One mail, `syn-urgent-16`, is read as `info` (v1: `urgent`). `spam` precision falls 3.5 points (inside the limit). Basis: the 86 LLM rows of the same 92 cases, as the v1 metrics table. The result **waits for the user's decision**: accept the miss, or run a fix round. The prompt is not accepted as passed.
- The results hold no generation settings, so one case can change between runs.
- Until the user decides, no VPS deploy of a commit after `c0340b4` (deploy-order rule of the task file).

### Real-provider schema check with the delegates block (stage 8, 2026-11-07)

`llm-check.ts --delegates` on Gemini (`gemini-3.5-flash-lite`) and OpenAI (`gpt-6-luna`): both returned `category=delegation` with a picked delegate, and both accepted `delegate_id` as `{type:"null"}` with an empty list. One call on each provider.

## Not verified (the stage that checks it)

- **Stage 19 (dev run, not done):** the length of a real approval message and a real set message (the unit tests keep the text within 4096 characters, `packages/core/src/digest/approvals.test.ts`); the LLM call counts of the dev run (`select reason_code, count(*) from audit_log where event = 'llm.call' and created_at > '<t0>' group by 1`); the hourly expiry timing in real time (the dev run sets `notified_at` back by SQL and runs `job:run --name actions.expiry`); a full delegation on GreenMail and the phone.
- **Stage 22 (VPS self-send, not done):** the draft in the Interia webmail; the behaviour of `Wysłane` after a real send by the system; the number of own mails that the sync skips; the SMTP 250 text of a real send.
- **Stage 23 (first real delegation, not done):** a real delegate's reply is matched to the thread (`In-Reply-To` and `References`), and the chaser reminder reads well.
- **Gate decision of stage 20:** see above.
- A `MAIL FROM` with a display name in `From:` is accepted by Interia: not shown by the stage 1 probe lines; stage 22 shows it.

## LLM call counts

- Stage 8: 2 schema checks (one Gemini, one OpenAI).
- Stage 20: 2 eval runs (OpenAI `gpt-6-luna`, one call per case, 108 cases in the final run, about $0.02 per run).
- Stage 19 (dev run): not done. The count goes here after the run.
