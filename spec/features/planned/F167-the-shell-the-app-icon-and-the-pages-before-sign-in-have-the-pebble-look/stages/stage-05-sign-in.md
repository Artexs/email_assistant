# F167 stage 05 — Sign-in pages: login, code step, forgot, setup

Part of [`../plan.md`](../plan.md). Needs stage 01: `BrandMark` and the head tags of `Public.astro`. Needs F166 stage 03: the tokens. Needs F166 stage 08: `web:build:dev` (the Proof). May run next to 02, 03, 04, 07.

This stage owns the body of `apps/web/src/layouts/Public.astro`, `components/auth/AuthCard.tsx`, the look (not the logic) of `LoginPage`, `ForgotPage`, `SetupPage` and `SsoSignIn`. It does not edit `LegalLinks` (Settings uses it too; the settings ticket owns that page): the login wraps it. Stage 06 uses the `frame` prop.

## Step 1 — `Public.astro` frames

- **Interface** (stage 06 uses it): `Public.astro` props `{ titleKey?; title?; lang?; frame?: "card" | "split" | "reading" }`. `frame` replaces `reading` (default `card`; the legal page passes `frame="reading"` here so it builds).
- **Decisions:** D10. `card`: today's centred column (`max-w-md`) with `BrandMark` and the brand name (a `p`, 18 px extra bold) in place of the plain brand line. `split`: no column, no brand line; `main` is full width and height. `login.astro` and `setup.astro` give the island a `slot="fallback"` with `BrandMark` and the name, so the page is not blank before the island loads. `reading`: as today until stage 06. `<html lang>`, the title and `noscript` stay.

## Step 2 — The split login frame

- **Interface:** `AuthCard({ title: TextKey; children; panel?: boolean })`. Without `panel` it is the card of today in the new look (radius `lg`, `shadow-card`, `h1` `text-2xl` bold).
- **Decisions:** D11, D12. With `panel`, from `lg` two columns of equal width with a 20 px gap and 20 px padding (the mockup `.login`):
  - left, the panel: `bg-primary text-primary-foreground`, radius 32 px, `BrandMark tone="inverse"` with the brand name at the top, `login_panel_title` (`text-3xl` from `lg`, extra bold, as a `p`) and `login_panel_text` at the bottom;
  - right, the form column: the `h1` and the children in a column of at most 400 px, centred, no card behind it.
  Below `lg`: the panel is hidden (`hidden lg:flex`: a phone reader gets no extra text); `BrandMark` and the name sit above the `h1`.
- **Who passes `panel`:** the login form and the code step of `LoginPage` (the frame must not jump), and `SetupPage` in every state. `ForgotPage` stays on `card`. `login.astro` and `setup.astro` pass `frame="split"`.
- **Texts:** the two keys of D11, next to `login_title` in `en-auth.ts` and `pl-auth.ts`.

## Step 3 — Form parts

- The links to `/forgot` and the help `details` keep their texts, in `text-primary` bold; `LegalLinks` sits in a wrapper with `text-xs text-muted-foreground`.
- The SSO block keeps its logic and texts; a divider with an existing "or" key if one exists, else none.
- Error lines keep `role="alert"` and `text-destructive`; the `Alert` of `?setup=done` and the notice `data-notice="org-deleted"` keep their markup and attributes.

## Step 4 — Capability page

`docs/capabilities/web-panel.md` rule 3 (sign-in), and only there (D16): the login and setup pages show the brand panel from `lg` and only the form below it.

## Test

1. e2e `auth.spec.ts` on `desktop`: `/login` shows `en.login_panel_title` and `en.login_panel_text`; the page has one `h1`, `en.login_title`.
2. The same on `mobile`: `getByText(en.login_panel_title)` is hidden (`toBeHidden()`; a text locator also finds hidden nodes); the brand name `en.brand` and the `h1` are visible.
3. `desktop`: the panel background is `rgb(10, 117, 104)` light and `rgb(63, 209, 185)` dark; its text colour `rgb(255, 255, 255)` light and `rgb(4, 32, 27)` dark.
4. Unchanged and passing: `auth.spec.ts` (wrong password, rate limit, success, setup links), `two-factor.spec.ts`, `forgot.spec.ts`, `account-delete.spec.ts`, unit `login-page`, `login-sso-wiring`, `sso-errors`, `sso-view`, `two-factor-errors`.
5. e2e `two-factor.spec.ts` on `desktop`: the panel is still shown at the code step.
6. `polish.spec.ts` or `language.spec.ts`: with the Polish locale, `/login` on `desktop` shows `pl.login_panel_title`.
7. The a11y scans of `auth.spec.ts`, `forgot.spec.ts` and `two-factor.spec.ts` pass, in the schemes that `expectNoA11yViolations` scans at your base.

## Out of scope

Sign-in logic, API calls, keys and texts other than the two new keys. The legal pages, 404, offline and `/` (stage 06). Button variants (F166).

## Done when

You opened `login` (and `setup`, `forgot` if the sheet has them), both schemes and languages, phone and desktop, next to the mockup `01-login-*`; the Proof of `../plan.md` with the specs `auth.spec.ts two-factor.spec.ts forgot.spec.ts account-delete.spec.ts polish.spec.ts language.spec.ts` prints `PROOF_OK`.
