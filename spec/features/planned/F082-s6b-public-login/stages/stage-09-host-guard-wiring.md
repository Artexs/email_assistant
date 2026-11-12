# F082 stage 09 — Mail host guard on every IMAP and SMTP connect, config key, scripts [risky]

Part of [`../plan.md`](../plan.md). Read its F8–F10, L24–L27 and "Rules for every stage" first. Needs stage 8.

One step. After this stage the coordinator stops at checkpoint A.

- [ ] **9.1 Every connect resolves once through the guard**
  - Goal: the form, the sync, the send, the checks and the probes all connect to an address that the guard checked; a host name that later resolves to a local address is refused at the next connect. Dev and tests keep working with GreenMail on `127.0.0.1`.
  - Files:
    - change `apps/server/src/modules/mail/imap/client.ts` (`imapFlowOptions`, `connectImapClient`) and `client.test.ts`;
    - change `apps/server/src/modules/mail/imap/smtp.ts` (`smtpTransportOptions` → `buildSmtpTransportOptions`, new `smtpConnectOptions`, its three callers) and `smtp.test.ts`, `smtp-starttls.test.ts`;
    - change `apps/server/src/modules/mail/imap/probe-send.ts` (its `smtpTransportOptions` call);
    - change `apps/server/src/platform/config.ts` (`MAIL_ALLOW_LOCAL_HOSTS`, `mailAllowLocal`; remove `webMailAllowLocal`), `config.test.ts`, `.env.example`;
    - change `apps/server/src/web.ts` (use `mailAllowLocal`), `apps/server/src/main.ts`;
    - change the scripts of F10: `job-run`, `mailbox-audit`, `mailbox-backfill`, `mailbox-check`, `mailbox-connect`, `mailbox-password`, `mailbox-probe-move`, `mailbox-probe-send`, `mailbox-rescan`, `mailbox-seed`, `mailbox-settings`, `testmail-target` (all in `apps/server/src/scripts/`);
    - add `apps/server/src/scripts/mail-hosts-configured.test.ts`;
    - add root `bunfig.toml` and `apps/server/test/preload.ts`;
    - change `apps/web/e2e/env.ts` (`MAIL_ALLOW_LOCAL_HOSTS: "true"` in place of `WEB_MAIL_ALLOW_LOCAL`);
    - change the integration tests that spawn a mail script (`grep -ln "Bun.spawn" apps/server/test/integration`): add `MAIL_ALLOW_LOCAL_HOSTS: "true"` to each spawn env;
    - add `apps/server/test/integration/mail-host-guard.test.ts`.
  - Interfaces:

    ```ts
    // imap/client.ts — target is required, so the typecheck finds every caller
    export function imapFlowOptions(opts: ImapConnectOptions, target: MailTarget): ImapFlowOptions;
    // connectImapClient: const target = await resolveMailHost(opts.host); new ImapFlow(imapFlowOptions(opts, target)); …

    // imap/smtp.ts
    export function buildSmtpTransportOptions(opts: SmtpConnectOptions, target: MailTarget): SMTPTransportOptions;
    export async function smtpConnectOptions(opts: SmtpConnectOptions): Promise<SMTPTransportOptions>; // resolveMailHost + build

    // platform/config.ts
    MAIL_ALLOW_LOCAL_HOSTS: z.enum(["true", "false"]).optional(); // with emptyAsUndefined; no default (the fallback below needs "unset")
    export function mailAllowLocal(config: Config): boolean; // (MAIL_ALLOW_LOCAL_HOSTS ?? WEB_MAIL_ALLOW_LOCAL) === "true"
    ```

    `WEB_MAIL_ALLOW_LOCAL` keeps its schema, but its default `"false"` goes (it becomes optional), so `mailAllowLocal` can tell "unset" from `false`.

  - Decisions:
    - `imapFlowOptions`: `host: target.host`, plus `servername: target.servername` when it is set (F8). `secure` and the plain-IMAP rule still use `opts.host` (the name). Still no `tls` key.
    - `buildSmtpTransportOptions`: `host: target.host`; the TLS name goes into `tls.servername` when `target.servername` is set (F9); `tls` = `{ ...(opts.ca === undefined ? {} : { ca: opts.ca }), ...(target.servername === undefined ? {} : { servername: target.servername }) }`, left out when empty. `secure`, `requireTLS`, `ignoreTLS` still use `opts.host`. Never `rejectUnauthorized`.
    - `verifySmtpLogin`, `sendProbeToSelf`, `openSmtpSender` and `probe-send.ts` call `await smtpConnectOptions(opts)` (each is already async). The guard errors (`HostNotAllowedError`, `SoftError`) pass through unchanged (`toMailError` and `toSmtpError` return typed errors as they are).
    - `main.ts`, right after the config: `configureMailHosts({ allowLocal: mailAllowLocal(config) })`; when `MAIL_ALLOW_LOCAL_HOSTS` is unset and `WEB_MAIL_ALLOW_LOCAL` is set: `log.warn("WEB_MAIL_ALLOW_LOCAL is an old name: use MAIL_ALLOW_LOCAL_HOSTS")`; when `mailAllowLocal` is true: `log.warn("mail: MAIL_ALLOW_LOCAL_HOSTS=true: local mail hosts are allowed")` (replaces the old `web:` line in `web.ts`).
    - Each script of the list: `configureMailHosts({ allowLocal: mailAllowLocal(config) })` right after its `loadConfig()`.
    - `mail-hosts-configured.test.ts`: for `main.ts` and every `apps/server/src/scripts/*.ts` that is not a test and not `*-args.ts`, when the text holds `loadConfig(` and `"../modules/mail"`, it must hold `configureMailHosts(`. The test lists the files it checked (at least the 12 above and `main.ts`).
    - `bunfig.toml`: `[test]` `preload = ["./apps/server/test/preload.ts"]`. `preload.ts`: `import { configureMailHosts } from "../src/modules/mail/host-guard"; configureMailHosts({ allowLocal: true });` with a comment "GreenMail runs on 127.0.0.1; the guard tests pass their own policy." Check that `bun run test:unit` and `bun run test:int` load it (both run from the repo root).
    - `.env.example`: `MAIL_ALLOW_LOCAL_HOSTS=` with the comment "true = mail hosts on localhost or a private network are allowed for the connect form, sync and send (dev with GreenMail, e2e). Server: leave empty."; the `WEB_MAIL_ALLOW_LOCAL` comment becomes "Old name of MAIL_ALLOW_LOCAL_HOSTS; still read when the new key is empty."
  - Test:
    1. `client.test.ts`: `imapFlowOptions({ host: "imap.x.test", port: 993, user: "u", password: "p" }, { host: "93.184.216.34", servername: "imap.x.test" })` → `host "93.184.216.34"`, `servername "imap.x.test"`, `secure true`, no `tls`. With `{ host: "127.0.0.1", secure: false, … }` and target `{ host: "127.0.0.1" }` → as before, no `servername`.
    2. `smtp.test.ts`: `buildSmtpTransportOptions` with target `{ host: "93.184.216.34", servername: "smtp.x.test" }` → `host` is the address, `tls.servername "smtp.x.test"`, no `rejectUnauthorized`; with `ca` → `tls` holds both; with target without `servername` and no `ca` → no `tls` key. The STARTTLS cases of `smtp-starttls.test.ts` still pass with a target.
    3. `mail-host-guard.test.ts` (sets `configureMailHosts({ allowLocal: false, lookup: fake })` and restores the preload policy in `finally`): fake answers `127.0.0.1` for `imap.x.test` → `openImapProvider({ host: "imap.x.test", port: 3143, user: "u@x.test", password: "greenmail-test" })` rejects with `HostNotAllowedError`.
    4. The same for `verifySmtpLogin({ host: "smtp.x.test", port: 3025, user: "u@x.test", password: "p" })` and `openSmtpSender(...)`.
    5. Sync and send path: a mailbox row (`createOrgWithMailbox`) with `imap_host = "rebind.x.test"`; fake lookup answers `10.0.0.7` → `openMailboxProvider({ db, secrets, openProvider: openImapProvider, openSender: openSmtpSender }, ctx, mailboxId, { withSender: true })` rejects with `HostNotAllowedError`.
    6. A fake that answers a public address first and `127.0.0.1` next → the second `openImapProvider` call rejects with `HostNotAllowedError` before any socket opens (the fake counts its calls: 2).
    7. `config.test.ts`: `MAIL_ALLOW_LOCAL_HOSTS=true` → `mailAllowLocal` true; only `WEB_MAIL_ALLOW_LOCAL=true` → true; neither → false; `MAIL_ALLOW_LOCAL_HOSTS=false` with `WEB_MAIL_ALLOW_LOCAL=true` → false.
    8. `mail-hosts-configured.test.ts` passes.
    9. Every existing GreenMail test (`imap-contract`, `imap-sync-greenmail`, `smtp-send`, `imap-tls`, `imap-probe-*`, the CLI tests) passes.
  - Check: Proof (server form, `/tmp/f082-s09`). Also `bun run web:build` and `CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e -- mailboxes.spec.ts` with the job's own e2e DB (plan.md rules); paste the last line of each.
  - Done when: the tests pass, `grep -rnw "smtpTransportOptions\|webMailAllowLocal" apps/server/src` finds nothing (`-w`: `buildSmtpTransportOptions` does not match), and the Proof printed `PROOF_OK`.
  - Out of scope: a Tailscale ACL on the VPS (dropped by the scope change); the docs (stage 14).
