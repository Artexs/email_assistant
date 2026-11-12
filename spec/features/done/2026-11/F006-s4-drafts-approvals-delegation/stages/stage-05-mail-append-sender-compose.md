# s4-drafts-approvals-delegation — Stage 5

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 5 — Mail: `appendMessage`, the `MailSender` port, the SMTP adapter with the stage rule, the fake sender, `composeMessage` [risky]

Why risky: the adapter is the only code that sends mail. The stage rule decides whether a failed send may run again; a wrong "before DATA" answer sends a mail twice.

- [x] **5.1 `composeMessage` and `appendMessage` (D9, S3 D1)**
  - Goal: the MIME bytes of an outgoing message are built once, the same every time; the write port can append a raw message to any folder with flags and an INTERNALDATE.
  - Files: create `apps/server/src/modules/mail/imap/compose.ts`, `compose.test.ts`, `apps/server/src/modules/mail/fake/raw.ts` (test-only header parser for the fake); change `apps/server/src/modules/mail/port.ts`, `mail/imap/client.ts`, `mail/fake/index.ts`, `mail/fake/fake.test.ts`, `mail/index.ts`, `apps/server/test/contract/mail-provider.ts`.
  - Interfaces:

    ```ts
    // port.ts
    export interface MailProvider {
      // … S1a and S3 methods …
      /** APPEND of a raw RFC 5322 message. `uid` is null when the server stored the message but sent no APPENDUID (no UIDPLUS). imapflow's `false` (APPEND skipped: not authenticated or selected, empty path) stored nothing and throws `SoftError`. Creates nothing: the caller runs ensureFolder first. */
      appendMessage(folder: string, raw: Buffer, flags: string[], internalDate: Date): Promise<{ uid: number | null }>;
    }
    // imap/compose.ts
    export async function composeMessage(message: OutgoingMessage): Promise<Buffer>;
    // fake/raw.ts
    export function parseRawHeaders(raw: Buffer): Map<string, string>; // lower-case names, folded lines unfolded, first value wins
    ```

  - Decisions:
    - `composeMessage`: `new MailComposer({ from: message.from, to: message.to, subject, text, messageId, date, inReplyTo: inReplyTo ?? undefined, references: references.length ? references.join(" ") : undefined, headers: { "X-EA-Action-Id": … } }).compile().build()` (`nodemailer/lib/mail-composer`). nodemailer formats `{ name, address }` objects, encodes the subject (RFC 2047) and the body (quoted-printable), and keeps the given `Message-ID` and `Date` (probe 1). The header name on the wire is `X-Ea-Action-ID` (nodemailer normalizes it); the IMAP fetch is case-insensitive, and the sync's mapper lower-cases. The function is deterministic for the same message (probe 1: two builds byte-equal).
    - `ImapMailProvider.appendMessage`: `client.append(folder, raw, flags, internalDate)` under `guard("appendMessage")`; `uid` = `result.uid ?? null` (`AppendResponseObject`, imapflow 1.7.8; `false` → `SoftError("IMAP append skipped")`). A missing folder is a `HardError` (imapflow `TRYCREATE`): the caller resolves folders with `ensureFolder` first (S3 D9).
    - Fake: `appendMessage` parses the raw with `parseRawHeaders` and stores a `StoredMessage` with `msg` = `{ messageId, from, to, subject (raw header value), date (parsed from the Date header, else internalDate), inReplyTo, references (split), headers: { "X-EA-Action-Id": … } }`, `size` = `raw.byteLength`, `internalDate` = the given date, the flags in the S3 flag set; it returns `{ uid }` (or `{ uid: null }` with `capabilities.uidplus` false). `calls` records `appendMessage`; `failOn` works. The fake also keeps the `raw` on the stored message (`StoredMessage.raw?: Buffer`) so tests can compare bytes.
    - Contract cases (`mail-provider.ts`, run on the fake now and on GreenMail in the same stage: GreenMail has UIDPLUS): (c1) `ensureFolder("Drafts-<uuid>")`, `appendMessage(folder, raw, ["\\Draft"], date)` → `uid` > 0; `fetchMetaIn(folder, uid)` → `actionId` = the header value, `messageId` = the raw's id, `internalDate` = the given date (same second), `size` = `raw.byteLength`, flags contain `\\Draft`; (c2) `searchSinceIn(folder, date − 1 day)` contains the uid; (c3) `appendMessage(sentFolder, raw, ["\\Seen"], date)` then `deleteMessage(sentFolder, uid)` → `fetchMetaIn` null; (c4) `appendMessage("No-such-folder-<uuid>", …)` throws a `HardError`.
  - Test: `compose.test.ts`: (1) a message from the stage 4 builder → the buffer has `Message-ID: <ea-…>`, `Date: ` of the given date (UTC), `In-Reply-To`, `References`, a header line that matches `/^x-ea-action-id: <id>$/im`, `MIME-Version`, `Content-Transfer-Encoding: quoted-printable`, CRLF line ends only; (2) two builds are byte-equal; (3) a Polish subject is RFC 2047 encoded and the body holds `=C4=85` for `ą`; (4) `to` with a display name → `To: Name <addr>`. `fake.test.ts`: `appendMessage` stores the headers; `uidplus: false` → `uid` null; `failOn("appendMessage", …)` throws once. `raw.ts`: unfolds `References:\r\n <a>\r\n <b>`.
  - Check: `bun run dev:up && bun run lint && bun run typecheck && bun run test:unit && bun run test:int` (the GreenMail contract run includes c1–c4).
  - Done when: the contract cases pass on the fake and on GreenMail; the unit tests pass.
  - Out of scope: the sender (5.2), the locate (stage 6).

