# F163 stage 02 — code ties, DPIA, record B and capability pages

Needs stage 01: the privacy pages, the `openai` and `gemini` rows, rows C271 and C272 in `docs/legal/claims.md`.
Part of [`../plan.md`](../plan.md). Lands on the proof (no review job).

## Step 1 — the DPIA and record B

- **Goal:** `docs/legal/dpia.md` and record B say what the style call sends and why.
- **Seams:**
  - DPIA "Description of the processing" Flow: one sentence group after the open-loops part (P3 fields, the cut, limits, no subject or address, no store).
  - DPIA "Necessity and proportionality": Purposes (P5); under "Is the data needed?" one bullet for the style suggestion that quotes the en button label: the P3 limits and cut; the answer fails its check when it holds a name, an address, a link, a phone or account number, or copied words; the server stores no text.
  - DPIA "Risks" R1 text names the style call next to the open-loops analysis; the R1 Measures row adds the style limits. No new risk (P9). The R1 levels stay.
  - `docs/legal/records-of-processing.md` record B "Purposes" (P5).
- **Decisions:** P3, P5, P9, D3, D5. The six `##` headings stay (test 3 of `legal-papers.test.ts`).
- **Out of scope:** the in-app pages, the registries, `terms.ts` (stage 01 owns the version; a gap there is a question).

## Step 2 — the ledger row

- **Seams:** `docs/legal/claims.md`: new row C273 (the DPIA and record B text of step 1; sources `docs/legal/dpia.md`, `docs/legal/records-of-processing.md`, `packages/core/src/replies/style-samples.ts`); change each DPIA or record B row whose text now differs (Purposes, R1 and its measures). The count table and the pin in `apps/docs/src/security/claims.test.ts` follow (272 → 273).
- **Decisions:** D1.

## Step 3 — the tie tests

- **File:** `apps/server/src/legal-outside-calls.test.ts`, new `describe("style suggestion")` (D2). Imports: `@ea/core` (`STYLE_SAMPLE_MAX_CHARS`, `STYLE_SAMPLES_MAX_CHARS`, `STYLE_MAX_SOURCES`, `STYLE_SUGGESTION_MAX_CHARS`, `buildStyleSamples`, `DAY_MS`), `./modules/replies` (`STYLE_SUGGEST_WINDOW_MS`, `STYLE_SUGGEST_DAILY_LIMIT`, `STYLIST_MAX_CALLS`), `./modules/triage` (`prompts`). Its head comment names three calls now.
- **Decisions:** D2, D3 (every number string in cases 3–7 is built from its constant).
- **Test:**
  1. Pinned values, one `test.each` row each, named "re-check the privacy papers": `STYLE_SAMPLE_MAX_CHARS` 1500, `STYLE_SAMPLES_MAX_CHARS` 60000, `STYLE_MAX_SOURCES` 100, `STYLE_SUGGEST_WINDOW_MS / DAY_MS` 14, `STYLE_SUGGEST_DAILY_LIMIT` 3, `STYLIST_MAX_CALLS` 2, `STYLE_SUGGESTION_MAX_CHARS` 1000, `prompts.stylist.version` `stylist-v1`, `prompts.stylist.role` `stylist`.
  2. `buildStyleSamples([{ bodyText: "Hi team,\nThe offer is attached.\n\nOn Mon, 16 Nov 2026, Anna Nowak wrote:\n> Please send the offer.", toAddresses: ["anna.nowak@example.com"], ccAddresses: [] }], { signature: null })` has keys `["samples", "names"]` and `samples` equals `["Hi team,\nThe offer is attached."]` (the quoted part and the address do not go).
  3. `test.each` over en and pl privacy pages, on the slice from the button label (the `rs_suggest_button` text of that language, which the page quotes) to the Gemini sentence (en "An install can use Google Gemini instead", pl "Instalacja może zamiast tego używać Google Gemini"): the slice exists and holds the per-mail cap (`1,500 characters` / `1500 znaków`), the total cap (`60,000 characters` / `60000 znaków`), the window (`14 days` / `14 dni`) and the answer cap (`1,000 characters` / `1000 znaków`).
  4. Row C271 holds the en per-mail and total cap strings and `prompts.stylist.version`; row C272 holds the en answer cap string.
  5. The `openai` and `gemini` `dataReceived`: en holds the en per-mail and total cap strings, pl the pl ones; `gemini` en holds `writing style` (P6).
  6. The DPIA "Is the data needed?" bullet that holds the en button label holds the en per-mail cap, the en total cap and the en window string.
  7. Row C273 holds the en total cap string.
- **Break checks:** set `STYLE_SAMPLE_MAX_CHARS` to 1499 locally: cases 1, 3, 4, 5, 6 fail; revert. Set `STYLE_MAX_SOURCES` to 101: case 1 fails; revert.
- **Check:** `bun test apps/server/src/legal-outside-calls.test.ts apps/server/src/legal-papers.test.ts apps/docs/src/security/claims.test.ts`.

## Step 4 — capability pages

- **Seams:** `docs/capabilities/reply-drafts.md` rule 17: one sentence that the privacy page, the registries and the DPIA name this call, with a pointer to `apps/server/src/legal-outside-calls.test.ts`; `docs/capabilities/papers.md` rule 9 adds this ticket folder path to the seams. Set the "Checked against" line of each changed page.

## Done when

- Cases 1–7 pass, and the two break checks failed as stated.
- Ticket Acceptance line 3 holds; the DPIA and record B name the style call.
- The plan's Proof exits 0; the final message copies the `check:job` line.
