# F107 stage 02 — Page frame, links, placeholder and parity checks

Part of [`../plan.md`](../plan.md). Decisions P1, P3, P4, D1, D2, D6, D7, E3. Needs stage 01. No `TERMS_VERSION` change in this stage (D5: the one bump is stage 06).

## Step 1 — Markdown pages with the draft line and the tables

**Goal.** The six legal pages render a Markdown body inside a fixed frame, so later stages only write text.

**Files.** `apps/web/src/pages/legal/[lang]/[doc].astro`; new `apps/web/src/legal/<pl|en>/<privacy|terms|dpa>.md`; small Astro components for the generated tables; `apps/web/src/i18n/en.ts` and `pl.ts`; global CSS for the reading layout.

**Interfaces.** Every new i18n key of the frame starts with `legal_` (the stage 06 guard hashes `legal_*`): `legal_draft_line` (P1 text, exact), `legal_version` (`{version}`), table headings, the "used when" text of each `ActiveWhen` kind and the text of each `Kept` kind. `legal_stub_text` goes away.

**Decisions.**
- Order of D2; the draft line is the first element after the `h1`, in a visible note box.
- Data-category table (privacy): label, subjects, purpose, kept. Sub-processor table (privacy; DPA as "Annex 2"): name, purpose, data received, location, used when; rows with `personalData: false` go to a second table "Services that receive no personal data".
- Stub bodies: one `##` heading "Draft" (pl "Wersja robocza") and one line `Text follows. Contact: \<contact>.` in the page language; the en privacy stub also holds `\<provider name>` and `\<to confirm: test>`.
- Placeholders (D6): the Markdown source writes a placeholder with a backslash before `<` (`\<provider name>`), so CommonMark prints it as text. An unescaped `<` followed by a letter in a legal source is an error (raw HTML is not allowed).
- The frame reads no env value at build time (E3).

**Test.**
1. (e2e, `legal.spec.ts`, both projects) For each of the six pages without a session: the URL stays, `h1` is the title, `html[lang]` is the page language, the draft line of that language is visible and exact, the version line holds `TERMS_VERSION`, no CSP error.
2. (e2e) `/legal/en/privacy` and `/legal/pl/dpa` show a table row with `OpenAI`; `/legal/en/terms` has no sub-processor table.
3. (e2e) For each page, every placeholder that `findPlaceholders` finds in its source is visible as text on the page (for the en privacy stub: `<provider name>`, `<to confirm: test>`), and the page has no element named `provider` or `to`.

## Step 2 — Links on the sign-in page and in the Account card

**Goal.** P4.

**Files.** `apps/web/src/islands/LoginPage.tsx`, `apps/web/src/components/settings/AccountCard.tsx` (or one small shared component).

**Decisions.** Three links in the panel language (`legalPath(lang, doc)`), titles from the `legal_*_title` keys; below the form on the login page (same tab); one row "Legal documents" in the Account card (new tab, `noopener`, as the dialog does).

**Test.**
4. (e2e) A visitor of `/login` (browser `en-US`) sees three links with `href` `/legal/en/terms`, `/legal/en/privacy`, `/legal/en/dpa`.
5. (e2e) A signed-in member who chose Polish in the Account card sees there three links to `/legal/pl/…`.

## Step 3 — Placeholder and parity checks

**Files.** `apps/web/src/lib/legal.ts` (`legalPlaceholders`, the allowed list); a test-only module `apps/web/src/lib/legal-checks.ts` (`findPlaceholders(markdown): string[]`, the file checks; it may use Node APIs because no island imports it); its unit test.

**Test.**
6. `findPlaceholders("a \\<provider name> b \\<to confirm: x>")` gives `<provider name>`, `<to confirm: x>`; the file check fails on `\<provider>` (not in the list), on a raw `<b>` and passes on `\<contact>`.
7. Each pl/en pair has the same number of `##` headings.

**Check.** The unit test file, `bun run web:build`, then the e2e specs `legal.spec.ts` and `auth.spec.ts` under the lock.

**Docs.** `docs/capabilities/web-panel.md`: draft pages with a fixed frame (not stubs) and the links of step 2.

**Done when.** Tests 1–7 pass, the existing terms tests pass unchanged, and the Proof with the e2e step prints `PROOF_OK`.

**Out of scope.** The real texts (03–05), the version guard and the bump (06).
