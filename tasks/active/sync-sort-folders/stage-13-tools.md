# sync-sort-folders — Stage 13

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's D16, D19 and "Rules for every step" first. Needs stages 4, 5, 7a and 7b.

## Stage 13 — Tools: `mailbox:settings sync-folder`, `mailbox:audit` per folder, `mailbox:rescan`, `mailbox:seed --folder`

- [ ] **13.1 `mailbox:settings sync-folder` and the folder list in `show`**
  - Goal: the off switch per folder (D16), the rollback tool of stage 16 that needs no deploy.
  - Files: change `apps/server/src/scripts/mailbox-settings-args.ts`, `apps/server/src/scripts/mailbox-settings-args.test.ts`, `apps/server/src/scripts/mailbox-settings.ts`,
    test `apps/server/test/integration/config-settings.test.ts` (or a new `mail-folders-cli.test.ts` if the CLI tests live elsewhere: follow the file that tests
    `mailbox:settings switch` today).
  - Interfaces:

    ```ts
    // usage line added:
    "  bun run mailbox:settings sync-folder --org-id <uuid> --mailbox-id <uuid> --key offers|social|bills|junk --value on|off",
    // SettingsCommand gets:
    | { kind: "sync-folder"; orgId: string; mailboxId: string; key: "offers" | "social" | "bills" | "junk"; value: boolean }
    ```

  - Decisions: the script calls `setSyncFolderEnabled` (stage 4) with actor `"cli"` and `now`; prints `sync folder <key>: on|off (changed)`, `(no change)`, or for `not_found`
    `sync folder <key>: no such folder row (the sync adds it when the server lists the folder)` with exit 1. `show` adds one line per row of `listSyncFolders`:
    `sync folder <key>: <on|off>, role <role>, path <path>, cursor <set|none>` (an operator CLI on the server: the path may show here, never in a log of the server process).
    `--key inbox` is a usage error (exit 1).
  - Test:
    1. args: `sync-folder --key junk --value off` parses; `--key inbox` → undefined; a missing `--value` → undefined; `--name` with `sync-folder` → undefined.
    2. (integration) off → row disabled, audit `mailbox.sync_folder_changed` with actor `cli`; on → enabled, cursor null. The script path calls
       `setSyncFolderEnabled` with a plain `Db` (its own-transaction branch; group review 2–4, minor 3).
    3. `show` prints the INBOX row and the `offers` row.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–3 pass.
  - Out of scope: a web setting (S5c).

- [ ] **13.2 `mailbox:audit` per folder; `mailbox:rescan` text**
  - Goal: the read-only audit compares every enabled synced folder with its stored rows.
  - Files: change `apps/server/src/modules/mail/tools.ts` (`auditMailbox`), `apps/server/src/modules/mail/repo.ts`(`listInboxEmailKeys` → `listFolderEmailKeys(db, ctx, mailboxId, folders: string[], since)`),
    `apps/server/src/modules/mail/audit.ts` (names only if needed), `apps/server/src/scripts/mailbox-audit.ts`, `apps/server/src/scripts/mailbox-rescan.ts`,
    tests `apps/server/src/modules/mail/audit.test.ts`, `apps/server/test/integration/mail-check.test.ts` or the file that tests `auditMailbox` today.
  - Interfaces:

    ```ts
    export async function auditMailbox(
      deps: ToolDeps,
      ctx: TenantContext,
      mailboxId: string,
      since: Date
    ): Promise<{ key: SyncFolderKey; counts: AuditCounts | null }[]>; // null = the server does not list the folder (independent review m7)
    // audit.ts: AuditCounts gets `cross: number`. compareFolderWithDb(mail, rowsHere, rowsInOtherSyncedFolders): a mail key with no row in this folder but a
    // row of the mailbox whose `folder` is another enabled synced folder counts as `cross`, not `missing` (D24 e, review m10). A row in `AI/*` does not count
    // (a leftover after a failed expunge stays `missing`: a real problem). Pure; the old name may stay as an alias.
    // repo.ts: listFolderEmailKeys(db, ctx, mailboxId, folders: string[], since): the keys of rows whose `folder` is in `folders` (one folder or the others).
    ```

  - Decisions: one compare per enabled folder row (INBOX first) of the mail since `since` (`fetchSince(provider, path, since)`) against the rows with
    `folder = path` and the keys of the rows in the other enabled synced folders. Output: the first line stays `inbox=… stored=… missing=… duplicates=…` and adds ` cross=…` at the
    end (the pilot-week tasks read the first four fields); then one line per other folder: `folder=<key> mail=… stored=… missing=… duplicates=… cross=…`.
    The exit code comes from the INBOX counts only (as today: `missing` and `duplicates` 0 → 0, else 2); `cross` never changes it. A folder that the server
    does not list: `folder=<key> not on the server`.
    `mailbox:rescan` prints `rescan forced for every synced folder`.
  - Test:
    1. INBOX with 2 mails and 2 rows, `Oferty` with 1 mail and 0 rows → `[{ inbox, missing 0 }, { offers, missing 1 }]`, exit code 0.
    2. INBOX missing 1 → exit code 2.
    3. A disabled `junk` row → no `junk` entry.
    4. A cross copy: a row in `Oferty` and the same mail in INBOX → INBOX `missing 0`, `cross 1`, exit code 0.
    5. `listFolderEmailKeys` with another organization's context → `[]` (review m8).
    6. A mail in INBOX whose only row is in `AI/Info` → `missing 1`, `cross 0`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–6 pass.
  - Out of scope: `mailbox:backfill` (stays INBOX-only, D16).

- [ ] **13.3 `mailbox:seed --folder <path>`**
  - Goal: the dev run (stage 14) puts synthetic mail into `Oferty` and `Wiadomości-śmieci` on GreenMail.
  - Files: change `apps/server/src/modules/mail/tools.ts` (`seedMailbox` gets `folder?: string`, default INBOX), `apps/server/src/scripts/mailbox-seed.ts`,
    test `apps/server/test/integration/mail-seed.test.ts`.
  - Interfaces: `seedMailbox(deps, ctx, mailboxId, opts: { count; testAddress; messages?; folder?: string })`; the script adds `--folder <path>` to both usage lines.
  - Decisions: the guards stay first (`TEST_MAILBOX_ADDRESS`, before any connection). The folder must exist (no create); a missing folder → exit 1 with
    `folder not found`. Allowed values: INBOX or a path of `SYNC_FOLDER_DEFAULTS` (so the tool never writes into `AI/*`, `Kosz` or the user's own folders).
    `--folder` works with `--count` and with `--eval-cases` (stage 14 needs both; one code path for the APPEND target).
  - Test:
    1. `--folder Oferty` on GreenMail → the mail is in `Oferty`, not in INBOX.
    2. `--folder AI/Info` → refused (exit 1) before any connection.
    3. Without `--folder` → INBOX (the existing tests).
    4. `--eval-cases synthetic --per-category 1 --folder Wiadomości-śmieci` → 5 mails in that folder.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–4 pass; `docs/code-patterns.md` test-tool line names `--folder` (stage 15 writes it; note it in the step log).
  - Out of scope: creating folders; other providers' folder names.
