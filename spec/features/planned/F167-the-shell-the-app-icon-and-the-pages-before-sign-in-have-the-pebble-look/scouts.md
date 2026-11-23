# F167 scout packets

Four scouts, `claude-sonnet-5-5`, thinking medium, base `8c9acfc1e`. Packets copied whole. A packet is a lead, not a fact.

## Scout 1

**Question:** Map the signed-in shell of apps/web: every file in apps/web/src/components/shell/ and apps/web/src/layouts/, and nav-items.ts. How does the desktop sidebar render, how does the phone choose which items go into the bottom tab bar (the order rule, flags, counts) and how do the other items reach the phone (menu, sheet)? Which i18n keys do the nav labels use? Which e2e specs and unit tests assert shell selectors, data-* attributes, roles or texts (user menu, banners, terms dialog, what-is-new card, toasts, loading/error states)? List the h1/heading structure of the phone top bar.

**Job:** `2026-11-23-f167-scout-1-a2210aa1`

**Packet:**

````text
Packet: Map of the signed-in shell in apps/web, covering the sidebar, phone tabs and overflow, nav i18n keys, phone top-bar headings, and tests that assert shell UI.
Base: 8c9acfc1e
Verified: `git status --short` in the worktree -> (no output, clean). I ran no tests.
Unknowns: Whether `e2e/tests/stats.spec.ts`, `report.spec.ts` and `newsletters.spec.ts` assert shell selectors. I did not open them. I also did not read the unit tests or e2e lines for `loops-components` or `whats-new-card` beyond the greps below.

1. `apps/web/src/components/shell/AppShell.tsx` (observed)
   - **Layout:** The shell is a grid, `lg:grid-cols-[16rem_1fr]`. `<Sidebar>` comes first. The right column holds the phone `<header>`, then `AuthErrorBanner`, `PausedBanner`, `TrialLine`, `TermsDialog`, `WhatsNewSlot`, then `<main>`, with `<BottomTabs>` last. `<Toaster position="top-center" />` sits after `Frame`, inside `MeProvider`.
   - **Phone top bar headings:** The phone top bar is `<header class="sticky top-0 … lg:hidden">`. It holds one `<h1 text-lg>` with `t(heading)` and the `MenuSheet` button. `<main>` holds a second `<h1 class="hidden … lg:block">` with the same text.
     - Only one h1 is visible at a time, but both are in the DOM. The page title comes from the `title` prop through `pageTitle()`.
     - The brand is a `<p>` in the sidebar, not a heading. `WhatsNewCard` uses `<h2 id=whats-new-title>`. `TermsDialog` uses `DialogTitle`. The `no_organization` branch is its own `<main>` with an h1.
   - **Loading state:** `<div aria-busy="true">` with 3 `Skeleton`s.
   - **Error state:** `<p>{load_error_text}</p>` plus a `<Button onClick={reload}>{retry}</Button>`.
   - **Banners:** `AuthErrorBanner` is shown when `me.mailboxesInAuthError` > 0. `PausedBanner` is shown when `plan === "suspended"`. `TrialLine` is shown when `plan === "trial"`, the role is owner and `trialEndsAt` is set. `TermsDialog` is shown when `!me.terms.accepted`.
