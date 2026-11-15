# F113 stage 06: the host `greenmail` and TLS (open question for stages 03, 07)

Found while writing `seedLabOrg` (2026-11-15). Stage 06 follows its stage file: every lab mailbox has host `greenmail`, IMAP 3143, SMTP 3025.

Observed in the code:

- `apps/server/src/modules/mail/imap/client.ts:86` (`imapFlowOptions`): `secure = opts.secure ?? !isLoopbackHost(opts.host)`. Plain IMAP is allowed only to a loopback host (`127.0.0.1`, `localhost`, `::1`).
- `apps/server/src/modules/mail/imap/smtp.ts:65`: the same rule for SMTP (`plain SMTP is allowed only to a loopback host`).
- `apps/server/src/modules/mail/open.ts` does not pass `secure`: the sync and the committer open every mailbox row with the default. A row with host `greenmail` and port 3143 gets implicit TLS on a plain port.
- GreenMail 2.1.15 on 3143 (IMAP) and 3025 (SMTP) is plain; its TLS ports (3993, 3465) use a self-signed cert, and the cert check cannot be switched off (`imapFlowOptions` never sets `tls`).

Effect (not run: no Docker in this job): `lab seed` connects through `connectMailbox`, which logs in with the same options, so on the real sim stack `lab seed` fails at the mailbox step and the server cannot sync the mailbox. The integration test uses a fake mail provider, so it does not show this.

Options (the coordinator decides; stage 03 decides the stack):

1. Put `greenmail` into the network namespace of `fake-telegram` (`network_mode: service:fake-telegram`, as `server` and `lab` do) and use host `127.0.0.1`. The lab mailbox host constant then changes to `127.0.0.1` (one constant, `LAB_MAIL_HOST` in `modules/lab/seed.ts`; its test names it).
2. Add a per-mailbox `secure` flag. This needs a migration and touches production code: larger.
3. Give GreenMail a certificate that the server image trusts (`NODE_EXTRA_CA_CERTS`) and use 3993 and 3465.

Guess (not verified): option 1 is the smallest. Stage 07 (injector) and stage 08 (bots) talk to GreenMail with their own clients, so they can use plain ports on the service name; only the server needs the loopback name.
