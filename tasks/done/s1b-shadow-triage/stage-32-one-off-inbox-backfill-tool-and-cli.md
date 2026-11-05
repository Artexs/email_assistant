# s1b-shadow-triage — Stage 32

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 32 — One-off INBOX backfill: tool and CLI [risky]

- [x] **32.1 `backfillMailbox` and `bun run mailbox:backfill`**
  - Goal: an operator command that opens the IMAP connection, runs `backfillInbox` and prints counts only.
  - Files: change `apps/server/src/modules/mail/tools.ts` (new `backfillMailbox`), `apps/server/src/modules/mail/index.ts` (export); create `apps/server/src/scripts/mailbox-backfill.ts`; change root `package.json` (`"mailbox:backfill": "bun apps/server/src/scripts/mailbox-backfill.ts"`); extend `apps/server/test/integration/mail-backfill.test.ts`.
  - Interfaces:
    - `backfillMailbox(deps: ToolDeps & { openProvider?: (opts: ImapConnectOptions) => Promise<MailProvider> }, ctx: TenantContext, mailboxId: string, opts: { days: number; now: Date }): Promise<SyncResult>` — reads the mailbox and the IMAP options as `auditMailbox` does (`getMailboxOrThrow`, `loadImapOptions`), opens the provider with `deps.openProvider ?? openImapProvider`, calls `backfillInbox` with `since = now − days × 24 h`, `isOwnActionId: async () => false`, `now: () => opts.now`, and closes the provider in `finally`.
    - CLI: `bun run mailbox:backfill --org-id <uuid> --mailbox-id <uuid> [--days 30]` (`--days` int 1–30, default 30, checked with Zod as in the other scripts). Output through `log.info`: `backfill ${mailboxId}: fetched n, stored n, uid updated n, returned n` (counts only). Exit 0. `CursorMovedError` → exit 1 with "the regular sync moved the cursor during the backfill; run the same command again (the dedup key stops duplicates)". Other errors → exit 1 with `describeError`.
  - Decisions: style of the other mail scripts (`parseArgs`, `loadConfig`, `assertAppRole`, `createSecretBox`). Read-only on the mailbox (step 31.1). Log lines: mailbox id and counts only.
  - Test (`mail-backfill.test.ts`; stored credentials as in `mail-jobs.test.ts`: `createSecretBox` + `insertCredentials`; a fake provider through `openProvider`): after a first `syncMailbox`, `backfillMailbox({ days: 30 })` returns the counts of step 31.1 case 1 and `fake.closed` is `true`; with a UIDVALIDITY change on the fake it rejects with `SoftError` and `fake.closed` is still `true`; a mailbox without stored credentials → `HardError("mailbox has no stored password")` and no provider is opened.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`. Manual on GreenMail (the mailbox of step 29.1, already synced): `bun run mailbox:backfill --org-id … --mailbox-id … --days 30` prints the counts line and exits 0; `--days 31` exits 1 with a usage error.
  - Done when: the tests pass and the manual run prints the counts.
  - Out of scope: re-queueing skipped mail (stage 33), running it on the VPS (step 39.1).