2. `apps/web/src/components/shell/nav-items.ts` and `Nav.tsx` (observed)
   - **Order and flags:** `ORDER` is Activity, Approvals (flag `approvals_page`), Delegations (flags `delegation_pages` or `open_loops`), Mailboxes, Settings, Rules, Stats (flag `stats_page`). Flag-less items always show. Delegations gets the label `nav_open_loops` and the title `title_open_loops` while `open_loops` is on.
   - **Phone tabs:**
     - `phoneTabs(features)` is `navItems(features).slice(0, PHONE_TAB_LIMIT)`. The limit is 5, so the order rule is plain panel order after the flag filter.
     - `BottomTabs` renders only these. It has no onboarding or operator item. Its grid is `grid-cols-4` or `grid-cols-5` from `TAB_COLUMNS`, and 4 is the fallback.
     - Each tab is an `<a>` with `aria-current="page"`, an icon, a label and an optional badge. `BottomTabs` has no `fixed` wrapper other than `<nav aria-label=nav_main class="fixed … lg:hidden">`.
   - **Phone overflow:** `MenuSheet` is a right-side `Sheet`, opened by a ghost icon button with `aria-label=menu_open`. Its contents, in order: the onboarding link (only while `onboardingOpen`), `phoneOverflow(features)`, the operator link, then at the bottom the `HelpLink` (with `docs_links`), the email or a Skeleton, and a Log out button. `SheetTitle` is `menu_title`. `SheetDescription` is `nav_main` with `sr-only`. The sheet uses `SidebarLink`.
   - **Desktop sidebar:** `<aside class="hidden … lg:flex">` holds the brand `<p>`, then `<nav aria-label=nav_main>` and `SidebarLink`s. The list is onboarding (while `me === null` or onboarding is not done), then all `navItems`, then the operator item. The foot holds `HelpLink` (with `docs_links`) and `UserMenu` (a Radix dropdown). It shows a Skeleton while loading, and a plain Log out button when there is no email.
   - **Approvals badge:** The badge is `approvalsBadge(count)`. It is `aria-hidden`, with the `sr-only` `nav_approvals_badge` ("{n} waiting") after it.
3. i18n keys (observed). `nav_*` labels are in `src/i18n/texts/en-auth.ts` and `pl-auth.ts` (lines 7-25).
   - **Nav items:** `nav_main`, `nav_onboarding`, `nav_activity`, `nav_mailboxes`, `nav_settings`, `nav_rules`, `nav_stats`, `nav_approvals`, `nav_approvals_badge`, `nav_delegations`.
   - **Elsewhere:** `nav_open_loops` and `title_open_loops` are in `en-approvals.ts:191`. `nav_operator` is in `en-activity.ts:84`.
   - **Menu and shell keys:**
     - Menu: `menu_open` ("Open menu"), `menu_title`, `user_menu`, `user_menu_named`.
     - Account: `log_out`, `brand`.
     - Banners and states: `help_link`, `whats_new_*`, `auth_error_banner` (a `tp` plural), `auth_error_banner_link`, `trial_ends_on`, `paused_banner`, `paused_banner_no_contact`, `load_error_text`, `retry`, `no_organization_*`.
     - Dialog: `terms_dialog_*`, `legal_*_title`.
   - **Static layouts:** The two Astro layouts hold no nav. `App.astro` and `Public.astro` import `en` directly and print `<title>`, the manifest and icon links, `theme-color #000832` and `noscript`. `Public.astro` adds the `<main>` and the brand `<p>`.
4. e2e specs that assert shell parts (observed by grep; Playwright projects are "mobile" and desktop):
   - **Nav and sheet:**
     - `auth.spec.ts:45-85` asserts 4 phone tab links, no `aria-current`, the menu sheet `dialog` with onboarding and email, and the `user_menu` button, `menuitem` and Log out. It uses `getByRole("navigation", {name: nav_main})`.
     - `approvals.spec.ts:135-150` is the test "T10: the phone tab bar holds 5 items and the menu holds Stats" (5 tab links, Stats only in the dialog, and an a11y check).
     - `delegations.spec.ts:521-533` and `open-loops.spec.ts:457-510` assert `aria-current` and the label swap.
     - `onboarding.spec.ts:83-89`, `plan.spec.ts:95-98`, `polish.spec.ts:73-75` (pl nav) and `docs-links.spec.ts:57-125` (Help link in the menu, What is new heading, links and dismiss button) assert related parts.
   - **Banners:**
     - `plan.spec.ts:28-42,109` asserts `paused_banner*` and `trial_ends_on` by text.
     - `auth.spec.ts:55` asserts `getByRole("status")` count 0, so the banners must keep `role=status`.
   - **Terms dialog:** `terms.spec.ts:27-62` asserts `getByRole("dialog")`, the title text, the link `rel`, the Escape and click-outside behaviour, the Log out button, the accept button, and `/api/me` terms.
   - **Headings and titles:** `h1` by `title_*` in `auth.spec.ts:52` and `language.spec.ts:36-45`.
   - **Toasts:** Many specs assert toasts with `page.getByText(en.*_toast)`. Examples are `settings.spec.ts`, `rules.spec.ts` and `activity.spec.ts`. No spec looks for the Sonner element.
   - **Loading state:** Only `docs-shots/shots.spec.ts:106` asserts `[aria-busy="true"]` count 0.
   - **Load error:** No e2e spec asserts `load_error_text`.
