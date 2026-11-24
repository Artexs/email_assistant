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

Ten stages, one worker job each: [`plan.md`](plan.md) § Stages. Settings has a frame stage and four section stages. Eight stages start at once; the settings mailbox cards and onboarding wait for the settings frame. No stage changes a migration or `bun.lock`. No owner checkpoint.

## Sequenced

- Plan after: F166, the design system (its `interfaces.md` and stages 03, 06, 09, 10).
- Build after: none. Gate: the stages need F166 stages 03 (tokens), 06 and 10 (patterns) and 09 (page head contract). May build next to F167, F168 and F169.

## Notes

Programme page: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md).
