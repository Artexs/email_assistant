---
opened: 2026-11-23
---

# F167 · The shell, the app icon and the pages before sign-in have the Pebble look

## Outcome

The frame around every page has the Pebble look: a floating sidebar on a desktop, a brand header and a bottom tab bar on a phone, and a page head with a title, one lead line and one action. The app icon, the favicon and the browser colour are teal. The pages a person sees before sign-in (sign in, forgot password, setup from an invite, the legal pages, 404, offline) have the same look.

## Scope

- `apps/web/src/layouts/`, `apps/web/src/components/shell/` (sidebar, phone header and menu, tabs, user menu, banners, terms dialog, "what is new" card, toasts, loading and error states).
- The page head contract: the island passes `lead` and `action` to the shell (programme decision DB-9).
- Brand assets: favicon, the three app icons, `manifest.webmanifest`, `theme-color` for both schemes, the brand mark component.
- Login, forgot, setup, the legal reading layout, 404, offline, the `/` redirect page.

## Out of scope

- The content of a signed-in page (the three page tickets).
- A change of navigation order, names or addresses (programme decision PB-4).
- The docs site (its own ticket).

## Acceptance

- On a 1280 px screen the sidebar floats as a rounded card and the active item has the soft teal fill; on a Pixel 7 the tab bar shows the same items as before this ticket.
- Every item that does not fit in the tab bar is reachable from the phone header, also in Polish.
- Each signed-in page shows its title and a lead line from the shell, and has exactly one `h1`.
- The login page shows the brand panel on a desktop and only the form on a phone; every sign-in state (wrong password, code step, SSO, rate limit) keeps its text and its test.
- The installed app shows the teal icon; `theme-color` differs between light and dark.
- The offline page renders with the new look with no network.

## Slices

Stages come from the plan. The shell frame and the page head contract are the first stage; the page tickets wait for it.

## Sequenced

- Plan after: F166 (its `interfaces.md`).
- Build after: F166. Gate: none.

## Notes

Programme page: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md).