5. Unit tests (observed):
   - `src/lib/nav-items.test.ts` covers order, `PHONE_TAB_LIMIT`, `phoneTabs` and `phoneOverflow`, labels, `pageTitle` and `approvalsBadge`.
   - `src/lib/approvals-components.test.tsx:325-358` renders `Sidebar` and `BottomTabs` and asserts the badge markup (`>1</span>`, "1 waiting", "99+ waiting", `Oczekuje: 3`).
   - `src/lib/whats-new-card.test.tsx` asserts the card text, the `aria-label` on the dismiss button, hrefs, `rel` and the HelpLink.
   - `MeContext` is used by `account-card.test.tsx`, `notify-cards.test.tsx` and `reply-components.test.tsx` only to supply `me`, not for shell assertions.
   - `src/i18n/open-loops.test.ts` covers the `nav_open_loops` and `title_open_loops` keys.

Checks: `nav-items.test.ts` covers the order, flags, tab limit and overflow. `approvals-components.test.tsx` covers the badge markup. e2e `auth`, `approvals`, `docs-links`, `terms` and `plan` cover the nav roles, sheet, banners and dialog. No test covers the load-error branch, the `no_organization` page, `AuthErrorBanner`, the `UserMenu` contents beyond Log out, or the Sonner toast element.
````

## Scout 2

**Question:** Map the pages before sign-in in apps/web: login, forgot password, setup from invite, legal pages, 404, offline, the / redirect page. Give each page file, its layout, its island and components (AuthCard etc.), every sign-in state of the login (wrong password, TOTP code step, SSO, rate limit, others) and the e2e/unit tests that cover each state. How is the offline page served by the service worker (precache list, which CSS/font assets it can reach offline)? Which server paths list these pages as public (PUBLIC_PAGE_PATHS)? Does any legal page use hand-written CSS?

**Job:** `2026-11-23-f167-scout-2-9d94e63a`

**Packet:**

````text
Packet: pre-sign-in pages of apps/web (files, layout, island, components, login states, tests, offline serving, public paths, legal CSS)
Base: 8c9acfc1e
Verified: `git status --short | wc -l` -> `0`. The worktree is clean. I ran no test and no build.
Unknowns:
- No e2e test covers an SSO sign-in state. `grep -rln sso e2e/tests` finds only `legal.spec.ts`, and I did not read why it matches. SSO is covered by unit tests only.
- No unit or e2e test names the `/` redirect page (`index.astro`). I searched only test file names and `describe`/`test` titles, not file bodies.
- Offline CSS is not precached; see item 5. I did not run the built site to see which `/_astro/*.css` files the offline page links.
- I did not read the `SsoSignIn` states or `forgot`/`setup` error branches in detail. Setup is mapped through `auth.spec.ts` only.

1. Pages — all use `apps/web/src/layouts/Public.astro` (centred `max-w-md` card, or `max-w-3xl` when `reading` is set). It imports `../styles/global.css` and hard-codes `theme-color #000832`. Observed.
   - `login.astro` → island `islands/LoginPage.tsx`
   - `forgot.astro` → `islands/ForgotPage.tsx`
   - `setup.astro` → `islands/SetupPage.tsx`
   - These three use `client:only="react"` and `components/auth/AuthCard.tsx`, a `ui/card` wrapper whose `h1` has `text-xl`.
   - `login` also uses `components/login/SsoSignIn.tsx`, `components/legal/LegalLinks.tsx`, and `ui/{alert,button,input,label,switch}`.
   - `setup` uses `setPasswordWithTerms` and `legalPath`. Its states are `setup_link_missing` and `setup_link_invalid`.
   - `404.astro` and `offline.html.astro` have no island. Each is static and bilingual (`pl` first, then `en`), with plain `h1`/`p`/`a` Tailwind classes and no `AuthCard`.
   - `index.astro` has no island. It holds `<meta http-equiv="refresh" content="0; url=/onboarding">` and a link. The server also redirects `/` once signed in, to `homeOf(...)` (`apps/server/src/platform/http.ts:452`).
   - `legal/[lang]/[doc].astro` renders Markdown from `src/legal/<lang>/<doc>.md` with `Public reading`. It adds `components/legal/{DataCategoriesTable,SubprocessorsTables,LegalTable}.astro`.
