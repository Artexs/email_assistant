# F082 stage 11 — Setup terms checkbox and legal stub pages

Part of [`../plan.md`](../plan.md). Read its L15, L16, L18, B5 and "Rules for every stage" (the Playwright rules) first. Needs stage 7 (`setPasswordWithTerms`, `TERMS_VERSION`).

Parallel: lane C, after stage 10. Stage 13 may run at the same time.

Two steps.

- [ ] **11.1 Stub pages and the checkbox**
  - Goal: `/setup` sets no password until the user ticks the terms box; the box links the three legal pages, which open without a session.
  - Files:
    - add `apps/web/src/pages/legal/[lang]/[doc].astro`;
    - add `apps/web/src/lib/legal.ts`, `legal.test.ts`;
    - change `apps/web/src/islands/SetupPage.tsx`, `apps/web/src/i18n/en.ts`;
    - change `apps/server/src/platform/http.ts` (`PUBLIC_PAGE_PATHS`) and `http.test.ts`.
  - Interfaces:

    ```ts
    // apps/web/src/lib/legal.ts
    export const legalLangs = ["pl", "en"] as const;
    export const legalDocs = ["privacy", "terms", "dpa"] as const;
    export type LegalLang = (typeof legalLangs)[number];
    export type LegalDoc = (typeof legalDocs)[number];
    export function legalLang(navigatorLanguage: string | undefined): LegalLang; // starts with "pl" (any case) → "pl", else "en"
    export function legalPath(lang: LegalLang, doc: LegalDoc): string; // "/legal/pl/terms"
    ```

  - Decisions (L18):
    - `[doc].astro`: `getStaticPaths` returns the 6 pairs of `legalLangs` × `legalDocs`. It uses the `Public` layout with the title key of the doc; body: an `h1` with the title, a `p` with `legal_stub_text`, a link `go_to_sign_in` to `/login`. No island.
    - `PUBLIC_PAGE_PATHS` gets `/^\/legal\/(pl|en)\/(privacy|terms|dpa)\/?$/`.
    - `SetupPage`: below the repeat field, a native `<input type="checkbox" id="terms" name="terms" className="size-4 accent-primary">` with a `<label htmlFor="terms">` = `setup_terms_label`; under it three links (`target="_blank"`, `rel="noopener"`) with texts `legal_terms_title`, `legal_privacy_title`, `legal_dpa_title` to `legalPath(legalLang(navigator.language), doc)`. Submit with the box empty → the field error `terms_required` under the box (`id="terms-error"`, `aria-describedby`), no request. Ticked → `setPasswordWithTerms` (stage 7).
    - `en.ts` keys (exact): `legal_privacy_title: "Privacy policy"`, `legal_terms_title: "Terms of service"`, `legal_dpa_title: "Data processing agreement"`, `legal_stub_text: "Draft. The text follows."`, `setup_terms_label: "I accept the terms of service, the privacy policy and the data processing agreement."`. `terms_required` exists (stage 7).
  - Test:
    1. `legal.test.ts`: `legalLang("pl-PL") === "pl"`, `"PL" → "pl"`, `"en-US" → "en"`, `undefined → "en"`; `legalPath("en", "dpa") === "/legal/en/dpa"`.
    2. `http.test.ts`: without a session `GET /legal/pl/privacy` and `/legal/en/dpa/` are not redirected; `/legal/de/privacy` and `/legal/pl/cookies` are redirected to `/login`.
  - Check: `bun run test:unit`, `bun run web:build`; `ls apps/web/dist/legal/pl apps/web/dist/legal/en` lists the three docs each (paste it).
  - Done when: the tests pass and the build has the six pages.
  - Out of scope: the legal texts (S6e); Polish UI texts (S6c).

- [ ] **11.2 Playwright**
  - Files: add `apps/web/e2e/tests/legal.spec.ts`; change `apps/web/e2e/tests/auth.spec.ts` (the setup test ticks the box).
  - Test:
    1. `legal.spec`: signed out, each of the 6 pages → the URL stays; the heading is the doc title; the stub text shows; no CSP error.
    2. `auth.spec`, the setup test: submit with the box empty → the error `terms_required` shows and the page sends no `reset-password` request; tick the box, submit → signed in as before.
    3. `auth.spec`: the three links under the box point to `/legal/en/...` (Playwright's default locale is `en-US`).
  - Check: Proof (web form, `/tmp/f082-s11`, specs `legal.spec.ts auth.spec.ts`).
  - Done when: the Proof printed `PROOF_OK`.
  - Out of scope: the dialog for a newer version (stage 12).
