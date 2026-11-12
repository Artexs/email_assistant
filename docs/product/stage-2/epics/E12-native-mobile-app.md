# E12 · Native mobile app

> Tier: Later (Stage 2 end or Stage 3). Status: deferred; discovery after the E9 PWA is in use (PD-012). Not before E4, E7 and E9. Size: 40+ stages, 8k lines; a second codebase. Owner idea: "mobile application is also great idea".

## Outcome

The phone is the main control channel: notices, the brief, approvals, Undo, delegation status, with biometric unlock and push through APNs and FCM. Mail content never passes a third-party chat.

## Users

Executive on the phone.

## In scope

- Expo (React Native) app on the same channel-neutral API as the panel and Telegram; token auth for a mobile client (Better Auth `bearer` plugin); versioned public API (OpenAPI, from E4).
- Push notices with ids and counts only; the app fetches content over the authenticated API.
- Screens: brief, approvals (full context, edit, approve), delegation status, Undo, settings subset.
- Store builds for the owner's phone (TestFlight and an internal track); no public store listing (boundary).

## Out of scope

Reading or writing mail in the app (it is a control surface, not a mail client). Voice and the agent (Stage 3, same API).

## Dependencies

E4 (API commands, approvals), E7 (login hardening, identity), E9 (PWA first proves the push and API path).

## Open product questions

1. Go or no-go after the PWA: if the PWA covers the daily use, the native app waits for Stage 3 with the agent.

## Risks

- A second codebase doubles the surface to keep in sync; the API contract and the PWA first keep the risk low.

## Exit

- The owner uses the app for one week of approvals and notices without Telegram content; push latency is within M5.
