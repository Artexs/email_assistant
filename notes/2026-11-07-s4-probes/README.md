# S4 plan probes (2026-11-07)

The S4 plan (`spec/features/done/2026-11/F006-s4-drafts-approvals-delegation/plan.md`, "Facts checked") uses the results of these four local probes. They ran on the Mac with Bun 1.4.4, nodemailer 10.3.1, imapflow 1.7.8 and GreenMail 2.1.15. They hold only fake test credentials (`owner@x.test` / `secret` on a fake local server).

The files have the extension `.ts.txt`. Then `eslint .` and the typecheck do not read them (they do not follow the repo's lint rules).

| File            | What it checks                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `probe.ts.txt`  | nodemailer error `code` / `command` per SMTP stage (scripted fake server); `MailComposer` gives byte-equal builds. |
| `probe2.ts.txt` | `SMTPConnection` used directly: `connect` / `login` / `send` as separate stages; `lastServerResponse`.             |
| `probe3.ts.txt` | imapflow APPEND on GreenMail: uid, flags, INTERNALDATE, header fetch, `SEARCH SINCE`, delete.                      |
| `probe4.ts.txt` | A `transactionLog` logger on `SMTPConnection` sees the client `DATA` line and the server replies, not the content. |

## How to run one again

1. `mkdir /tmp/ea-s4-probe && ln -s "$PWD/node_modules" /tmp/ea-s4-probe/node_modules` (from the repo root).
2. `cp notes/2026-11-07-s4-probes/probe4.ts.txt /tmp/ea-s4-probe/probe4.ts`.
3. `bun /tmp/ea-s4-probe/probe4.ts`. Probe 3 needs the dev GreenMail (`bun run dev:up`, IMAP port 3143).
