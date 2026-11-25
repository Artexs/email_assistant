# F167 stage 03 — The phone frame: header, menu sheet, tab bar

Part of [`../plan.md`](../plan.md). Needs stage 02: the new `AppShell.tsx`, `Nav.tsx`, `UserMenu` props and `shell.spec.ts`. Needs F166 stage 03: `--tabbar-height`, `bg-card`. Needs F166 stage 08: `web:build:dev` (the Proof). May run next to 04, 05, 06, 07.

This stage owns the phone header in `AppShell.tsx`, `MenuSheet` and `BottomTabs` in `Nav.tsx`, and the `mobile` cases of `shell.spec.ts`. It does not edit `nav-items.ts` (D1).

## Step 1 — Header and menu sheet

- **Header** (mockup `.mhead`): sticky at the top, `bg-background`, no border; `BrandMark size="sm"` and `t("brand")` as a `p` at the start, the `menu_open` button at the end (D1, D3). No heading in the header.
- **Menu sheet:** the same content in today's order (onboarding item, overflow items, operator item, help link, the person, log out). The person row shows `InitialsAvatar`, the name and the email. Items have the look of D8.
- **Reduced motion:** under `prefers-reduced-motion` the sheet does not animate. Check the `Sheet` primitive; do not edit `components/ui/`; a gap there is a question.

## Step 2 — Tab bar

- **Decisions:** D9; the mockup `.mtabs`. Items, order and the 4- or 5-column rule stay (`phoneTabs`). Label `text-xs` bold; the active tab `text-primary`; the badge at the icon.
- **Edge cases:** at 320 px five tabs fit with no sideways scroll (a label may wrap to two lines, never cut); "99+" stays inside its tab. The bottom padding of `main` follows D7, so the last line of a page is never under the bar.

## Step 3 — Capability page

`docs/capabilities/web-panel.md`, the rule "The shell frame" that stage 02 added: the phone part (header, sheet, tab bar).

## Test

In `shell.spec.ts`, `mobile` project (Pixel 7). The main organization has 4 tabs and no overflow; the approvals organization has 5 tabs and the overflow Stats (as `approvals.spec.ts` T10 shows today).

1. Approvals owner: the 5 tab link names, in order, equal the labels of `phoneTabs(["approvals_page", "stats_page"])`; the bar is 64 px high; the active tab colour is `rgb(10, 117, 104)`.
2. Main owner: the phone header holds no heading and holds the text `en.brand`; the page has one visible `h1`, the page title.
3. Approvals owner, Polish locale: after `menu_open`, the dialog holds a link `pl.nav_stats` that opens `/stats`.
4. Approvals owner with waiting drafts, viewport 320 px wide: `/activity` has `scrollWidth` ≤ 320, and the badge box of the approvals tab lies inside the tab box.
5. Main owner, `/settings`: the bottom edge of the last element of `main` is above the top edge of the tab bar after a scroll to the end.
6. `reducedMotion: "reduce"`: the opened sheet has a computed `animation-duration` of `0s` or `animation-name` `none`; if not, write it as a question.
7. The a11y scan of `/activity` passes on `mobile`. `auth.spec.ts` ("a login opens the shell": 4 tab links, the sheet) and `approvals.spec.ts` T10 pass unchanged.

## Out of scope

The desktop sidebar (stage 02). Banners and dialogs (stage 04). The StickyActions bar (F166; it reads `--tabbar-height`).

## Done when

You opened `activity`, `approvals` and `settings` (phone, both schemes, both languages) in the contact sheet next to the mockup shots `05-activity-phone-*` and `02-approvals-phone-*`; the Proof of `../plan.md` with `bun run test:e2e` prints `PROOF_OK`.
