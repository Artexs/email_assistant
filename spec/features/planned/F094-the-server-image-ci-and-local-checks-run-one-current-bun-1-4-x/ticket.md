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
- A STARTTLS test proves that a trusted certificate for another name is refused for an IP host, and no password goes out.
- A deploy of the image on the home VPS keeps the pilot mailbox syncing (owner's go needed).
- `docs/known-alerts.md` and `notes/2026-11-13-bun-version-drift.md` say that the drift is closed.
- Every line of "Done when" in [plan.md](plan.md) holds.

## Slices

Two stages, in order, each landed with `limen land --keep-open`; the stage 2 land closes the ticket.

1. `stages/stage-01-pin-1-4-4.md` [risky]: the pin, the STARTTLS test, the docs. Review job before the land; CI runs on a `task/` branch before the land.
2. `stages/stage-02-vps-deploy.md`: owner step (VPS deploy, owner's go), then a short job records the result.

No migration, no `bun.lock` change. Owner checkpoint before stage 2. Commands: [plan.md](plan.md) § "How to run".

## Sequenced

- Plan after: none.
- Build after: the CI-green ticket that set up the pin (F093, in `done/`) and the module-border lint (F086, "next and alone" in `docs/product/stage-2/07-foundation-plan.md` §2), both in `done/`.
- Gate: none for stage 1. Stage 2: the owner's go, and no other VPS deploy runs at the same time (`docs/product/stage-2/05-execution-plan.md` §4).

## Notes

- Opened by the coordinator after F093 stage 1 (plan § How to run, item 5). Design, facts and probes: [plan.md](plan.md). Defaults to confirm: [questions.md](questions.md).
