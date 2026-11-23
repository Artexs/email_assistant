# F167 stage 02 — The frame: sidebar, phone header, tab bar, user menu

Part of [`../plan.md`](../plan.md). Needs F166 stage 09: `AppShell` with `lead`, `action` and the one `PageHead`. Needs F166 stage 06: `InitialsAvatar`. Needs F166 stage 03: `--tabbar-height`, `bg-primary-soft`, radius `xl`, `shadow-card`. Needs stage 01: `BrandMark`. May run next to 03, 04, 05.

This stage owns `AppShell.tsx`, `Nav.tsx`, `UserMenu.tsx` and the new spec `apps/web/e2e/tests/shell.spec.ts`. It does not edit `nav-items.ts` (D1), the files of stage 03, or a pattern file (D14).

## Step 1 — Desktop frame and sidebar

- **Decisions:** D7, D8, D2; the mockup `.app` and `.side`. The sidebar card: `BrandMark` and the brand name (18 px, extra bold) at the top, the items, the foot at the bottom. A 1 px border in forced-colors mode (DB-7). The `PageHead` stays where F166 stage 09 put it; this stage sets only the padding around it.
- **Banner slot:** the banners, the trial line and the "what is new" card stay in today's order above the `PageHead`, in the content column with the side padding of `main` and a 12 px gap. Stage 03 owns their look and gives them no outer margin.
- **`UserMenu`:** props become `{ name: string; email: string; onLogOut }` (the caller passes `me.user.displayName`). The trigger shows `InitialsAvatar size="sm"`, the name, and the email in `text-xs text-muted-foreground`, both truncated; it keeps `aria-label={t("user_menu_named", { email })}` and its menu items. Loading and no-email states as today.

## Step 2 — Phone header, menu sheet and tab bar

- **Header** (mockup `.mhead`): sticky, `bg-background`, no border; `BrandMark size="sm"` and `t("brand")` as a `p` at the start, the `menu_open` button at the end (D1, D3).
- **Menu sheet:** the same content in today's order; the person row shows `InitialsAvatar`, the name and the email; items have the look of D8.
- **Tab bar:** D9; label `text-xs` bold; the badge at the icon.
- **Edge cases:** at 320 px five tabs fit with no sideways scroll (a label may wrap, never cut); "99+" stays inside its tab. Under `prefers-reduced-motion` the sheet does not animate (check the `Sheet` primitive; do not edit `components/ui/`; a gap there is a question).

## Step 3 — Loading, error and no-organization states

- **Loading:** three skeleton cards (radius `lg`); keeps `aria-busy="true"` (the docs-shots spec waits for it to go).
- **Load error:** a card with `load_error_text` and the `retry` button.
- **No organization:** the centred card look of the pages before sign-in (`BrandMark`, its own `h1`, text, log out button).

## Step 4 — Capability page

`docs/capabilities/web-panel.md` rule 9: what the frame shows on a desktop and on a phone.

## Test

New `shell.spec.ts`, signed in as the main owner of the e2e seed:

1. `desktop`: the `aside` around `navigation` `nav_main` has `border-radius` `28px`; on `/activity` the active link has background `rgb(213, 240, 234)` and colour `rgb(10, 117, 104)`; an inactive link has a transparent background.
2. `desktop`, dark scheme (`emulateMedia`): the active link background is `rgb(19, 59, 52)`.
3. `mobile`: the tab link names, in order, equal the labels of `phoneTabs(<seed features>)`; the bar is 64 px high; the active tab colour is `rgb(10, 117, 104)`.
4. `mobile`: the phone header holds no heading and holds the text `en.brand`.
5. Both projects, each signed-in route whose flag is on in the seed (`activity`, `approvals`, `delegations`, `delegates`, `mailboxes`, `settings`, `rules`, `stats`, `onboarding`, `review`, `report`): exactly one visible `h1`, with the page title.
6. `mobile`, Polish locale: after `menu_open`, each `phoneOverflow` item is a link with its `pl` label; Stats opens `/stats`.
7. `mobile` at 320 px wide: `/activity` has `scrollWidth` ≤ 320.
8. `desktop` with `forcedColors: "active"`: the sidebar border width is `1px`.
9. The a11y scan of `/activity` passes on both projects.
10. `nav-items.test.ts` passes unchanged (D1); the badge cases of `approvals-components.test.tsx` pass.

## Out of scope

`nav-items.ts`. The look of banners, the terms dialog and the "what is new" card (stage 03). Any page content, `lead` or `action` (the page tickets).

## Done when

You opened `activity`, `settings` and `approvals` in the contact sheet (phone and desktop, both schemes, both languages) next to the mockup shots `05-activity-*` and `04c-settings-*`; the Proof of `../plan.md` with `bun run test:e2e` prints `PROOF_OK`.
