# imapflow TLS under Bun: use a host name, not an IP

Learned in S1a stage 9 (2026-11-03).

- imapflow 1.7.8 sets `servername = false` when the host is an IP literal (`imap-flow.js:455`).
- Under Bun, `tls.connect` then throws `servername argument must be an string` before any certificate check.
- Result: IMAPS to `127.0.0.1` or any IP fails with a HardError (fails closed). With a host name (`localhost`, `poczta.interia.pl`) the real certificate check runs.
- The GreenMail TLS test (`apps/server/test/integration/imap-tls.test.ts`) uses `localhost` for this reason and asserts the cert error code (`DEPTH_ZERO_SELF_SIGNED_CERT`).
- Production mailboxes must use a host name for `imap_host`. Check the same for SMTP (nodemailer) in stages 10–11.
- If a CI run fails the TLS test with `ECONNREFUSED`, `localhost` resolved to `::1` and GreenMail listens only on IPv4.
- Known gap (accepted): if a server sends no RFC822.SIZE, `fetchBodyText` fetches the full source with no size limit (`mail/imap/client.ts`).

## SMTP (nodemailer 10.3.1), stage 10
- nodemailer works with an IP host under Bun: it sets `servername` only for a host name and never passes `servername: false`.
- `verifySmtpLogin` to GreenMail TLS port 3993 with `127.0.0.1` and with `localhost` both gave HardError `SMTP verify failed (DEPTH_ZERO_SELF_SIGNED_CERT)`: the certificate check runs.
- `verify()` logs in only when the server advertises AUTH (`forceAuth` is not set). Interia advertises AUTH, so connect really tests the login.
- The SMTP connection timeout is the nodemailer default (2 min).
- `mail` imports `config` (`insertDefaultSettings`): add the `mail --> config` arrow to `docs/modules.md` in step 17.3.
