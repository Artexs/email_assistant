# F113 stage 07: the `LabMailClient` that stage 08 must reconcile with

Branch `limen/2026-11-15-f113-s07-injector-exactly-once-m-1d7be3ee`. File: `apps/server/src/modules/lab/mail-client.ts`. Exported from `apps/server/src/modules/lab/index.ts`: `createGreenMailClient`, `LabMailError`, `GreenMailOptions`, `LabMailClient`, `LabMailErrorCode`.

## Exact type

```ts
export type LabMailErrorCode =
  | "smtp_failed" | "imap_connect" | "host_refused" | "imap_search" | "imap_append" | "imap_fetch";

export class LabMailError extends Error {
  readonly code: LabMailErrorCode;   // message === code
  readonly detail: string;           // a short transport code (e.g. ECONNREFUSED) or "unknown"
  constructor(code: LabMailErrorCode, cause: unknown);
}

export interface LabMailClient {
  smtpSend(input: { envelopeFrom: string; to: string; raw: string }): Promise<void>;
  appendSent(mailbox: string, raw: string): Promise<void>;
  hasMessageId(mailbox: string, messageId: string): Promise<boolean>;
  fetchSince(mailbox: string, folder: string, afterUid: number): Promise<{ uid: number; raw: string }[]>;
}

export interface GreenMailOptions { host: string; imapPort: number; smtpPort: number }
export function createGreenMailClient(options: GreenMailOptions): LabMailClient;
```

## Behaviour of each method

- `createGreenMailClient`: throws `LabMailError("host_refused")` when `host` is not `127.0.0.1`, `localhost` or `::1` (case-insensitive). Use `LAB_MAIL_HOST`, `LAB_IMAP_PORT`, `LAB_SMTP_PORT` from `seed.ts`.
- `smtpSend`: nodemailer, plain SMTP (`secure: false`, `ignoreTLS: true`), one connection per call, `sendMail({ envelope: { from: envelopeFrom, to: [to] }, raw })`. Delivery goes by the envelope only; the headers of `raw` are not read. Error: `smtp_failed`.
- `appendSent`: IMAP login as `mailbox` (any password), creates folder `Sent` when missing, APPEND with flag `\Seen`. Error: `imap_append` (connect errors: `imap_connect`).
- `hasMessageId`: lists every folder (skips `\Noselect` and `\NonExistent`), opens each read-only, `SEARCH HEADER Message-ID <messageId>` (substring match; pass the id with angle brackets). True when any folder matches. Error: `imap_search`. This is the exactly-once resume check; it must stay over every folder (the sim server moves mail out of the INBOX).
- `fetchSince`: one folder; UID range `afterUid+1:*`, filtered to `uid > afterUid`, sorted by UID, `raw` = full source as utf8. A missing folder or an empty folder gives `[]`. Error: `imap_fetch`.

Every IMAP call opens its own connection (ImapFlow, `logger: false`, error listener set) and logs out after the call. No method keeps a connection.

## Not in the type (stage 08 may add)

No `listFolders`, no `moveMessage`, no `markSeen`, no `fetchHeaders`, no flags read. A bot needs "mails with UID above N in INBOX": `fetchSince(mailbox, "INBOX", n)` covers it. If stage 08 needs more methods, add them to this interface (the injector uses only `smtpSend`, `appendSent`, `hasMessageId`; its tests use an in-memory fake that implements all four).

## Injector deps that touch the client

`InjectorDeps = { state, mail: LabMailClient, spendUsd, now, corpus }`. Stage 08 and stage 14 reuse the same `LabMailClient`.
