---
opened: 2026-11-23
---

# F170 · Onboarding, Mailboxes, Settings, Stats, the report and the operator console have the Pebble look

## Outcome

The setup and control pages have the Pebble look. Onboarding shows its progress and explains the two modes as cards. Mailboxes are cards with a clear status. Settings is split into titled sections that a user can jump between. Stats opens with the handled share and three key numbers above the full table. The shadow report and the operator console follow the same patterns.

## Scope

- Onboarding (steps, progress ring, mode cards that open today's mode dialog).
- Mailboxes (cards, every status, the OAuth banners, the connect, password and remove dialogs).
- Settings: all cards, in-page navigation, the account and security parts.
- Stats and the shadow report; the operator console (theme, dense tables).
- The e2e specs and the capability and user docs of these pages.

## Out of scope

- Moving a control to another page (programme decision PB-4).
- New metrics, the weekly bar chart, a mailbox pause (programme decision PB-7).
- A change of the mode gates, the trust checks or any API.

## Acceptance

- The mode cards in onboarding set nothing by themselves: a tap opens the same dialog and checks as Settings does today.
- Every mailbox status (connected, login error, refused host, revoked access, never synced) has its own card state.
- Each settings card keeps its `data-card` name and its anchor; a user reaches any section in one tap on a phone.
- Stats shows the handled share ring and three numbers from the existing week data, and dashes where a week has none.
- The operator console passes the a11y scan in both schemes and keeps its tables.
- Each page looks right with its flags off and on in the contact sheet.

## Slices

Stages come from the plan. Settings is the largest part and is split by section.

## Sequenced

- Plan after: F166 (its `interfaces.md`), F167 (its plan: the page head contract).
- Build after: F166; F167 stage 01. Gate: none. May build next to F168 and F169.

## Notes

Programme page: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md).
