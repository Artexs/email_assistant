# F113 stage 06: the host `greenmail` and TLS (decided: option 1)

Found while writing `seedLabOrg` (2026-11-15). The coordinator took option 1 the same day. The decision is built.

Observed in the code:

- `apps/server/src/modules/mail/imap/client.ts:86` (`imapFlowOptions`): `secure = opts.secure ?? !isLoopbackHost(opts.host)`. Plain IMAP is allowed only to a loopback host (`127.0.0.1`, `localhost`, `::1`).
- `apps/server/src/modules/mail/imap/smtp.ts:65`: the same rule for SMTP.
- `apps/server/src/modules/mail/open.ts` passes no `secure`: the sync and the committer open every mailbox row with the default. A row with host `greenmail` and port 3143 gets implicit TLS on a plain port.
- GreenMail 2.1.15 on 3143 (IMAP) and 3025 (SMTP) is plain; its TLS ports use a self-signed cert, and the cert check cannot be switched off.

Decision (option 1): `greenmail` in `deploy/compose.sim.yaml` has `network_mode: service:fake-telegram` (as `server` and `lab`). The lab mailbox host is `127.0.0.1` (`LAB_MAIL_HOST` in `apps/server/src/modules/lab/seed.ts`). GreenMail publishes no port and has no name on the network. `sim-compose-rules.ts` checks both (`network_mode_not_fake_telegram`, `greenmail_port_published`). The injector and the delegate bots of later stages run in the `lab` container, in the same namespace, and use `127.0.0.1` too.

Rejected: a per-mailbox `secure` flag (migration, production code); a GreenMail certificate that the server image trusts.

Not verified: a real `docker compose up` of the stack (no Docker in the job). The Compose file is checked by `sim-compose-rules.test.ts` only. First start at C1 must show GreenMail on 127.0.0.1:3143 inside the `server` container.
