# s4-drafts-approvals-delegation — Stage 1

Part of [`../s4-drafts-approvals-delegation.md`](../s4-drafts-approvals-delegation.md). Read that file's "Input" and "Rules for every step" first.

## Stage 1 — Interia send spike: `mailbox:probe-send` on the real mailbox [risky]

Why first: the "Not verified" Interia items (drafts folder behaviour, the header fetch of an appended draft, `SEARCH SINCE` in Drafts and Sent, `UID EXPUNGE` of a draft, the SMTP reply, the Sent copy, the own mail back in INBOX) decide the rules of stages 6, 11 and 12. The probe writes one draft, sends one mail from the user's address to the user's own address, appends one copy to Sent, and cleans up. It runs on the Mac against Interia directly (no VPS, no DB): the user types the Interia password on stdin.

- [x] **1.1 CLI `mailbox:probe-send` (test address only)**
  - Goal: one command that performs every IMAP and SMTP write that S4 will use, with one synthetic message, and prints facts only.
  - Files: create `apps/server/src/modules/mail/imap/probe-send.ts`, `apps/server/src/scripts/mailbox-probe-send.ts`, `apps/server/test/integration/imap-probe-send.test.ts`; change `package.json` (script `"mailbox:probe-send": "bun apps/server/src/scripts/mailbox-probe-send.ts"`), `apps/server/src/modules/mail/index.ts` (export `probeSend`, `type ProbeSendReport`).
  - Interfaces:

    ```ts
    export interface ProbeSendReport {
      capabilities: { uidplus: boolean; pipelining: boolean | null }; // pipelining: the SMTP EHLO reply lists PIPELINING (null when the SMTP step did not run)
      folders: { drafts: string | null; sent: string | null; created: string[] };
      draft: {
        appendUid: number | null;
        searchSinceFound: boolean;
        headerFetched: boolean; // the FETCH of the uid returns the x-ea-action-id header
        envelopeMessageId: boolean; // the ENVELOPE Message-ID equals the one in the raw
        sizeEqualsRaw: boolean | null;
        internalDateKept: boolean | null;
        flagDraft: boolean | null;
        deleted: boolean;
        goneAfterDelete: boolean | null;
      };
      send: {
        ok: boolean;
        responseCode: number | null; // the first three digits of the final reply (250)
        dataReplyCode: number | null; // the reply to the DATA command (354 at a standard server; nodemailer accepts any 2xx or 3xx)
        stage: "connect" | "login" | "envelope" | "content" | "unknown" | null;
        code: string | null; // nodemailer code on error
        lastServerResponseCode: number | null; // the first three digits of lastServerResponse on error
      };
      sentCopy: { appendUid: number | null; headerFetched: boolean; searchSinceFound: boolean; deleted: boolean };
      sentAutosave: { foundInSent: boolean; polledSeconds: number };
      inbox: {
        checked: boolean;
        ownMailFound: boolean;
        headerIntact: boolean;
        uid: number | null;
        deleted: boolean;
        polledSeconds: number;
      };
      notes: string[];
    }
    export async function probeSend(
      imap: ImapConnectOptions,
      smtp: SmtpConnectOptions,
      opts: {
        address: string;
        to: string;
        probeId: string;
        now: Date;
        pollMs?: number;
        inboxTimeoutMs?: number;
        sentTimeoutMs?: number;
        log?: (line: string) => void;
      }
    ): Promise<ProbeSendReport>;
    ```

    The script: `bun run mailbox:probe-send --host <imap host> --port <port> --smtp-host <host> --smtp-port <port> --address <address> --to <address>`; the password on stdin. Guards: `assertTestAddress(address, process.env.TEST_MAILBOX_ADDRESS)` (S3 stage 1, `mail/imap/probe-move.ts`), and `--to` must equal `--address` or be one of `SEND_TEST_ADDRESSES` (read as a plain env variable here: the config key comes in stage 18; comma-separated, case-insensitive); else exit 1 with `refused: --to is not a test address`. Exit 0 with the report as `key: value` lines; exit 1 on an error, with the cleanup notes (`withCleanupNotes`, `mail/imap/probe.ts`).

  - Decisions:
    - The raw message is `renderSeedMessage` (`mail/seed.ts`) with `messageId` `<ea-probe-<probeId>@<domain of address>>`, `from` = `address`, `to` = `[to]`, subject `EA probe send <probeId>`, `date` = `now`, text "Email assistant send probe. You can delete this mail.", `headers: { "X-EA-Action-Id": probeId, "X-EA-Probe": probeId }`. The same raw bytes go to the draft APPEND, the SMTP send and the Sent APPEND (the S4 rule D9, checked here with the seed renderer; the composer comes in stage 5).
    - Folders: `list()`; `drafts` = the `\Drafts` entry, else a path `Drafts`; `sent` = `\Sent`, else `Sent`; a missing folder is created with `mailboxCreate` and named in `folders.created` (GreenMail: probe 3; Interia: `Wersje robocze` and `Wysłane` exist).
    - Steps in order, each guarded, each result into the report: (1) `append(drafts, raw, ["\\Draft"], now)` → `appendUid` (UIDPLUS); (2) in `drafts`: `search({ since: now − 2 days })` contains the uid → `searchSinceFound` (without a uid from APPENDUID: the probe takes the highest uid of that search and notes it); `fetchOne(uid, { uid, size, internalDate, flags, envelope, headers: ["x-ea-action-id"] })` → `headerFetched` (the header block holds the probe id, case-insensitive), `envelopeMessageId`, `sizeEqualsRaw` (`size === Buffer.byteLength(raw)`), `internalDateKept` (same second as `now`), `flagDraft`; (3) `messageDelete(uid, { uid: true })` only with UIDPLUS (stored and live) → `deleted`; `fetchOne(uid, { uid: true })` → `goneAfterDelete` (`false` result = gone); (4) SMTP: `SMTPConnection` (`nodemailer/lib/smtp-connection`) with `host`, `port`, `secure` (true unless loopback), `name: "ea-mail"`, `connectionTimeout` 15 s, `socketTimeout` 30 s; `connect()`, `login({ user, pass })`, `send({ from: address, to: [to] }, raw)`; success → `ok` true, `responseCode` from `result.response`; `dataReplyCode` from the probe's own logger hook on the connection (`transactionLog: true`; the hook uses the stage 5.2 count: the server replies after the client `MAIL FROM` line, and the DATA reply is reply number `2 + <RCPT TO lines>` once the client `DATA` line was written, because with PIPELINING the first reply after `DATA` is the MAIL FROM reply (D10, review round 3); it records the first three digits of that reply only, and `capabilities.pipelining` from a server line that matches `/[ -]PIPELINING\b/i` before `MAIL FROM`; the hook never stores the message or the AUTH line); an error → `stage` by the D10 rule (`connect` / `login` by the step; inside `send`: `EENVELOPE` → `envelope`, `EMESSAGE` → `content`, `ECONNECTION` / `ETIMEDOUT` / `ESOCKET` → `envelope` when the hook's count did not reach the DATA reply, else `unknown`: the D10 marker, not the `354` text), `code`, `lastServerResponseCode`; the connection is closed in `finally`; the probe goes on with step 5 only when `ok`; (5) `append(sent, raw, ["\\Seen"], now)` → `sentCopy.appendUid`; FETCH the header → `headerFetched`; `search({ since })` → `searchSinceFound`; `messageDelete` → `deleted`; (6) `sentAutosave`: poll `sent` every `pollMs` (default 5 s) up to `sentTimeoutMs` (default 60 s): `noop()`, `search({ since })`, FETCH the headers of the new uids, a uid whose header is the probe id and that is not `sentCopy.appendUid` → `foundInSent` true; (7) when `to` equals `address` (case-insensitive): poll INBOX up to `inboxTimeoutMs` (default 120 s) the same way → `ownMailFound`, `headerIntact` (the fetched header equals the probe id exactly), `uid`; then the INBOX expunge rule of S3 stage 1 (delete only when `search({ deleted: true })` in INBOX returns no other uid; else skip and note "delete the probe mail by hand") → `deleted`; `checked` false when `to` differs from `address`.
    - Every write names one uid; the only EXPUNGE is `UID EXPUNGE <uid>`. A failure after the first APPEND throws with the cleanup notes (the draft subject in `drafts`, the copy in `sent`, the mail in INBOX: "delete by hand").
    - Log lines (the script `log`): booleans, codes, uids, seconds; the folder names (the server's, not mail data); never the password, the addresses or the raw.
  - Test (`imap-probe-send.test.ts`, GreenMail IMAP 3143 and SMTP 3025, a fresh `u-<uuid>@localhost` user as in `imap-contract.test.ts`, `to` = the same user, `pollMs` 500, `inboxTimeoutMs` 20 s, `sentTimeoutMs` 2 s): (1) `probeSend` returns `folders.created` with `Drafts` and `Sent`, `draft.appendUid` > 0, `searchSinceFound`, `headerFetched`, `envelopeMessageId`, `sizeEqualsRaw`, `internalDateKept`, `flagDraft` all true, `deleted` true, `goneAfterDelete` true; `send.ok` true with `responseCode` 250 and `stage` null; `sentCopy` all true; `sentAutosave.foundInSent` false (GreenMail saves nothing: `notes/2026-11-03-greenmail-facts.md`); `inbox.checked` true, `ownMailFound` true, `headerIntact` true, `deleted` true; after the run the user's INBOX, Drafts and Sent hold no mail with the probe subject. (2) The `--to` guard: a unit case in the same file for the pure `isAllowedRecipient(to, address, envList)` of `probe-send.ts`: another address → false; the same address in other case → true; an address in the list → true. (3) A refused recipient (GreenMail SMTP accepts every address, so this case uses a fake: `probeSend` takes an optional `smtpConnection` factory in `opts` for tests; a stub whose `send` fails with `code: "EENVELOPE", command: "RCPT TO", responseCode: 550` → `send.ok` false, `stage` `envelope`, `code` `EENVELOPE`, and steps 5–7 are skipped (`sentCopy.appendUid` null, `inbox.checked` false)).
  - Check: `bun run dev:up && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the GreenMail test passes and `bun run mailbox:probe-send` prints the usage without arguments.
  - Out of scope: the port methods and the sender adapter (stage 5: the probe uses `imapflow` and `SMTPConnection` directly, like `probe.ts`); any write to a mail that is not the probe mail.

- [x] **1.2 Run the probe on the pilot Interia mailbox (user step) and record the facts**
  - Goal: the "Not verified" Interia items become facts in the note; the stage 6, 11 and 12 decisions are settled (user checkpoint 1).
  - Files: change `notes/2026-11-03-interia-imap-capabilities.md` (append "Send probe (S4 stage 1, <date>)" with the report lines), this task file ("Results": the report; a log line).
  - Interfaces: none (operations).
  - Decisions:
    - The command on the Mac (after `/pause`): `read -rsp 'Interia password: ' P && printf '%s' "$P" | TEST_MAILBOX_ADDRESS=<pilot address> SEND_TEST_ADDRESSES=<pilot address> bun run mailbox:probe-send --host poczta.interia.pl --port 993 --smtp-host poczta.interia.pl --smtp-port 465 --address <pilot address> --to <pilot address>; unset P`. The agent never sees or prints the password; the user runs the `read` line. The report holds no mail data.
    - **Pause the pilot mailbox during the probe (review round 2 N26):** the user sends `/pause` to the pilot bot before the command and `/resume` after it (S2). Why: the VPS runs the S3 code and syncs every few minutes; it would store the probe mail that comes back to INBOX (its `X-EA-Action-Id` matches no `actions` row: the own-mail skip is stage 6), triage it, and with `ACTIONS_SCOPE=all` the S3 committer could move it out of INBOX before the 120 s poll ends, which gives a false `inbox.ownMailFound: false` and changes stages 6 and 22. Paused, the VPS neither syncs nor commits. After `/resume` the probe mail is gone from INBOX (step 7), so nothing is stored. No agent step touches the VPS here (the Rules); stage 22.1 step 1 counts the probe rows on the VPS later (`0` expected; a `1` means the pause came too late: harmless, written in the note then). If the INBOX expunge rule skips the delete, the user deletes the mail in webmail before `/resume`.
    - Outcomes to write down, one line each: every `draft.*`, `send.*` (also `dataReplyCode`: stage 5 relies on "a reply after DATA", whatever its code), `sentCopy.*`, `sentAutosave.foundInSent`, `inbox.*`, `folders.*`, the notes.
    - How the facts change later stages (the main session edits the stage files at checkpoint 1): `draft.headerFetched` false → the draft and Sent locates (stage 6) must match on the ENVELOPE `Message-ID` (`<ea-<id>@…>`) instead of the header [design at the checkpoint: `locateByActionId` compares `meta.messageId` with the builder's id]; `draft.searchSinceFound` false → stage 6 falls back to `search({ all: true })` capped to the newest 500 uids; `draft.sizeEqualsRaw` false → nothing changes (S4 compares no sizes); `draft.deleted` or `goneAfterDelete` false → stage 11 and 13 keep drafts (no reverse rows; the result notices say "the draft stays"); `send.ok` false → stop: the SMTP path needs a new design (write the stage, code and `lastServerResponseCode`); `sentAutosave.foundInSent` true → Interia saves sent mail after all: stage 12 skips the Sent APPEND when the locate finds the copy (the plan already does the locate first: no change) and the note is corrected; `inbox.ownMailFound` false → the own-mail skip (stage 6) stays (harmless) and the `self` tests of stage 22 use the second address only; `inbox.headerIntact` false → stage 6 matches the own mail by the ENVELOPE `Message-ID` domain `ea-` prefix [design at the checkpoint].
  - Test: none (operations).
  - Check: the report prints with exit 0; the pilot Drafts, Sent and INBOX in webmail hold no `EA probe send` mail (the user looks).
  - Done when: the note has the facts and the user said go at checkpoint 1.
  - Out of scope: any probe on real mail or to another person; the VPS.
