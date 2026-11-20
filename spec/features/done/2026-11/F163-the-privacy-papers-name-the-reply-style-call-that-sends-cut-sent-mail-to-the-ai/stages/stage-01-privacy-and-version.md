# F163 stage 01 — in-app texts, registries, legal version, ledger rows and their ties `[risky]`

Needs: nothing new; F162 (landed) wrote rows C263–C270, the version `2026-11-20.2` and `apps/server/src/legal-outside-calls.test.ts`.
Part of [`../plan.md`](../plan.md). Review: `claude-opus-5-5` before the land.

## Step 1 — the in-app texts (one appended legal version)

- **Seams:**
  - `apps/web/src/legal/{en,pl}/privacy.md`: "AI model" (P3), "AI results" (P4), "Why and on what basis" Drafts bullet (P5), "AI and decisions" (P4).
  - `apps/web/src/legal/{en,pl}/dpa.md` "Nature and purpose" Drafts line (P5).
  - `packages/core/src/legal/subprocessors.ts`: `openai` and `gemini` `purpose` and `dataReceived` (P6).
  - `packages/core/src/legal/data-categories.ts`: `mailbox-profile` `purpose` (P6).
  - `packages/core/src/web/terms.ts`: `TERMS_HISTORY` (P1, D4). Comment: "papers: reply-style suggestion from own sent mail".
- **Decisions:** P1, P3–P6, P8, D3, D4, D5. The pl and en pages keep the same `##` headings. Number strings follow D3 (en `60,000 characters`, pl `60000 znaków`). The P3 text quotes the button label of its language and stands before the Gemini sentence: the step 3 tie reads that slice.
- **Interfaces:** the version string comes from `nextLegalVersion`; `legal-version.test.ts` prints the line to append. Append; never change the digest of `2026-11-20.2`.
- **Release check:** after `git merge master`, read the `terms.ts` of the newest tag (`git tag --sort=-creatordate | head -1`). If it holds the last entry of master, a release went out: still append (P1), and the final message says the release notes need a second re-acceptance line.
- **Out of scope:** the terms page and `rs_suggest_note` (P8; stage 02), `tg_consent_text`, `sent_line`, the public claim (P7), the DPIA and record B (stage 02).

## Step 2 — ledger rows and the row count

- **Seams:** `docs/legal/claims.md` (D1), the pin in `apps/docs/src/security/claims.test.ts` (270 → 272).
- **New rows** (after C270; each ends with "Papers: …" like C263):
  - C271 — the style call input (the P3 input facts in the D3 strings, the cut only where the code finds quoted mail and the signature; prompt `stylist-v1`). Sources: `packages/core/src/replies/style-samples.ts`, `packages/core/src/replies/style-cut.ts`, `apps/server/src/modules/mail/repo/style-sources.ts`, `apps/server/src/modules/triage/prompts/stylist-v1.ts`. Condition: flag `style_from_sent`. Papers: privacy policy, registry, DPIA.
  - C272 — when and how often (an owner tap; the switch; at most 3 runs a day per mailbox that end with an answer, a failed check or an AI error; at most 2 calls per run; no new try after an AI service error; an answer of at most 1,000 characters; no stored text). Sources: `apps/server/src/modules/replies/style-suggest.ts`, `apps/server/src/modules/replies/stylist.ts`, `docs/capabilities/reply-drafts.md` rule 17. Condition: flag `style_from_sent`.
- **Changed rows:** as D1.

## Step 3 — the ties of the digest inputs

- **File:** `apps/server/src/legal-outside-calls.test.ts`, new `describe("style suggestion")` (D2). Imports through public indexes: `@ea/core` (`STYLE_SAMPLE_MAX_CHARS`, `STYLE_SAMPLES_MAX_CHARS`, `STYLE_MAX_SOURCES`, `STYLE_SUGGESTION_MAX_CHARS`, `buildStyleSamples`, `DAY_MS`), `./modules/replies` (`STYLE_SUGGEST_WINDOW_MS`, `STYLE_SUGGEST_DAILY_LIMIT`, `STYLIST_MAX_CALLS`), `./modules/triage` (`prompts`).
- **Test** (number strings built from the constants, D3):
  1. Pins, one `test.each` row each, named "re-check the privacy papers": `STYLE_SAMPLE_MAX_CHARS` 1500, `STYLE_SAMPLES_MAX_CHARS` 60000, `STYLE_MAX_SOURCES` 100, `STYLE_SUGGEST_WINDOW_MS / DAY_MS` 14, `STYLE_SUGGEST_DAILY_LIMIT` 3, `STYLIST_MAX_CALLS` 2, `STYLE_SUGGESTION_MAX_CHARS` 1000, `prompts.stylist.version` `stylist-v1`, `prompts.stylist.role` `stylist`.
  2. `buildStyleSamples([{ bodyText: "Hi team,\nThe offer is attached.\n\nOn Mon, 16 Nov 2026, Anna Nowak wrote:\n> Please send the offer.", toAddresses: ["anna.nowak@example.com"], ccAddresses: [] }], { signature: null })` has keys `["samples", "names"]` and `samples` equals `["Hi team,\nThe offer is attached."]`.
  3. `test.each` over en and pl privacy pages, on the slice from the `rs_suggest_button` text of that language to the Gemini sentence (en "An install can use Google Gemini instead", pl "Instalacja może zamiast tego używać Google Gemini"): the slice exists and holds the per-mail cap, the total cap, the window and the answer cap.
  4. Row C271 holds the en per-mail and total cap strings and `prompts.stylist.version`; row C272 holds the en answer cap string.
  5. `openai` and `gemini` `dataReceived`: en holds the en per-mail and total cap strings, pl the pl ones; `gemini` en holds `writing style`.
- **Break check:** set `STYLE_SAMPLE_MAX_CHARS` to 1499 locally: cases 1, 3, 4, 5 fail; revert.

## Other checks

`legal-version.test.ts` (it fails with the digest line before the entry: see it once), `claims.test.ts` (272 rows), `legal-papers.test.ts` and the `apps/web/src/lib/legal-*.test.ts` files pass.

## Done when

- Ticket Acceptance lines 1–3 hold.
- `git diff master -- packages/core/src/web/terms.ts` shows one added line and no removed line.
- The plan's Proof exits 0; the final message copies the `check:job` line.
