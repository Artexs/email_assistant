# F107 stage 02 — Page frame, links and text guards

Part of [`../plan.md`](../plan.md). Decisions P1, P3, P4, P5, D1, D2, D5, D6, D7, E3. Needs stage 01.

## Step 1 — Markdown pages with the draft line and the tables

**Goal.** The six legal pages render a Markdown body inside a fixed frame, so later stages only write text.

**Files.** `apps/web/src/pages/legal/[lang]/[doc].astro`; new `apps/web/src/legal/<pl|en>/<privacy|terms|dpa>.md` (six short placeholder bodies: one `##` heading and one line "Text follows in a later step." in the page language); one or two small Astro components for the generated tables; `apps/web/src/i18n/en.ts` and `pl.ts`; global CSS for the reading layout.

**Interfaces.** New i18n keys: `legal_draft_line` (P1 text, en and pl, exact), `legal_version` (with a `{version}` placeholder), the table headings and the "used when" texts for each `ActiveWhen` kind and each `Kept` kind. The key `legal_stub_text` goes away.

**Decisions.**
- Order of D2. The draft line is the first element after the `h1`, in a visible note box.
- Data-category table (privacy only): label, subjects, purpose, kept (the `Kept` text with its number). Sub-processor table (privacy and DPA, DPA heading "Annex 2"): name, purpose, data received, location, used when; rows with `personalData: false` go to a second short table "Services that receive no personal data".
- Placeholders in the Markdown source are escaped so that the built page shows `<provider name>` as text (D6).
- The frame reads no env value at build time (E3).

**Test.**
1. (e2e, `legal.spec.ts`, both projects) For each of the six pages without a session: the URL stays, `h1` is the title, `html[lang]` is the page language, the draft line of that language is visible and exact, the version line holds `TERMS_VERSION`, no CSP error.
2. (e2e) `/legal/en/privacy` and `/legal/pl/dpa` show a table row with the text `OpenAI`; `/legal/en/terms` shows no sub-processor table.
3. (e2e) `/legal/en/privacy` with a body line that holds `<provider name>` shows that text, and the page has no `provider` element (the en privacy stub holds it now; the stage 03 text keeps it, P3).

## Step 2 — Links on the sign-in page and in the Account card

**Goal.** P4.

**Files.** `apps/web/src/islands/LoginPage.tsx`, `apps/web/src/components/settings/AccountCard.tsx` (or a small shared component that the setup page and the dialog may also use).

**Decisions.** Three links in the panel language (`legalPath(lang, doc)`), titles from the existing `legal_*_title` keys; on the login page below the form; in the Account card as one row "Legal documents". Same tab on the login page; a new tab (`noopener`) in the Account card, as the dialog does.

**Test.**
4. (e2e) A visitor of `/login` (browser `en-US`) sees three links with `href` `/legal/en/terms`, `/legal/en/privacy`, `/legal/en/dpa`.
5. (e2e) A signed-in member who chose Polish in the Account card sees in the Account card three links to `/legal/pl/…`.

## Step 3 — Text guards

**Goal.** D5, D6, D7: no text change ships without a version change, a stray placeholder or a missing language section.

**Files.** `packages/core/src/web/terms.ts` (`LEGAL_TEXTS_SHA256`); `apps/web/src/lib/legal.ts` (`legalPlaceholders`, the pure digest and check functions); a unit test in `apps/web/src/lib/`.

**Interfaces.** `legalTextsDigest(parts: readonly string[]): string` (SHA-256 hex over the parts in a fixed order, CRLF → LF). `findPlaceholders(markdown: string): string[]`.

**Test.**
6. `legalTextsDigest(["x\r\n"]) === legalTextsDigest(["x\n"])`; `legalTextsDigest(["a","b"]) !== legalTextsDigest(["b","a"])`.
7. The digest of the six files, both registries and the `legal_*` keys (en, pl) equals `LEGAL_TEXTS_SHA256`; on a mismatch the message is "change TERMS_VERSION and LEGAL_TEXTS_SHA256".
8. `findPlaceholders("a <provider name> b <to confirm: x>")` gives both; the file check fails on `<provider>` (not in the list) and passes on `<contact>`.
9. Each pl/en pair has the same number of `##` headings.
10. `TERMS_VERSION` matches `^\d{4}-\d{2}-\d{2}(-\d+)?$`.

Set `TERMS_VERSION` to the commit date (D5) and the new digest. The existing terms tests (dialog after a version change) must pass unchanged.

**Check.** The unit test file, `bun run web:build`, then the e2e specs `legal.spec.ts` and `auth.spec.ts` under the lock.

**Docs.** `docs/capabilities/web-panel.md`: the legal pages are draft pages with a fixed frame (not stubs); the links of step 2.

**Done when.** Tests 1–10 pass and the Proof with the e2e step prints `PROOF_OK`.

**Out of scope.** The real texts (03–05), the claims list (06).
