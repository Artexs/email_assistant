---
opened: 2026-11-19
landed: 2026-11-20
---

# F149 · Telegram callbacks dispatch through a family registry

## Outcome

Telegram callbacks dispatch through a family registry. Each callback kind has one entry that names its family, its wire prefix and its codec; each family has one server handler. A new kind or family is one entry, and the typecheck fails until it has a codec and a handler. Every button in a chat today keeps its exact data and its behaviour.

## Scope

- The callback codec in `@ea/core` (`packages/core/src/digest/callback.ts`): one record keyed by kind replaces the encode and decode switches and the family predicates.
- The dispatch in the Telegram channel (`handleCallback`, `apps/server/src/modules/channels/callbacks.ts`): one record keyed by family replaces the if-chain.
- The feedback tap body leaves `handleCallback` for its own handler.
- The callback rule in `docs/capabilities/digest-and-notices.md`.

## Out of scope

- New callback kinds, new prefixes or a new wire format.
- Changes inside the family handlers (role checks, flags, consent, answers).
- The Telegram transport, the fake Telegram server and the web or push taps.
- The live lab bot and the simulator, which press buttons by prefix string (`lab/executive.ts`, `sim/live/executive.ts`).

## Acceptance

- For each of the 33 callback kinds, `encodeCallback` gives the same string as at the plan base, and `parseCallback` gives the value back (one table test over all kinds).
- Each forged or old data string of the existing core callback tests still parses to `null`.
- A kind with no family, prefix or codec, and a family with no handler, fail `bun run typecheck`.
- `handleCallback` has no if-chain over families; a unit test sends one callback of each of the 6 families and sees only that family's handler run.
- The existing integration tests of the taps pass unchanged (`channels-callbacks`, loop, delegate, reply and answered tap tests).

## Sequenced

Plan after: none.
Build after: none. Gate: —.

## Notes

Source: `spec/quality/2026-11-20-pass-2.md` finding 10. Plan, decisions and stages: `plan.md`.
