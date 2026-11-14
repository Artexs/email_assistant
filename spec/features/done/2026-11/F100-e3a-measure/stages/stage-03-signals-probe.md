# F100 stage 03 — `mailbox:signals`: read-only counts on the pilot

Part of [`../plan.md`](../plan.md). After the land the coordinator runs it on the VPS (C2). This answers N1, N2 and N4 of the plan; no later stage waits for the answer.

After this stage `bun run mailbox:signals` prints, for the INBOX mail of a window, how many mails carry `\Answered`, `\Seen`, `\Flagged`, an `Authentication-Results` line and `List-Unsubscribe`, and which `authserv-id` server names appear. It reads the mailbox and the DB only; it writes nothing.

## Step 1 — Tool function and CLI

**Goal.** One read-only probe with the stage 02 port methods (D29).

**Files.** `apps/server/src/modules/mail/tools.ts` (new function; keep the file under about 400 lines, else put it in `mail/signals.ts` and export it from `mail/index.ts`), `apps/server/src/modules/mail/index.ts`, `apps/server/src/scripts/mailbox-signals.ts` (new), `package.json` (script `mailbox:signals`), `apps/server/test/integration/mail-signals.test.ts` (new), `docs/capabilities/sync.md` (rule 16 "Operator tools": one sentence for `bun run mailbox:signals`, read-only, counts and server names only; Entry points: a `CLI` row `bun run mailbox:signals` → `apps/server/src/scripts/mailbox-signals.ts`; refresh the "Checked against" line).

**Interfaces.**

```ts
export const SIGNALS_CONTENT_LIMIT = 200;

export interface MailboxSignals {
  mails: number; // INBOX mail with INTERNALDATE in the window
  answered: number;
  seen: number;
  flagged: number;
  contentRead: number; // the newest mails whose content was read (≤ SIGNALS_CONTENT_LIMIT)
  captureFailed: number; // contentRead mails with capture null
  authResults: number; // of contentRead: capture.authResults not null
  authservIds: Record<string, number>; // server name → count, at most 10 names, the rest under "other"
  listUnsubscribe: number;
  partsUnknown: number; // over the size limit
}

/** Read-only: counts the IMAP flags and captured headers of INBOX mail since `since`. */
export async function signalsOfMailbox(
  deps: ToolDeps,
  ctx: TenantContext,
  mailboxId: string,
  since: Date
): Promise<MailboxSignals>;
```

Rules:

- Open the provider like `auditMailbox` (`loadImapOptions`, `openImapProvider`), close it in `finally`.
- Mails: `fetchSince(provider, INBOX, since)` (exists in `sync.ts`); flags: `fetchFlagsIn(INBOX, uids)` (stage 02); counts by `flags.includes("\\Answered")` and so on.
- Content: the `SIGNALS_CONTENT_LIMIT` highest UIDs, `fetchContent(INBOX, uid)` one by one.
- `authserv-id` = the text before the first `;` of `authResults`, trimmed, lower case; keep it only when it matches `^[a-z0-9.-]{1,64}$`, else count it as `other`. It is a server name, not personal data (RFC 8601 §2.2).
- The CLI: `--org-id <uuid> --mailbox-id <uuid> [--days 30]` (1–90), like `mailbox-audit.ts` (`loadConfig`, `configureMailHosts`, `assertAppRole`, `createSecretBox`). It prints one `key value` line per field to stdout (the figures are for the operator, not log lines; through `createCliOutput` when F103 stage 04 has landed, plan D30), the `authservIds` as `authserv <name> <count>` lines. It never prints a subject, an address, a header value other than the server names, or a UID. Exit 0 on success, 1 on an error (an event log line with `...errorFields(error)`), 1 with the usage line on bad arguments.

**Decisions.** D29, D30.

**Test** (integration, the fake provider through a test seam or GreenMail; pick the one `mail-check.test.ts` or `mailbox-backfill-cli.test.ts` uses and say which):

1. 3 INBOX mails in the window (one `\Answered` + `\Seen`, one `\Flagged`, one with `Authentication-Results: mx.test.example; dkim=pass` and `List-Unsubscribe: <https://u.test/x>`) and 1 mail older than the window → `mails = 3`, `answered = 1`, `seen = 1`, `flagged = 1`, `authResults = 1`, `authservIds = { "mx.test.example": 1 }`, `listUnsubscribe = 1`, `captureFailed = 0`.
2. An `Authentication-Results` value `Weird Name; spf=pass` → counted under `other`.
3. The CLI with a missing `--mailbox-id` → exit 1 and the usage line; stdout holds no address (assert the seeded addresses are not in the output of case 1's CLI run, if the test runs the CLI).

**Check.** `bun test apps/server/test/integration/mail-signals.test.ts apps/server/src/capability-map.test.ts`

**Done when.** Cases 1–3 pass; `bun run mailbox:signals` without arguments prints the usage line.

**Out of scope.** Running it on the VPS (coordinator step C2); any change of a mailbox.

## Done when (stage)

Step 1 done; the Proof command of `plan.md` passes (`/tmp/f100-s03`).