2. Login states in `islands/LoginPage.tsx`, with their tests:
   - **Field validation** (`loginFormSchema`): no test file found for it.
   - **Wrong password** (401 or `INVALID_EMAIL_OR_PASSWORD` → `login_error_credentials`): e2e `auth.spec.ts` "a wrong password is refused".
   - **Rate limit** (429 → `error_too_many`): e2e `auth.spec.ts` "the login rate limit counts per address".
   - **Generic error** (`error_generic`): no test found.
   - **Success** → `location.assign(nextTarget())`: e2e `auth.spec.ts` "a login opens the shell".
   - **`?setup=done` alert**: no test found.
   - **`?deleted` notice**: unit `delete-organization.test.ts` (`takeDeletedNotice`); e2e `account-delete.spec.ts`.
   - **TOTP code step** (wrong code, then right): e2e `two-factor.spec.ts` "sign in with a code…". Unit `two-factor-errors.test.ts` maps each error code (locked, 429, INVALID_CODE, INVALID_BACKUP_CODE, attempts, expired cookie, state) to a key and a restart flag.
   - **Backup code and its reuse**: e2e `two-factor.spec.ts` "sign in with a backup code, and the same code a second time is refused".
   - **Trusted device**: e2e `two-factor.spec.ts` "a trusted device skips the code step…".
   - **SSO block** (`loginSections`, `SsoSignIn`): unit `login-page.test.tsx`, `login-sso-wiring.test.tsx`, `sso-sign-in.test.ts`, `sso-view.test.tsx`, `sso-form.test.ts`. SSO return errors (not_a_member, domain_mismatch, identity_mismatch, sso_off, generic) and the start-failure texts (429 → `login_sso_error_rate`): `sso-errors.test.ts`.
   - Observed.
3. Other pages and tests. Observed.
   - **forgot:** e2e `forgot.spec.ts` (5 tests: public view, reset off, field error, link from login, CSP).
   - **setup:** e2e `auth.spec.ts` "the setup link works once". It also covers invalid and missing links (`setup_link_invalid`, `setup_link_missing`).
   - **404:** e2e `auth.spec.ts` "the pages keep the CSP and show the 404 page" (status 404, `pl.not_found_title`, axe).
   - **offline:** e2e `pwa.spec.ts` (public view plus axe, and the offline load with no network).
   - **legal:** e2e `legal.spec.ts`, 6 pages × 2 tests, plus draft line, OpenAI table and login links. `terms.spec.ts` covers the terms dialog, not these pages.
4. `PUBLIC_PAGE_PATHS` is at `apps/server/src/platform/http.ts:151` and is used at `:449` (`.some(pattern.test(path))` → `next()` before the session check). Observed.
   - Pages in it: `/login`, `/setup`, `/forgot` (optional trailing slash), `/legal/(pl|en)/(privacy|terms|dpa)`, `/404.html`.
   - Assets and shell files in it: `/_astro/`, `/favicon.`, `/robots.txt`, `/manifest.webmanifest`, `/sw.js`, `/offline.html`, `/icons/`.
   - `/` is not in the list. A visitor without a session is redirected to `/login?next=…` (`:451`).
   - Unit tests: `http.test.ts:664` (forgot and legal paths only). E2E: `pwa.spec.ts` first test.
5. Offline serving in `src/lib/service-worker.ts`, bundled by `scripts/build-sw.ts` to `dist/sw.js`. Observed.
   - **Precache:** install runs `cache.add("/offline.html")` into `ea-shell-v1` (`SW_VERSION = "v1"`). It is the only precached file.
   - **Fetch rules:** `/_astro/*` is cache-first. The worker stores a 200 `basic` response on first fetch, so an `/_astro` file is cached only after a page loaded it online. A navigation goes to the network, and only a network error returns the cached offline page. `/api` and non-GET requests are never handled.
   - **Assets offline:** `astro.config.mjs` sets `inlineStylesheets: "never"`, so `offline.html` links hashed `/_astro/*.css`, the same `global.css` bundle. Those files are reachable offline only if an earlier online visit cached them. The icons, the favicon and the manifest are not cached.
   - **Fonts:** no `@font-face` or font file exists. `--font-sans` in `global.css:76` is the system stack, and CSP has `font-src 'self'`. Any pebble-look web font would have no offline path.
   - **Cache bump:** the comment says to change `SW_VERSION` with every change of the cached files.
