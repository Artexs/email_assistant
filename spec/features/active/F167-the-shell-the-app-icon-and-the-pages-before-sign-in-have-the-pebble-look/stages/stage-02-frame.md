# F167 stage 02 — The desktop frame: sidebar, user menu, banner slot, page states

Part of [`../plan.md`](../plan.md). Needs F166 stage 09: `AppShell` with `lead`, `action` and the one `PageHead`. Needs F166 stage 06: `InitialsAvatar`. Needs F166 stage 03: `bg-primary-soft`, `bg-sidebar`, radius `xl`, `shadow-card`. Needs stage 01: `BrandMark`. Needs F166 stage 08: `web:build:dev` (the Proof). May run next to 04, 05, 06, 07.

This stage owns `AppShell.tsx`, `Nav.tsx` (`Sidebar`, `SidebarLink`), `UserMenu.tsx` and creates `apps/web/e2e/tests/shell.spec.ts`. Stage 03 edits the same files for the phone parts after this stage lands. It does not edit `nav-items.ts` (D1), the files of stage 04, or a pattern file (D14).

## Step 1 — Grid and sidebar

- **Decisions:** D7, D8, D2; the mockup `.app` and `.side`. The sidebar card: `BrandMark` and the brand name (18 px, extra bold, a `p`) at the top, the items, the foot at the bottom. A 1 px border in forced-colors mode (DB-7).
- **Short windows:** when the items do not fit the card height, the item list scrolls inside the card; the brand and the foot stay visible.
- The `PageHead` stays where F166 stage 09 put it; this stage sets only the padding around it.

## Step 2 — User menu and banner slot

- **`UserMenu`:** props become `{ name: string; email: string; onLogOut }` (the caller passes `me.user.displayName`). The trigger shows `InitialsAvatar size="sm"`, the name, and the email in `text-xs text-muted-foreground`, both truncated. It keeps `aria-label={t("user_menu_named", { email })}` and its menu items. Loading and no-email states as today.
- **Banner slot:** the banners, the trial line and the "what is new" card stay in today's order above the `PageHead`, in the content column with the side padding of `main` and a 12 px gap. Stage 04 owns their look and gives them no outer margin.

## Step 3 — Page states

- **Loading:** three skeleton cards (radius `lg`); keeps `aria-busy="true"` (the docs-shots spec waits for it to go).
- **Load error:** a card with `load_error_text` and the `retry` button.
- **No organization:** a centred card with `BrandMark`, its own `h1`, the text and the log out button.
- **Toasts:** the `Toaster` keeps `top-center`.

## Step 4 — Capability page

`docs/capabilities/web-panel.md`: add one new rule at the end of § Rules, "The shell frame": the desktop part (D7, D8). Stage 03 adds the phone part to the same rule.

## Test

New `shell.spec.ts`, `desktop` project. The main organization of the e2e seed has no `approvals_page` and no `stats_page`; the approvals organization (`seed-approvals.ts`) has both. Each case names its account:

1. Main owner, `/activity`: the `aside` around `navigation` `nav_main` has `border-radius` `28px`; the active link has background `rgb(213, 240, 234)` and colour `rgb(10, 117, 104)`; an inactive link has a transparent background.
2. The same in the dark scheme (`emulateMedia`): the active link background is `rgb(19, 59, 52)`.
3. Main owner: the user menu button shows the owner's display name from the seed, keeps the accessible name `en.user_menu_named` with the email, and its menu holds `en.log_out`.
4. `forcedColors: "active"`: the sidebar border width is `1px`.
5. Viewport 1280 × 560, approvals owner with onboarding open: the user menu button is visible without a page scroll.
6. The suspended organization of `plan.spec.ts`: the left edge of the paused banner equals the left edge of the `h1`.
7. `activity`, `approvals`, `delegations`, `delegates`, `mailboxes`, `settings`, `rules`, `stats`, `onboarding`, `review`, `report`, each signed in as the account that the page's own spec uses today: exactly one visible `h1`, with the page title.
8. The a11y scan of `/activity` passes. `nav-items.test.ts` passes unchanged (D1); the badge cases of `approvals-components.test.tsx` pass.

## Out of scope

The phone header, the menu sheet and the tab bar (stage 03). The look of banners, the terms dialog and the "what is new" card (stage 04). Any page content, `lead` or `action` (the page tickets).

## Done when

You opened `activity`, `settings` and `approvals` (desktop, both schemes, both languages) in the contact sheet next to the mockup shots `05-activity-desktop-*` and `04c-settings-desktop-*`; the Proof of `../plan.md` with `bun run test:e2e` prints `PROOF_OK`.