- [x] **5.2 `MailSender` port, the SMTP adapter with the stage rule, the fake sender (D10)**
  - Goal: a send either reports success with the server's reply, or an error whose `stage` tells whether the content phase began, so the committer can decide between a retry and `outcome_unknown` without guessing.
  - Files: change `apps/server/src/modules/mail/port.ts`, `mail/imap/smtp.ts`, `mail/imap/smtp.test.ts`, `mail/index.ts`; create `apps/server/src/modules/mail/fake/sender.ts`, `sender.test.ts`, `apps/server/test/integration/smtp-send.test.ts`.
  - Interfaces:

    ```ts
    // port.ts
    export interface SendResult { response: string; accepted: string[]; rejected: string[] }
    export type SmtpStage = "connect" | "login" | "envelope" | "content" | "unknown";
    export class SmtpSendError extends Error {
      constructor(
        readonly stage: SmtpStage,
        readonly code: string, // nodemailer code: ECONNECTION, ETIMEDOUT, ESOCKET, EDNS, ETLS, EENVELOPE, EMESSAGE, EPROTOCOL, …
        readonly responseCode: number | null,
        readonly permanent: boolean, // a 5xx reply
        readonly soft: boolean, // a lost connection, a timeout, DNS, or a 4xx reply: the job may retry when the stage allows it
        options?: { cause?: unknown }
      );
      name: "SmtpSendError";
    }
    export interface MailSender {
      send(input: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<SendResult>;
      close(): Promise<void>;
    }
    // imap/smtp.ts
    export interface SmtpMarks {
      clientLines: number;
      mailFromSent: boolean;
      rcptLines: number;
      dataSent: boolean;
      repliesAfterMailFrom: number;
      contentStarted: boolean;
    } // set by the logger hook, never stored anywhere else
    export function createSmtpMarks(): { marks: SmtpMarks; logger: object }; // the logger object for SMTPConnection: every level method only updates `marks` from `entry.tnx` and the command text
    export function classifySmtpError(error: unknown, step: "connect" | "login" | "send", marks: SmtpMarks): SmtpSendError | MailAuthError; // pure, exported for tests
    export async function openSmtpSender(opts: SmtpConnectOptions, deps?: { connection?: (options: object) => SmtpConnectionLike }): Promise<MailSender>;
    // fake/sender.ts
    export interface FakeMailSender extends MailSender {
      readonly sent: { envelope: { from: string; to: string[] }; raw: Buffer }[];
      readonly calls: string[];
      closed: boolean;
      failNext(error: Error, times?: number): void;
    }
    export function createFakeMailSender(): FakeMailSender;
    ```

  - Decisions:
    - `openSmtpSender` returns a sender whose `send` opens one `SMTPConnection` per call (`nodemailer/lib/smtp-connection`): options from `smtpTransportOptions(opts)` (`host`, `port`, `secure`, `auth` is passed to `login`, `ignoreTLS` for loopback), plus `name: "ea-mail"`, `connectionTimeout: 30_000`, `greetingTimeout: 30_000`, `socketTimeout: 60_000`, `transactionLog: true`, `logger: createSmtpMarks().logger` (a new marks object per call); `connect(cb)` → on error `classifySmtpError(err, "connect", marks)`; `login({ user, pass }, cb)` → `classifySmtpError(err, "login", marks)` (`EAUTH` → `MailAuthError`); `send(envelope, raw, cb)` → success `{ response: info.response, accepted: info.accepted, rejected: info.rejected }`; error → `classifySmtpError(err, "send", marks)`; `finally` `conn.quit()` with a 2 s cap, then `conn.close()`. The `error` event of the connection is listened to (an unhandled one ends the process) and routed into the pending step's rejection (probe 2 needed this). `close()` of the sender is a no-op (no pooled connection) kept for the interface. The password lives in the sender's closure for the run and in the `login` call; the hook never sees it in clear (nodemailer masks the AUTH line: probe 4).
    - **The marks (the stage marker, probe 4 and the PIPELINING read of the task file's facts):** the logger object's `debug`, `info`, `warn`, `error`, `fatal`, `trace` methods take `(entry, message, ...args)`; let `line = String(message).trim().toUpperCase()`. `entry?.tnx === "client"` → `clientLines += 1`; `line` starts with `MAIL FROM` → `mailFromSent = true`, `repliesAfterMailFrom = 0`; starts with `RCPT TO` → `rcptLines += 1`; equals `DATA` → `dataSent = true`. `entry?.tnx === "server"` and `mailFromSent` → `repliesAfterMailFrom += 1`; then `dataSent && repliesAfterMailFrom >= 2 + rcptLines` → `contentStarted = true`. Every other entry is ignored. Why the count: nodemailer logs one `server` entry per complete reply, and the replies come in the order of the commands; with `PIPELINING` it writes MAIL FROM, every RCPT TO and DATA in one batch, so the first reply after the client `DATA` line is the MAIL FROM reply, not the DATA reply (review round 2 N9). The DATA reply is reply number `1 + recipients + 1` after MAIL FROM, with and without PIPELINING. The methods store no text and print nothing (`transactionLog` without `debug` never passes the message content: probe 4). nodemailer accepts any 2xx or 3xx reply to DATA (`_actionDATA`), so the marker does not read the reply code: the DATA reply means the server took the content phase, whatever it said. The `_onClose` remainder (a cut reply at a drop) is logged as a `server` entry too: it may count as the DATA reply, which gives `unknown` (the safe side).
    - `classifySmtpError(error, step, marks)`: `EAUTH` at any step → `MailAuthError("SMTP login failed")`; the fields `code`, `originalCode`, `command`, `responseCode`, `permanent` are read from the error object (nodemailer 10.3.1, `_formatError`). `stage`: step `connect` → `connect`; step `login` → `login`; step `send`: `code` `EENVELOPE` → `envelope`; `code` `EMESSAGE` → `content`; any other code (`ECONNECTION`, `ETIMEDOUT`, `ESOCKET`, `EDNS`, `ETLS`, `EPROTOCOL`, unknown) → `unknown` when `marks.contentStarted`, or when `marks.clientLines === 0` (the hook saw nothing: an unknown nodemailer build, the safe side; D10 states the same fallback), else `envelope`. `permanent` = `responseCode` ≥ 500 (nodemailer's `permanent` when present); `soft` = `code` in `ECONNECTION`, `ETIMEDOUT`, `EDNS`, or `ESOCKET` with `originalCode` in the existing `SOFT_SOCKET_CODES`, or a `responseCode` between 400 and 499; `ETLS` and `EPROTOCOL` are not soft; a permanent reply is never soft (`soft = !permanent && (…)`: permanent wins over soft, e.g. `ECONNECTION` with a 554). The adapter passes a copy of the envelope to nodemailer (it mutates it) and ignores an error from the close in `finally`. `lastServerResponse` is not read (probe 4: it misleads when DATA gets a `250`). The error message holds the stage, the code and the response code only (never `err.response`: it can hold an address).
    - **Pin nodemailer** (review round 3): `apps/server/package.json` changes `"nodemailer": "^10.3.1"` to `"nodemailer": "10.3.1"` (exact; `bun install` updates `bun.lock`), because the stage marker depends on the shape of its transaction log (one `server` entry per complete reply, in command order). An upgrade is its own task: the tests (8), (8b), (8c), (11) and (12) run the real `SMTPConnection` against the scripted server and fail when the shape changes. Files: also `apps/server/package.json`, `bun.lock`.
    - `verifySmtpLogin` and `sendProbeToSelf` stay as they are (the check tool); `toSmtpError` stays for them.
    - Fake sender: `send` records the call; `failNext(error, times)` throws it; else returns `{ response: "250 2.0.0 Ok: queued as FAKE", accepted: envelope.to, rejected: [] }`.
  - Test: `smtp.test.ts` (unit, a scripted fake SMTP server on `127.0.0.1` inside the test, the shape of `notes/2026-11-07-s4-probes/probe4.ts.txt`: greeting, EHLO with `AUTH PLAIN LOGIN`, scripted replies per scenario; `secure: false`): (1) ok → `response` starts with `250`, `accepted` = the recipient; (2) a closed port → `SmtpSendError` stage `connect`, `code` `ESOCKET`, `soft` true; (3) close after the greeting → `connect`, `ECONNECTION`, soft; (4) `535` → `MailAuthError`; (5) `550` to RCPT TO → `envelope`, `EENVELOPE`, `responseCode` 550, `permanent` true, `soft` false; (6) `450` to RCPT TO → `envelope`, soft true, permanent false; (7) `554` to the DATA command → `envelope`, permanent; (8) a drop on the DATA command before any reply → `envelope`, `ECONNECTION`, soft (`contentStarted` false); (8b) **the server answers DATA with `250 go ahead` and drops after the content → `unknown`** (the `354` text rule would say `envelope`: this case keeps the marker honest); (8c) **PIPELINING:** the EHLO reply has `250-PIPELINING`; the server reads the batch (MAIL FROM, RCPT TO, DATA), answers MAIL FROM `250`, then drops before the RCPT reply → `envelope`, `ECONNECTION` (`contentStarted` false: only one reply after MAIL FROM); the same server answers all three (`250`, `250`, `354`) and drops after the content → `unknown`; with two recipients the DATA reply is the fourth reply (a drop after three replies → `envelope`); (9) `552` after the content → `content`, `EMESSAGE`, permanent; (10) `451` after the content → `content`, soft; (11) a drop after the content (`354`) → `unknown`, `ECONNECTION`; (12) a timeout after the content (`socketTimeout` 500 ms in the test through `deps.connection`) → `unknown`, `ETIMEDOUT`; (13) `classifySmtpError` unit rows for each mapping above with hand-made marks, the marks logger fed with hand-made entry lists for the plain and the PIPELINING order, plus `ETLS` → not soft, and `clientLines === 0` with `ECONNECTION` in `send` → `unknown`; (14) the hook sees no secret: the test wraps the marks logger with a recorder of every `message` and `args` string and asserts that no entry holds the body marker `SECRET-BODY-MARKER` of the raw nor the password; (15) the error message has no `@`. `sender.test.ts`: the fake records and fails on demand. `smtp-send.test.ts` (GreenMail SMTP 3025, IMAP 3143): a send from `u-<uuid>@localhost` to `v-<uuid>@localhost` with a composed message (stage 5.1) → `response` starts with `250`; then an IMAP login as the recipient (a fresh user is created at login, `notes/2026-11-03-greenmail-facts.md`) finds the mail in INBOX by `fetchAbove(0)` with `actionId` = the header and `messageId` = the given id.
  - Check: `bun run dev:up && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass, including the GreenMail send and case (8b).
  - Out of scope: the committer's use (stage 12); retries (the committer decides).
