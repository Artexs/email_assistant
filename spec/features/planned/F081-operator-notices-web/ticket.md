---
opened: 2026-11-12
---

# F081 · The operator sees the operator notices in one place

## Outcome

The operator reads the three operator events (`trial_ending`, `llm_cap`, `auth_error_24h`) and the later ones (S6b auth mail, S6f) in one list in the panel. Today they exist only as a Telegram message to `OPERATOR_TELEGRAM_CHAT_ID` or as a `warn` log line.

## Scope

- Start at `modules/channels/operator.ts`. Each sent notice already writes an audit row `operator.notice` with `data = { kind, key }` in the organization of the event. A list can read those rows, but the text is not stored: store the text, or build it from the kind and the key.
- Decide who the operator is in the panel (a flag on a user, or an env list), and where the list lives. The role `owner` of a customer organization must never read another organization's notices.
- One route, one page, one test per rule of the route matrix (`docs/code-patterns.md` "HTTP routes").

## Out of scope

- New events. Push channels other than Telegram.

## Acceptance

- The operator sees the notices of all organizations in one list; an owner of a customer organization gets 403 or 404 (test).
- The list holds ids, dates and codes only.

## Notes

Follow-up of F077 stage 17. S6a stops at the frame (D31).
