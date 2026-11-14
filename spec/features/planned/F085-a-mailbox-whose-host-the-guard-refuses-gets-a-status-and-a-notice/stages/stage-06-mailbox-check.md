# F085 stage 06 — `mailbox:check` prints the status and the host check

Part of [`../plan.md`](../plan.md). Read its D8, D14, D19 and "Rules for every stage" first. Needs stage 04 (`checkMailboxHosts`). It may build next to stage 05 (no shared file except `mail/index.ts`: on a land conflict, merge `master`).

No migration. Two normal steps, about 150 changed lines.

- [ ] **6.1 The service `inspectMailbox`**
  - Goal: one service function gives the status, the guard result for both hosts and, only when both pass, the existing capability report.
  - Files:
    - `apps/server/src/modules/mail/check.ts`: add `inspectMailbox` and `MailboxInspection`; `checkMailbox` stays as it is.
    - `apps/server/src/modules/mail/index.ts`: export `inspectMailbox` and `type MailboxInspection`.
    - Tests: `apps/server/test/integration/mail-check.test.ts` (a new `describe("inspectMailbox")`).
  - Interfaces:

    ```ts
    // apps/server/src/modules/mail/check.ts
    export interface MailboxInspection {
      status: MailboxStatus;
      statusChangedAt: Date;
      hosts: { imap: HostCheck; smtp: HostCheck };
      report: CheckReport | null; // null: a host is not "allowed", and the check made no connection
    }

    export async function inspectMailbox(
      deps: CheckDeps,
      ctx: TenantContext,
      mailboxId: string,
      opts: CheckOptions
    ): Promise<MailboxInspection>;
    //   mailbox = getMailbox(deps.db, ctx, mailboxId); undefined → throw new HardError("mailbox not found") (as checkMailbox)
    //   status = mailboxStatusSchema.parse(mailbox.status)
    //   hosts = await checkMailboxHosts(mailbox)
    //   report = hosts.imap === "allowed" && hosts.smtp === "allowed" ? await checkMailbox(deps, ctx, mailboxId, opts) : null
    //   It changes no status (read-only, as checkMailbox without probe).
    ```

  - Decisions: D8, D14.
  - Test (D19: `configureMailHosts({ allowLocal: false, lookup })` with a fake `lookup` that records the names it gets; `configureMailHosts({ allowLocal: true })` in `afterEach`; a mailbox from `createOrgWithMailbox` of `fixtures.ts`, hosts `imap.x.test` / `smtp.x.test`, in `withRollback`):
    1. `lookup` answers `10.0.0.7` for `imap.x.test` and `93.184.216.34` for `smtp.x.test` → `{ status: "active", hosts: { imap: "refused", smtp: "allowed" }, report: null }`; `lookup` got exactly `["imap.x.test", "smtp.x.test"]` (no connect attempt: a connect would call it a third time).
    2. A `host_blocked` mailbox (set with `setMailboxStatus` at `2026-11-14T11:00:00Z`) → `status: "host_blocked"`, `statusChangedAt` that time; the row is unchanged afterwards.
    3. `lookup` throws `ENOTFOUND` → both `lookup_failed`, `report: null`.
    4. An unknown mailbox id → throws `mailbox not found`.
  - Check: `bun test apps/server/test/integration/mail-check.test.ts`.
  - Done when: tests 1–4 pass; the existing tests of the file pass unchanged.
  - Out of scope: a status change from the check.

- [ ] **6.2 The script prints it**
  - Goal: `bun run mailbox:check` shows the status and the host check first, and does not connect to a refused host.
  - Files:
    - `apps/server/src/scripts/mailbox-check.ts`: call `inspectMailbox` instead of `checkMailbox`. Output lines, in order, through the same output loop the script uses today (`for (const line of …) log.info(line)`; add no other log call):
      - `status: ${status} since ${statusChangedAt.toISOString()}`
      - `imap-host: ${hosts.imap}`
      - `smtp-host: ${hosts.smtp}`
      - then: a report → the existing `reportLines(report)`, exit 0; a `refused` host → `the host guard refuses a mail server of this mailbox: no connection`, exit 2; else (`lookup_failed`) → `mail host lookup failed: no connection`, exit 1.
      - The usage text gets one more line: `  Exit 2: the host guard refuses a mail server of this mailbox.`
    - Tests: `apps/server/test/integration/mail-check.test.ts` (the script describe near line 290).
  - Interfaces: none new.
  - Decisions: D8 (no host name, no address in the output), D14.
  - Test:
    1. "prints the report; the password is not in the output" (line 296): stdout also contains `status: active since ` and the lines `imap-host: allowed` and `smtp-host: allowed`, before `capabilities:`.
    2. A new script test: with the file's `createOrg(db, suffix)` helper, insert a mailbox with `imapHost` and `smtpHost` `127.0.0.1` and stored credentials (`insertMailbox`, `insertCredentials` with the configured `secrets`, committed, deleted in `finally` as the test above does); run the script with `env: { ...process.env, MAIL_ALLOW_LOCAL_HOSTS: "false" }` → exit code 2; stdout contains `imap-host: refused`, `smtp-host: refused` and `the host guard refuses a mail server of this mailbox: no connection`; stdout does not contain `capabilities:` or `127.0.0.1`.
  - Check: `bun test apps/server/test/integration/mail-check.test.ts` (the file needs the local GreenMail today; test 2 itself needs none).
  - Done when: tests 1–2 pass.
  - Out of scope: `--probe` behaviour (unchanged); other CLI tools.

## Done when

- Steps 6.1 and 6.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 06 (`/tmp/f085-s06`) prints `PROOF_OK`.
