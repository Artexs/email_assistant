# F166 stage 09 — The page head contract

Part of [`../plan.md`](../plan.md). Needs: stage 03 (the type scale). May run next to 04, 05, 06, 07, 10. The shell ticket and the three page tickets wait for this stage: keep it small and exact.

## Step 1 — `PageHead`

- **Files:** `apps/web/src/components/patterns/PageHead.tsx`, a section file in `apps/web/src/dev/sections/` when stage 08 is on your base (else say so in the final message), a render test in `apps/web/src/lib/`.
- **Interface:** `PageHead({ title: string; lead?: string; action?: ReactNode })` (`../interfaces.md`).
- **Decisions (mockup `.pagehead`):** one `h1`: `text-3xl` from `lg`, `text-2xl` below, bold, tight tracking. The lead is one line of `text-muted-foreground` under the title. The action sits at the end of the row from `lg` and wraps under the title below `lg`. Below `lg` the lead is hidden only when an action is present. A margin of 22 px (14 px below `lg`) follows the head.
- **Test:** (1) a render with a title, a lead and an action has exactly one `h1` with the title text. (2) With no lead and no action, the head renders the `h1` only.

## Step 2 — The shell renders the head

- **Files:** `apps/web/src/components/shell/AppShell.tsx`.
- **Interface:** `AppShellProps` gains `lead?: TextKey` and `action?: ReactNode` (`../interfaces.md` § Shell contract).
- **Decisions:** DB-9. The shell renders one `PageHead` at the top of `main` for every width: the title is `t(pageTitle(active, title, features))` as today, the lead is `t(lead)` when given. The two old `h1` elements go. The sticky top bar of a phone keeps its menu button and shows the brand text (`t("brand")`) as plain text, not as a heading. The screen for a user with no organization keeps its own `h1` (no shell around it). While `me` loads, the head shows the title; the lead and the action show too (they do not depend on `me`). No island changes in this stage: both new props are optional.
- **Edge cases:** the Delegations page with the open-loops flag gets its other title through `pageTitle` as today; the `document.title` logic does not change; the banners and dialogs stay above the head, in today's order.
- **Test:** (3) a scan test: no file in `apps/web/src/islands/` and no feature component under `apps/web/src/components/` contains `<h1`, except `patterns/PageHead.tsx`, `shell/AppShell.tsx` (the no-organization screen) and `auth/AuthCard.tsx` (pages before sign-in). (4) e2e: on both projects, `/activity` has exactly one visible `h1` and its text is the page title; with the open-loops organization of the seed, `/delegations` has the open-loops title. (5) The docs-shots spec still finds its heading: its locator is a heading with the page title, which test 4 proves for both projects.

## Out of scope

The look of the sidebar, the tab bar, the top bar and the menu (the shell ticket). A `lead` or `action` in any island (the page tickets). New text keys.

## Done when

You opened `activity`, `settings` and `approvals` in the contact sheet (phone and desktop, both schemes, both languages) and each has one title in the new size; Proof B of `../plan.md` prints `PROOF_OK`.
