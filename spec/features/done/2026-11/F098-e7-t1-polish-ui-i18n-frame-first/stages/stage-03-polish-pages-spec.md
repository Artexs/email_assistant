# F098 stage 03 — Polish static pages and the Polish browser spec

Part of [`../plan.md`](../plan.md). Decisions: P1, P8, D2, D7. Needs stage 02 landed. Lands on the worker's proof. Two steps.

After this stage the static pages read right in both languages, and a Playwright spec proves that a Polish browser gets a Polish panel that fits a phone screen (Done when 3).

## Step 1 — Static pages in both languages

**Goal.** The pages without an island read right for both languages (P8).

**Files.** `apps/web/src/pages/404.astro`, `apps/web/src/pages/index.astro`, `apps/web/src/pages/legal/[lang]/[doc].astro`, `apps/web/src/layouts/Public.astro` (an optional `lang` prop, default `"en"`, printed in `<html lang>`), `apps/web/e2e/tests/legal.spec.ts`.

**Interfaces.**

- `404.astro`: the heading, the text and the link each in Polish, then the same line in English inside an element with `lang="en"` (for example `<p>{pl.not_found_text}</p><p lang="en">{en.not_found_text}</p>`). The `<title>` stays `{en.title_not_found} · {en.brand}`.
- `index.astro`: the "continue" link text is `{pl.continue} / {en.continue}`.
- The legal page picks `const texts = lang === "pl" ? pl : en;` for the title, the stub text and the "go to sign in" link, and passes `lang` to `Public`.
- `legal.spec.ts`: the expected title, stub text and link text come from `pl` for `/legal/pl/*` and from `en` for `/legal/en/*`.

**Decisions.** P8.

**Test.** `legal.spec.ts` (6 cases × 2 projects) with the per-language texts.

**Check.** `bun run web:build`; the e2e run of the Proof.

**Done when.** The legal spec passes for both languages.

**Out of scope.** The legal texts themselves.

## Step 2 — The Polish browser spec

**Goal.** Proof that a Polish browser gets a Polish panel that fits a phone screen (Done when 3).

**Files.** New: `apps/web/e2e/tests/polish.spec.ts`. Changed: `apps/web/e2e/helpers.ts` (`signIn` and `signInAs` take an optional last parameter `texts: { email_label: string; password_label: string; sign_in: string } = en`).

**Interfaces.** `polish.spec.ts`:

- `test.use({ locale: "pl-PL" });` and the address block `onMobile ? 20 : 120` with `nextAddress` (the pattern of `account.spec.ts`).
- `beforeEach`: `cspErrors(page)`; `afterEach`: the CSP list is empty.
- It signs in as `readSeed().owner` (a null-locale user; never change this user's locale in any spec) with `signInAs(page, owner, pl)`.
- It never changes data.

**Decisions.** P1, D2, D7.

**Test.** `polish.spec.ts`:

1. `/login` before the sign-in: the heading `pl.login_title` is visible; the label `pl.email_label` exists; `document.documentElement.lang` is `"pl"` (`initLocale` sets it, stage 01); no horizontal overflow (the check of case 3).
2. `/forgot`: the heading `pl.forgot_title` is visible. `/setup` without a token: the text `pl.setup_link_missing` is visible. `/legal/pl/terms`: the Polish title is visible. `/404.html` (a public path, `PUBLIC_PAGE_PATHS` in `apps/server/src/platform/http.ts`; the server also answers unknown paths with this file): `pl.not_found_text` and `en.not_found_text` are both visible. Each of these pages has no horizontal overflow.
3. After the sign-in, for each of `/activity`, `/mailboxes`, `/settings`, `/rules`: the level-1 heading (the one `AppShell` prints for its `title`; read `AppShell.tsx`) equals `pl.title_<page>`; `document.title` starts with `pl.title_<page>`; the navigation shows `pl.nav_activity` (desktop: the sidebar; mobile: the bottom tabs); `await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)` is true.
4. `/onboarding`: read `OnboardingPage.tsx` for what an owner with this seed sees (the page or a redirect to `/activity`); assert the Polish heading when it stays, else the redirect. Say in the final message which path the run took.

**Check.** The e2e run of the Proof (it runs every spec, so the English specs prove that an `en-US` browser still gets English).

**Done when.** `polish.spec.ts` passes in both projects, and every other spec passes.

**Out of scope.** The Account choice (stage 04).

## Stage done when

- Steps 1–2 are done.
- The Proof chain for page stages in `plan.md` § Proof (with `NN` = 03) prints `PROOF_OK`.
