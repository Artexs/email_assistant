# F163 stage 02 — DPIA, record B, their ties, the panel note and capability pages

Needs stage 01: rows C271 and C272 in `docs/legal/claims.md` and `describe("style suggestion")` in `apps/server/src/legal-outside-calls.test.ts`.
Part of [`../plan.md`](../plan.md). Lands on the proof (no review job). Changes no legal digest input: a gap in the in-app pages or the registries is a question, not an edit.

## Step 1 — the DPIA and record B

- **Goal:** `docs/legal/dpia.md` and record B say what the style call sends and why.
- **Seams:**
  - DPIA "Description of the processing" Flow: one sentence group after the open-loops part (the P3 facts).
  - DPIA "Necessity and proportionality": Purposes (P5); under "Is the data needed?" one bullet for the style suggestion that quotes the en button label: the P3 limits; the cut runs only where the code finds quoted mail and the signature, so names, addresses and quoted mail of other people can go; the answer fails its check when it holds a name found in the samples or the recipient addresses, an address, a link, a phone or account number, or copied words; the server stores no text.
  - DPIA "Risks" R1 text names the style call next to the open-loops analysis; the R1 Measures row adds the style limits. No new risk; the R1 levels stay (P9).
  - `docs/legal/records-of-processing.md` record B "Purposes" (P5).
- **Decisions:** P3, P5, P9, D3, D5. The six `##` headings stay (test 3 of `legal-papers.test.ts`).

## Step 2 — the ledger row

- **Seams:** `docs/legal/claims.md`: new row C273 (the step 1 text; sources `docs/legal/dpia.md`, `docs/legal/records-of-processing.md`, `packages/core/src/replies/style-samples.ts`); change each DPIA or record B row whose text now differs (Purposes, R1 and its measures). The count table and the pin in `apps/docs/src/security/claims.test.ts` follow (272 → 273).
- **Decisions:** D1.

## Step 3 — the DPIA ties

- **File:** `apps/server/src/legal-outside-calls.test.ts`, inside the stage 01 `describe("style suggestion")`; strings built from the constants (D3).
- **Test:**
  6. The DPIA "Is the data needed?" bullet that holds the en button label holds the en per-mail cap, the en total cap and the en window string.
  7. Row C273 holds the en total cap string.
- **Break checks:** set `STYLE_SAMPLE_MAX_CHARS` to 1499 locally: cases 1, 3, 4, 5, 6, 7 fail (the total cap is `40 *` the per-mail cap); revert. Change `14 days` in the DPIA style bullet to `15 days`: case 6 fails; revert.
- **Check:** `bun test apps/server/src/legal-outside-calls.test.ts apps/server/src/legal-papers.test.ts apps/docs/src/security/claims.test.ts`.

## Step 4 — the panel note and capability pages

- **Panel note (P8):** `rs_suggest_note` in `apps/web/src/i18n/texts/en-reply.ts` and `pl-reply.ts`: "once" / "Jednorazowo" becomes the fact "in at most two calls" (pl the same fact, plain words). `bun test apps/web/src/i18n` passes (the key pairs and the plural rules).
- **Capability pages:** `docs/capabilities/reply-drafts.md` rule 17: one sentence that the privacy page, the registries and the DPIA name this call, with a pointer to `apps/server/src/legal-outside-calls.test.ts`; rule 19 names the note text if it quotes it. `docs/capabilities/papers.md` rule 9 adds this ticket folder path to the seams. Set the "Checked against" line of each changed page.

## Done when

- Cases 6–7 pass, and the break checks failed as stated.
- The DPIA and record B name the style call; `rs_suggest_note` no longer says "once".
- `git diff master -- packages/core/src/web/terms.ts` is empty.
- The plan's Proof exits 0; the final message copies the `check:job` line.