6. Hand-written CSS in the legal pages: yes. `src/styles/global.css:128–193` defines `.legal-draft`, `.legal-body` (with `h2`, `h3`, `ul`, `ol`, `a`), `.legal-table` and its `table`/`th`/`td`. The page and `LegalTable.astro` use these classes. They use theme variables (`--border`, `--muted`, `--radius`). No `<style>` block exists in `src/layouts` or `src/components/legal`. Observed.
Checks: `e2e/tests/{auth,two-factor,forgot,pwa,legal}.spec.ts` cover the pages and login states above; `service-worker.test.ts` and `integrations/pwa-shell.test.ts` cover the worker rules and bundle; `http.test.ts` covers part of the public paths. They miss SSO in e2e, the `/` redirect page, the `?setup=done` alert, generic sign-in error and `/404.html` or `/offline.html` visuals. I ran none of them (the job's rules).
````

## Scout 3

**Question:** Map the brand assets of apps/web: favicon files, app icons (sizes, formats), manifest.webmanifest (colours, icons), theme-color meta tags, any brand mark/logo component and every place that uses it, the apple-touch-icon. Where are they referenced (layouts, service worker precache, server static routes, CSP, apps/docs, the report mail, tests)? Are any icons generated by a script or committed as binaries? Which tests assert icon paths, manifest fields or theme-color?

**Job:** `2026-11-23-f167-scout-3-59ac93eb`

**Packet:**

````text
Packet: Brand assets of apps/web and where each is used, at HEAD
Base: 8c9acfc1e
Verified: `file apps/web/public/favicon.png apps/web/public/icons/*` -> `apps/web/public/icons/icon-192.png: PNG image data, 192 x 192, 8-bit/color RGBA`
Unknowns: Which tool made the PNGs. No generator script exists (`apps/web/scripts/` holds only `build-sw.ts`). The only commit I found is `18fd9ef6e` (F118 stage 04), so the PNGs look hand-made — guessed. I did not open the PNGs, so I don't know their colours or whether they match navy.
1. `apps/web/public/` — Observed. It holds 5 committed files and nothing generated: `favicon.png` (32×32 PNG), `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-512-maskable.png` (all RGBA PNG) and `manifest.webmanifest`. There is no SVG, no `.ico`, no apple-touch-specific file, and no brand-mark or logo component. The panel brand is text only: `components/shell/Nav.tsx:133` renders `<p>{t("brand")}</p>`. `AppShell.tsx` and `AuthCard.tsx` put `t("brand")` into `document.title`. `pages/index.astro` passes `titleKey="brand"`. `pages/offline.html.astro` has no icon or colour.
2. `apps/web/public/manifest.webmanifest` — Observed. `background_color` and `theme_color` are both `#000832` (navy). `start_url` is `/activity`, `scope` is `/`, `display` is `standalone`. It lists the three icons with purposes `any`, `any` and `maskable`.
3. `apps/web/src/layouts/App.astro:17-20` and `Public.astro:26-29` — Observed. Both layouts carry the same four tags: `<link rel="icon" type="image/png" href="/favicon.png">`, the manifest link, `<link rel="apple-touch-icon" href="/icons/icon-192.png">` and `<meta name="theme-color" content="#000832">`. The apple-touch-icon is the 192 icon. There is no dark-mode theme-color variant.
4. Serving and CSP (no icon path is hard-coded outside the list in this item):
   - `apps/server/src/platform/http.ts:158-164` — Observed. `PUBLIC_PAGE_PATHS` lets `/^\/favicon\./`, `/manifest.webmanifest`, `/sw.js`, `/offline.html` and `/^\/icons\//` through without a session. `serveStatic` serves `web.dist` with `Cache-Control: private, no-store` (`http.ts:474-486`). Any new icon under `/icons/` or named `favicon.*` is public with no server change.
   - `apps/web/astro.config.mjs:26-28` — Observed. The CSP names `manifest-src 'self'` and the worker. No `img-src` line turned up in my search, so I did not check it.
   - `apps/web/src/lib/service-worker.ts` — Observed. It precaches only `/offline.html` (`cache.add(OFFLINE_PATH)`, line 113) and `/_astro/` files. No icon is precached.
   - `apps/docs` — Observed. It has its own `public/favicon.svg`, an indigo `#4f46e5` envelope drawn in SVG. `integrations/image-check.ts:27-28` allows only `favicon.svg` and the folders `shots` and `brand`. A new docs image outside those fails the build with `image_outside`.
   - Report mail — Observed. `apps/server/src/platform/auth-mail-texts.ts` and `packages/core/src/digest` hold no `<img>`, logo or colour references.
5. Tests that assert brand assets — Observed:
   - `apps/web/integrations/pwa-shell.test.ts:25-48` checks `start_url`, `display` and `scope`. It also checks that the icon list equals `[192x192 any, 512x512 any, 512x512 maskable]`, that each `src` starts with `/icons/`, that `type` is `image/png`, and that each PNG's real size equals the declared size (`pngSize`). At line 51 it asserts `manifest-src 'self'`. At line 57 it asserts both layouts contain the exact string `<link rel="manifest" href="/manifest.webmanifest" />`.
   - `apps/web/e2e/tests/pwa.spec.ts:24-58` checks the manifest is public with `application/manifest+json`, that every icon `src` returns 200, that the page links `/manifest.webmanifest`, and that `start_url` is `/activity`.
   - `apps/server/test/integration/web-http-pages.test.ts:36-63` and `web-helpers.ts:187-192` use fake dist files and check that `/favicon.png`, `/manifest.webmanifest` and `/icons/icon-192.png` return 200. Renaming or removing these paths breaks them.
   - `apps/web/src/lib/service-worker.test.ts:41-42` checks `/favicon.png` and `/manifest.webmanifest` are `not-handled`.
   - No test asserts `theme-color`, `theme_color`, `background_color`, `apple-touch-icon` or the `#000832` colour. The docs favicon is covered only by `apps/docs/integrations/image-check.test.ts:58`.
   - Design intent: `docs/product/pebble-ui/README.md` PB-9 says favicon, app icons, manifest colours and theme-color move from navy to teal, the docs site takes the teal accent and mark, and the report mail does not change.
Checks: `apps/web/integrations/pwa-shell.test.ts` covers icon list, sizes, PNG dimensions and layout manifest links; it misses theme-color, background_color and apple-touch-icon. `apps/web/e2e/tests/pwa.spec.ts` covers public serving of the manifest and icons; it misses colour values.
````

## Scout 4

**Question:** Which planned work touches the web shell files apps/web/src/components/shell/, apps/web/src/layouts/, nav-items.ts, the login/auth components, favicon/manifest? Read the plans and stages of F166 (spec/features/active/F166-*) and the tickets/plans of F168, F169, F170, F171, F172 in spec/features/ and list each stage that edits one of these files, with what it changes. Also: does any e2e helper (apps/web/e2e/) or docs-shots/demo-record tool locate shell elements (sidebar, tab bar, header menu, h1) and by which locator?

**Job:** `2026-11-23-f167-scout-4-f1ae237c`

**Packet:**

````text
Packet: Which planned work (F166, F168-F172) edits the web shell, layouts, nav-items, login/auth, favicon/manifest files, and which e2e, docs-shots or demo helpers locate shell elements?
Base: 8c9acfc1e
Verified: `test -z "$(git status --short)" && rg -c 'nav_main' apps/web/e2e/tests/auth.spec.ts && rg -n 'getByRole\("heading", \{ name: title, exact: true \}\)' apps/web/e2e/docs-shots/shots.spec.ts` -> `104:      await expect(page.getByRole("heading", { name: title, exact: true }).first()).toBeVisible();` (exit 0, worktree clean)
Unknowns: F168-F172 have only `ticket.md` (no plan, no stages). I judged them from Scope and Acceptance text. No shell, layout, login or favicon file is named there, except F172's "what is new" card. F171's "favicon" is the docs-site favicon (`apps/docs`), not the panel's. I did not open the contents of `apps/web/src/pages/`, `layouts/*.astro` or `public/`.
1. F166 stage 09 (`spec/features/active/F166-*/stages/stage-09-page-head.md`, step 2) — the only F166 stage that edits a shell file, `apps/web/src/components/shell/AppShell.tsx`. It adds optional `lead` and `action` props and renders one `PageHead` at the top of `main` at every width. It removes both old `h1` elements (`AppShell.tsx:101` phone header, `:116` desktop main). The phone top bar keeps the menu button and shows `t("brand")` as plain text. The no-organization screen (`AppShell.tsx:63`) keeps its own `h1`. A scan test bans `<h1` outside `patterns/PageHead.tsx`, `shell/AppShell.tsx` and `auth/AuthCard.tsx`. Its e2e test 4 checks exactly one visible `h1` on `/activity`. — observed
2. F166 stage 03 (`stages/stage-03-tokens-font.md` lines 21-22) — edits `components/shell/Nav.tsx` (`bg-accent` and `text-accent-foreground` forms become `muted`/`foreground`). `PausedBanner.tsx` moves to `bg-destructive-soft`. `AuthErrorBanner.tsx` keeps `accent` until stage 10. Stage 10 only names the tab bar (`--tabbar-height`, `interfaces.md:31`) and does not edit it. Stages 01, 02, 04-08 and 11 name no shell, layout, login/auth, favicon or manifest file. The F166 ticket (lines 21-22) puts shell, nav, favicon and manifest out of scope. — observed
3. F167 itself owns `layouts/` (`App.astro`, `Public.astro`), all of `components/shell/` (including `nav-items.ts`, tested by `src/lib/nav-items.test.ts`), brand assets (`public/favicon.png`, `public/icons`, `public/manifest.webmanifest`) and login, forgot, setup, legal, 404, offline and the `/` page. Nav order, names and addresses are out of scope there. — observed
4. F168-F172: only F172 touches a shell file ("what is new" card, `WhatsNew.tsx`, plus a leftover sweep and a check of the installed app). F168, F169 and F170 name page content, their e2e specs and docs. F171 names the docs site theme, docs shots and the demo recording. F168 acceptance needs the decision bar above the tab bar and does not edit it. — observed (ticket text); "no shared file" is guessed
5. Shell locators in `apps/web/e2e`: sidebar and tab bar are both `getByRole("navigation", { name: en.nav_main })`, since `Nav.tsx:72` and `:134` share `aria-label={t("nav_main")}` (`auth.spec.ts:57`, `approvals.spec.ts:135`, `delegations.spec.ts:521`, `delegates.spec.ts:83`, `open-loops.spec.ts:457,473,509`, `onboarding.spec.ts:89`, `polish.spec.ts:75`). Header menu on a phone: `getByRole("button", { name: en.menu_open })` then `getByRole("dialog")` (`auth.spec.ts:30,62,80`, `plan.spec.ts:95`, `docs-links.spec.ts:59`, `onboarding.spec.ts:83`, `delegations.spec.ts:533`, `approvals.spec.ts:140`). Desktop user menu: button `en.user_menu`, then `menuitem` `en.log_out` (`auth.spec.ts:34,70,83`, `plan.spec.ts:98`). `h1`: `getByRole("heading", { level: 1, name })` in `approvals`, `stats`, `delegations`, `delegates`, `open-loops`, `auth`, `forgot`, `legal`, `polish`, `pwa`. The docs-shots spec uses `getByRole("heading", { name: title, exact: true }).first()` (`docs-shots/shots.spec.ts:104`). The demo spec uses the same form (`demo/record.spec.ts:147`). `language.spec.ts`, `plan.spec.ts:107` and `telegram-detail.spec.ts:84` use a heading with no level. No CSS selector, test id, `aside`, `header` or `h1`-tag locator targets the shell. `helpers.ts` and `a11y.ts` have none. — observed
Checks: `rg` over `apps/web/e2e` covers locator use at HEAD; it misses `apps/docs/e2e`, `apps/web/src` unit tests and `scripts/`. No test suite ran.

````

