# F162 stage 02 — code ties and capability pages

Needs stage 01: the privacy pages, the AI registry rows, `unsubscribe-data` subjects and rows C263–C266. May run next to 04.
Part of [`../plan.md`](../plan.md). Lands on the proof (no review job).

## Step 1 — the tie test file

- **Goal:** a change of the extractor input, the prompt pointer, a limit, or the one-click request fails a test until the papers follow.
- **File:** new `apps/server/src/legal-outside-calls.test.ts` (D2). Imports: `@ea/core` (`EXTRACT_BODY_MAX`, `SENT_MAX_AGE_DAYS`, `SENT_MAX_RECIPIENTS`, `EXTRACT_TEXT_MAX`, `extractorInputOf`, `reportMailKinds`, `dataCategories`, `subprocessors`), `./modules/triage` (`prompts`), `./modules/loops` (`MAX_ATTEMPTS`), `./platform/public-http` (`ONE_CLICK_BODY`, `ONE_CLICK_USER_AGENT`).
- **Decisions:** D2, D3 (every number string in cases 3–7 is built from its constant: en `toLocaleString("en-US")`, pl the plain number).
- **Test:**
  1. Pinned values, one `test.each` row each, with a name that says "re-check the privacy papers": `EXTRACT_BODY_MAX` 8000, `SENT_MAX_AGE_DAYS` 14, `SENT_MAX_RECIPIENTS` 10, `EXTRACT_TEXT_MAX` 80, `MAX_ATTEMPTS` 3, `prompts.extractor.version` `extractor-v1`, `ONE_CLICK_BODY` `List-Unsubscribe=One-Click`, `ONE_CLICK_USER_AGENT` `email-assistant-unsubscribe/1`, `reportMailKinds` equal `["digest", "weekly_report", "trust_report_ready", "autonomy_paused"]`.
  2. `Object.keys(extractorInputOf({ subject: "Offer", bodyText: "Can you send it by Friday?", sentAt: new Date("2026-11-20T09:00:00Z"), to: ["a@example.com"], cc: [] }, "Europe/Warsaw"))` equals `["subject", "sentLocal", "recipientCount", "body"]`, and `JSON.stringify` of the result does not contain `a@example.com`.
  3. `test.each` over en and pl privacy pages: each holds the body cap (`8,000 characters` / `8000 znaków`), the age limit (`14 days` / `14 dni`) and the recipient limit (`10 recipients` / `10 adresatów`).
  4. `test.each` over en and pl privacy pages: each holds `ONE_CLICK_BODY`.
  5. Row C263 holds the en body-cap string and `prompts.extractor.version`; row C264 holds the en age and recipient strings.
  6. Row C265 holds `ONE_CLICK_BODY` and `ONE_CLICK_USER_AGENT` (the values).
  7. The `openai` and `gemini` `dataReceived`: en holds the en body-cap string, pl the pl one.
  8. `unsubscribe-data` subjects equal `["users", "others"]`.
  9. `deploy/README.md` does not contain `does not yet name the one-click request`.
- **Break checks:** set `EXTRACT_BODY_MAX` to 7999 locally: cases 1, 3, 5, 7 fail; revert. Add a key `from` to the `extractorInputOf` result locally: case 2 fails; revert.
- **Check:** `bun test apps/server/src/legal-outside-calls.test.ts`.

## Step 2 — capability pages

- **Goal:** the behaviour pages point to the papers.
- **Seams:** `docs/capabilities/open-loops.md` rule 2: one sentence that lists the fields of the extractor call (P3) and names the privacy page; `docs/capabilities/trust.md` rule 21 ("The privacy page names this request") and rule 19 ("The privacy page names report mail, also in shadow mode"); `docs/capabilities/papers.md` rule 9 adds F162 to the seams. Set the "Checked against" line of each changed page.
- **Out of scope:** any text in `apps/web/src/legal` or a registry (a change there needs a new legal version: stage 01 owns it; a gap found here is a question).

## Done when

- Cases 1–9 pass, and the two break checks failed as stated.
- The plan's Proof exits 0; the final message copies the `check:job` line.
