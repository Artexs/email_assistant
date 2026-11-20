# F163 stage 01 — in-app texts, registries, legal version and ledger rows `[risky]`

Needs: nothing new; F162 (landed) wrote rows C263–C270 and the version `2026-11-20.2`.
Part of [`../plan.md`](../plan.md). Review: `claude-opus-5-5` before the land.

## Step 1 — the in-app texts (one appended legal version)

- **Goal:** every digest input says P3–P6, and one new appended legal version carries the change.
- **Seams:**
  - `apps/web/src/legal/{en,pl}/privacy.md`: "AI model" (P3, after the open-loops part and before "An install can use Google Gemini instead"), "AI results" (P4), "Why and on what basis" Drafts bullet (P5), "AI and decisions" (P4).
  - `apps/web/src/legal/{en,pl}/dpa.md` "Nature and purpose" Drafts line (P5).
  - `packages/core/src/legal/subprocessors.ts`: `openai` and `gemini` `purpose` and `dataReceived` (P6); `gemini` also gets the reply-draft fields of `openai`.
  - `packages/core/src/legal/data-categories.ts`: `mailbox-profile` `purpose` (P6).
  - `packages/core/src/web/terms.ts`: `TERMS_HISTORY` (P1, D4). Comment: "papers: reply-style suggestion from own sent mail".
- **Decisions:** P1, P3–P6, P8, D3, D4, D5. The pl and en pages keep the same `##` headings. The P3 text quotes the button label as the panel shows it (`rs_suggest_button` of that language) and stands before the Gemini sentence: the stage 02 tie reads that slice. Each number string follows D3 (en `1,500 characters`, `60,000 characters`, `1,000 characters`, `100`, `14 days`; pl `1500 znaków`, `60000 znaków`, `1000 znaków`, `100`, `14 dni`).
- **Interfaces:** the version string comes from `nextLegalVersion`; `legal-version.test.ts` prints the line to append. Append; never change the digest of `2026-11-20.2`.
- **Release check:** after `git merge master`, run `git tag --sort=-creatordate | head -1` and read that tag's `terms.ts`. If it already holds the last entry of master, a release went out: the new entry still appends (P1 is the same), and the final message says the release notes need a second re-acceptance line.
- **Out of scope:** the terms page (P8), `tg_consent_text`, `sent_line`, the public claim (P7), the DPIA and record B (stage 02).

## Step 2 — ledger rows and the row count

- **Goal:** each new claim has a row; changed claims have changed rows.
- **Seams:** `docs/legal/claims.md` (D1), the pin in `apps/docs/src/security/claims.test.ts` (270 → 272).
- **New rows** (after C270, in the section of rows added by later changes; each ends with "Papers: …" like C263):
  - C271 — the style call input (P3: up to 100 own sent mails of the last 14 days, the cut, 1,500 characters each, 60,000 in all, no subject or address, the text can hold facts of other people; prompt `stylist-v1`). Sources: `packages/core/src/replies/style-samples.ts`, `apps/server/src/modules/mail/repo/style-sources.ts`, `apps/server/src/modules/triage/prompts/stylist-v1.ts`. Condition: flag `style_from_sent`. Papers: privacy policy, registry, DPIA.
  - C272 — when and how often (an owner tap; the switch "Track my sent mail"; at most 3 runs a day per mailbox; at most 2 calls per run; no new try after an AI service error; an answer of at most 1,000 characters; the server stores no text). Sources: `apps/server/src/modules/replies/style-suggest.ts`, `apps/server/src/modules/replies/stylist.ts`, `docs/capabilities/reply-drafts.md` rule 17. Condition: flag `style_from_sent`.
- **Changed rows:** C136 and C139 (AI rows: purpose and data received; C139 also the reply-draft fields), the `mailbox-profile` registry row, the privacy and DPA Drafts purpose rows, the AI results and AI and decisions rows whose text now differs.
- **Decisions:** D1.

## Test

1. `bun test apps/web/src/lib/legal-version.test.ts` passes with the new last entry; before the entry it fails with the digest line (see it once).
2. `bun test apps/docs/src/security/claims.test.ts` passes with 272 rows.
3. `bun test apps/server/src/legal-papers.test.ts` passes: ids in order, sources exist, the count table matches, `sevenDayLimitProblems` finds nothing in the pages.
4. `bun test apps/web/src/lib/legal-checks.test.ts apps/web/src/lib/legal-privacy.test.ts apps/web/src/lib/legal-terms-dpa.test.ts` pass (headings pair, placeholders).
5. `bun test apps/server/src/legal-outside-calls.test.ts` still passes (the F162 ties: the open-loops strings stay in each page and row).

The style ties are stage 02.

## Done when

- Ticket Acceptance lines 1 and 2 hold.
- `TERMS_HISTORY` ends with one new entry after `2026-11-20.2`, and the `.2` line is unchanged (`git diff master -- packages/core/src/web/terms.ts` shows one added line and no removed line).
- The plan's Proof exits 0; the final message copies the `check:job` line.
