---
opened: 2026-11-13
---

# F094 · The server image, CI and local checks run one current Bun (1.4.x)

## Outcome

The server image, CI and every local check run the same current Bun (1.4.x). The pin in `.bun-version` is the only place that holds the version. The test-certificate workaround for Bun 1.3.14 is gone, and STARTTLS to a mail host given as an IP address verifies the certificate.

## Scope

- Move `.bun-version` and `deploy/Dockerfile` (line 1) to one current Bun 1.4.x; the `image` job in CI already checks that the two agree.
- Remove `DNS:localhost` from the STARTTLS test certificate (`apps/server/src/modules/mail/imap/smtp-starttls.test.ts`) when the pin moves past 1.3, as its comment says.
- Probe whether IMAP STARTTLS to an IP-literal host has the same quirk on Bun 1.3.14 (NV3 of F093), and record the result.
- Source: `notes/2026-11-13-bun-version-drift.md`, F093 `plan.md` D5, D9, Q1.

## Out of scope

- Any change to the mail host guard (`host-guard.ts`) or its IP-literal rule.
- Other dependency upgrades.

## Acceptance

- `cat .bun-version` and `head -n 1 deploy/Dockerfile` name the same Bun 1.4.x, and the `image` job passes.
- `bun run test:unit:ci` and `bun run test:int:ci` pass on that Bun, and the STARTTLS tests pass with no `DNS:localhost` in the certificate.
- A deploy of the image on the home VPS keeps the pilot mailbox syncing (owner's go needed).
- `docs/known-alerts.md` and `notes/2026-11-13-bun-version-drift.md` say that the drift is closed.

## Notes

- Opened by the coordinator after F093 stage 1 (plan § How to run, item 5). Needs `plan-task`; it touches the production image, so a VPS deploy step is part of it.
