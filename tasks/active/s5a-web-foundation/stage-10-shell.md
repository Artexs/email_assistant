# s5a-web-foundation — Stage 10

Part of [`../s5a-web-foundation.md`](../s5a-web-foundation.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 10 — Shell: the `App.astro` layout, the React shell (tabs, sidebar, menu sheet, user menu, banner, states), placeholder app pages

- [ ] **10.1 `App.astro`, `AppShell`, `MeProvider`, the nav, the banner, the shell states**
  - Goal: every app page renders one island that wraps its content in the shell of U3 and S5–S8, S11, S12: a bottom tab bar and a top bar under 1024 px, a left sidebar from 1024 px, one user control with "Log out", the `auth_error` banner from `/api/me.mailboxesInAuthError`, the loading skeleton, the "no organization" and "could not load" states, and the sonner `Toaster` for U6.
  - Files: create `apps/web/src/layouts/App.astro`, `apps/web/src/components/shell/AppShell.tsx`, `apps/web/src/components/shell/MeProvider.tsx`, `apps/web/src/components/shell/Nav.tsx`, `apps/web/src/components/shell/UserMenu.tsx`, `apps/web/src/components/shell/AuthErrorBanner.tsx`, `apps/web/src/components/shell/Placeholder.tsx`, `apps/web/src/components/shell/nav-items.ts`.
  - Interfaces:

    ```ts
    // nav-items.ts
    export type NavKey = "onboarding" | "activity" | "mailboxes" | "settings" | "rules";
    export interface NavItem { key: NavKey; href: `/${NavKey}`; label: TextKey; icon: LucideIcon }
    export const TAB_ITEMS: NavItem[]; // activity, mailboxes, settings, rules (Activity, Inbox, Settings, ListFilter icons) — the bottom tabs and the sidebar body
    export const ONBOARDING_ITEM: NavItem; // ClipboardList icon
    // MeProvider.tsx
    import { meSchema, type Me } from "@ea/core/web";
    export interface MeState { me: Me | null; error: unknown; loading: boolean; reload: () => void }
    export function MeProvider({ children }: { children: ReactNode }): JSX.Element; // useResource(() => api("/api/me", meSchema), { pollMs: 30_000 })
    export function useMe(): MeState;
    // AppShell.tsx
    export interface AppShellProps { active: NavKey; title: TextKey; children: ReactNode }
    export function AppShell(props: AppShellProps): JSX.Element; // <MeProvider><Frame …/></MeProvider>; Frame reads useMe()
    // Nav.tsx
    export function BottomTabs({ active }: { active: NavKey }): JSX.Element; // <nav aria-label={t("nav_main")}> fixed bottom, lg:hidden
    export function Sidebar({ active, onboardingOpen, email, onLogOut }: …): JSX.Element; // <aside> hidden lg:flex; its bottom block is the UserMenu
    export function MenuSheet({ active, onboardingOpen, email, onLogOut }: …): JSX.Element; // the phone ☰ button + Sheet (side "right")
    // UserMenu.tsx
    export function UserMenu({ email, onLogOut }: …): JSX.Element; // DropdownMenu: the trigger is a Button with the truncated e-mail, aria-label={t("user_menu")}; items: the e-mail (disabled) and "Log out"
    // AuthErrorBanner.tsx
    export function AuthErrorBanner({ count }: { count: number }): JSX.Element | null; // null when count is 0
    // Placeholder.tsx
    export function Placeholder(): JSX.Element; // <p className="text-muted-foreground">{t("placeholder_text")}</p> inside a Card
    ```

  - Decisions:
    - **One island per page, the shell inside it** (D17 as refined): `App.astro` is a thin HTML layout (the same head as `Public.astro`, S5 title form, `<noscript>` S9, `<body>` with `<slot />`); the page island (10.2, S5b–S5d) renders `<AppShell active="…" title="…">…</AppShell>`. Reason: the shell and the page share one React tree and the `/api/me` data through `useMe()`; nested islands could not share it. The Astro build renders the island to HTML, so the first paint shows the shell with skeletons before hydration (U4).
    - `onboardingOpen = me === null || me.onboarding === null || !me.onboarding.done` (W5; S6: shown while unknown or open). Onboarding is in the phone menu sheet (S6) and first in the sidebar; the four bottom tabs never change.
    - Layout classes (U3): the frame is `min-h-screen lg:grid lg:grid-cols-[16rem_1fr]`; the sidebar `hidden lg:flex lg:flex-col lg:border-r` with the word mark (`t("brand")`), the nav list and, at the bottom, the `UserMenu` trigger (**the one user control on desktop**: cold review of this plan, finding 19); the phone top bar `sticky top-0 flex items-center justify-between border-b px-4 py-3 lg:hidden` with `<h1>` = `t(title)` and the `MenuSheet` trigger (`Button variant="ghost" size="icon"` with the `Menu` icon and `aria-label={t("menu_open")}`); `<main class="px-4 py-4 pb-24 lg:pb-8">` (room for the tabs); the desktop top row inside `<main>` shows the `<h1>` only; the bottom tabs `fixed inset-x-0 bottom-0 grid grid-cols-4 border-t bg-background lg:hidden` with icon over label, each an `<a>` with `aria-current="page"` when active (U9).
    - The `MenuSheet` content (S6, phone): the Onboarding link when open, the e-mail (plain text), a "Log out" `Button`. The desktop `UserMenu` (S7): the e-mail as a disabled item, "Log out". No "Account" item.
    - Log out: `await authClient.signOut()` then `location.assign("/login")`; a failure also goes to `/login` (the cookie is gone or the session is dead either way).
    - `AuthErrorBanner` (S8): `role="status"`, amber classes (`border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100`), the text key by count, a link `t("auth_error_banner_link")` → `/mailboxes`; rendered under the top bar, above `<main>`'s content; not dismissible; it disappears when the next poll gives 0.
    - Shell states (S12): `loading && me === null` → the sidebar and tabs render with a `Skeleton` in place of the e-mail and the content area shows `<div aria-busy="true">` with three `Skeleton` lines (U4); `error instanceof ApiError && error.code === "no_organization"` → the content area shows `t("no_organization_title")`, `t("no_organization_text")` and the "Log out" button (nav hidden: there is nothing to navigate to); any other error → `t("load_error_text")` and a `Button` `t("retry")` calling `reload()`; a 401 never reaches here (`api.ts` redirects, W19). `children` render only when `me !== null`.
    - `Toaster` from `components/ui/sonner` is mounted once in `AppShell` (`position="top-center"`); S5a shows no toast yet (U6 starts with S5b's actions).
    - Accessibility (U9): every icon button has an `aria-label`; the nav has `aria-label={t("nav_main")}` (a screen reader reads it, so it is a key: U1); links are real `<a>` (full page navigation between pages: each page is its own static HTML; no client router). The `jsx-no-literals` rule of stage 9.2 applies to every file of this step.
  - Test: the build and lint (`react-compiler`, `jsx-a11y`, `jsx-no-literals`) are the tests of this step; Playwright covers the behaviour in stage 13 (W20 cases 2, 3, 5, 6). A visual check with `astro preview`: `cd apps/web && bun run build && bunx astro preview` → open `http://localhost:4321/onboarding` at 400 px and 1280 px: the error state "Could not load your account." with Retry appears (no API behind `preview`), the tabs and the sidebar render, the menu sheet opens and closes, the browser console shows **no** CSP error (fact 13). Stop the preview.
  - Check: `bun run lint && bun run typecheck && cd apps/web && bun run build` (then the visual check above).
  - Done when: the build is green, the visual check matches U3 and S12, no CSP console error.
  - Out of scope: the login and setup pages (stage 11), real page content (S5b–S5d), toasts (S5b).

- [ ] **10.2 Placeholder app pages**
  - Goal: the five app routes exist as static pages with the shell, so the navigation, the redirects and the banner can be tested at checkpoint 1 (S11).
  - Files: create `apps/web/src/pages/{onboarding,activity,mailboxes,settings,rules}.astro` and `apps/web/src/islands/{Onboarding,Activity,Mailboxes,Settings,Rules}Page.tsx`.
  - Interfaces: each page: `---` `import App from "../layouts/App.astro"; import OnboardingPage from "../islands/OnboardingPage.tsx"; import { en } from "../i18n/en";` `---` `<App title={en.title_onboarding}><OnboardingPage client:load /></App>`. Each island: `export default function OnboardingPage() { return <AppShell active="onboarding" title="title_onboarding"><Placeholder /></AppShell>; }`.
  - Decisions: the island file names are `<Page>Page.tsx`; S5b–S5d replace `<Placeholder />` inside them and keep the file names (the S5b segment file names `islands/{Mailboxes,Onboarding}.tsx`; its plan session adopts these names: stage 15 writes the pointer). `client:load` on each (D17). Astro writes `dist/<page>/index.html` (the default `build.format: "directory"`), which D6 serves for `/<page>` and `/<page>/` (fact 9).
  - Test: `bun run web:build` → `dist/{onboarding,activity,mailboxes,settings,rules}/index.html` exist; each holds the meta CSP with `script-src 'self' 'sha256-` and `style-src 'self' 'unsafe-inline';`, the `<noscript>` text, the title `<title>Mailboxes · Email Assistant</title>` (one grep per page) and the pre-rendered loading state `aria-busy="true"` (the children render only after `/api/me` arrives, so the placeholder text is not in the static HTML; Playwright test 2 checks it live).
  - Check: `bun run lint && bun run typecheck && cd apps/web && bun run build` and the greps; with the server from stages 1–8 running in the worktree (`bun run dev`, the web keys of user step 1 set) `curl -sI http://127.0.0.1:8080/mailboxes` → `302` with `location: /login?next=%2Fmailboxes`; `curl -s http://127.0.0.1:8080/404.html | grep -c "Page not found"` → 1 (the server serves `dist`); `grep -rlE "__vite-browser-external|node:crypto" apps/web/dist/_astro` → nothing, and the build log has no "externalized for browser compatibility" line (`MeProvider` is the first page code that imports `@ea/core/web`; second cold review, finding 16). Run the database guard before `bun run dev`.
  - Done when: the five pages build with the shell and the checks pass.
  - Out of scope: any page content; the login and setup pages (stage 11).
