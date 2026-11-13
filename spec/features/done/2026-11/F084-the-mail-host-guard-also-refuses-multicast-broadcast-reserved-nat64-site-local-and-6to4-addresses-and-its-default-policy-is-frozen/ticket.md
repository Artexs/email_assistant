---
opened: 2026-11-12
landed: 2026-11-13
---

# F084 · The mail host guard also refuses multicast, broadcast, reserved, NAT64, site-local and 6to4 addresses, and its default policy is frozen

## Outcome

A mail host that resolves to a multicast, broadcast, reserved, NAT64, site-local or 6to4 address is refused like a private address. The default guard policy cannot be switched off by a write to the exported object.

## Scope

- Source: the Opus review of F082 stage 8 (job `2026-11-12-f082-review-s08-3a61bd23`), notes marked plausible. Start at `apps/server/src/modules/mail/host-check.ts` (`isLocalAddress`) and `host-guard.ts` (`DEFAULT_MAIL_HOST_POLICY`).
- Add to `isLocalAddress`: multicast `224.0.0.0/4` and `ff00::/8`; broadcast `255.255.255.255` and reserved `240.0.0.0/4`; NAT64 `64:ff9b::/96`; site-local `fec0::/10`; 6to4 `2002::/16`.
- Freeze `DEFAULT_MAIL_HOST_POLICY` with `Object.freeze`.
- Remove or mark the unreachable ENODATA throw at `host-guard.ts:60-61` only if a test shows it cannot run.

## Out of scope

- The wiring of the guard into the connects (F082 stage 9). New allow lists.

## Acceptance

- One test per added range, with an edge value on each side, in `host-check.test.ts`.
- A test that writing to the default policy throws or has no effect.
- `bun run lint`, `bun run typecheck`, `bun run test:unit` pass.

## Notes

Starts after F082 stage 9 lands, so the guard is wired before it is widened.
