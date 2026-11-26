# Papers

> Checked against the code at `46d5aba06`, 2026-11-21.

## What it does now

The system has draft legal papers and a cost model. Three in-app texts (privacy policy, terms, data processing agreement) exist in Polish and English at `/legal/<lang>/<doc>`. A visitor opens them without a session. Each starts with the draft line "DRAFT, not legal advice". Four internal papers in English sit in `docs/legal/`: records of processing, a DPIA, a breach procedure and a claims list. Two typed registries (sub-processors and data categories) feed the pages and the papers, and tests compare them with the config, the database and the papers. The cost model gives the cost per mailbox per month from the measured pilot cost (`costToRun`) and is described in `docs/cost-model.md`. All papers are drafts for a private install; a lawyer has not read them.

## Rules

1. **The draft line stays.** Each of the six pages starts with the draft line of its language (P1) and then the version line (`TERMS_VERSION`). The page frame draws the lines and the generated tables; the Markdown body holds the text. A raw HTML tag in a source file is an error (`checkLegalSource`).
2. **Only facts with a source.** A text states the real setup at the build commit. A fact that no file states is a visible placeholder: an entry of `legalPlaceholders` (for example `<provider name>`) or `<to confirm: …>`. No person, company or address is named, because the repository is public. A source file writes a placeholder as `\<…>`.
3. **Registries are the source of the tables.** `subprocessors` lists each outside service that gets data, with its purpose, data, location, terms URL, `personalData` flag and the condition `activeWhen` under which this install uses it. `dataCategories` lists each category of stored personal data with its columns, purpose, subjects and keep period. The privacy page and the DPA (Annex 2) draw their tables from them. A page names a row as "used when", because a static page does not follow a provider switch.
4. **Coverage guards.** A new config key that names an outside endpoint or credential fails a test until `OUTSIDE_SERVICE_KEYS` maps it to a sub-processor row or gives an exempt reason. A new table or column fails a test until a data category holds it, or `NO_PERSONAL_DATA_TABLES` gives a reason. The records of processing must name every data category and every sub-processor with personal data.
5. **Version guard.** `TERMS_HISTORY` (`packages/core/src/web/terms.ts`) is append-only. A unit test hashes the six pages, both registries and the `legal_*` and `tg_consent_text` texts. The last entry must carry that digest. So a change of a text needs a new version, and each member then accepts the terms again at the next sign-in. Terms and consent versions use `YYYY-MM-DD` and `.N` from 2; `nextLegalVersion` gives the next one, and the two old hyphen entries stay as stored.
6. **Pairs agree.** A pl and an en page have the same number of `##` headings. The placeholders, the claims list and the paper paths are checked by `apps/server/src/legal-papers.test.ts`.
7. **Links.** `/login`, `/setup`, the Account card and the terms dialog link the three documents in the panel language (`LegalLinks`).
8. **Cost model.** `costToRun(mailsPerDay, opts?)` returns `{ llmUsd, hostingUsd, backupUsd, totalUsd, basis }` per mailbox per month (30 days). The LLM cost per mail is the pilot measure `pilotCost.llmUsd / pilotCost.triagedMails` when the pilot has at least 100 triaged mails and at most 5% unpriced calls (`basis: "measured"`); otherwise it is the E3 classifier figure (`basis: "estimate"`). Hosting and backup come from the same helper as `unitCost` (M7). A volume or host size of 0 or less throws `RangeError`. `docs/cost-model.md` holds the table; a test checks every cell against `costToRun`.
9. **Seams.** Tickets that change what the system sends or stores update the registries and texts in the same change, and then bump the version: F104 (Sent mail), F117 and F118 (OAuth, push, Telegram detail), F111 and F120 (EU endpoint, sender profiles) F112 (a GitHub row with `personalData: false`) and `F162-the-privacy-papers-name-what-the-open-loops-extractor-and-the-one-click-unsubscribe-send` (the extractor call, the one-click request and report mail; `apps/server/src/legal-outside-calls.test.ts` pins their limits) and `F163-the-privacy-papers-name-the-reply-style-call-that-sends-cut-sent-mail-to-the-ai` (the style call; the same test file pins its limits and ties the DPIA and the claims list to them and `F165-the-public-security-claim-and-the-dpia-flow-name-both-reply-draft-calls` (the draft call and the style call on the public security page and in the DPIA flow; the same test file ties the public claims, the DPIA and the claims list to the limits of both calls) and `F173-an-operator-runs-production-on-deepseek-with-one-setting-and-the-privacy-papers-name-it` (DeepSeek as a provider: the registry row, the privacy page, record B, the DPIA risk R11 and the security page; the public page keeps describing the default setup, and `apps/server/src/legal-outside-calls.test.ts` pins the DeepSeek facts).

## Entry points

| Kind     | Name                                          | Where                                          |
| -------- | --------------------------------------------- | ---------------------------------------------- |
| page     | `/legal/<lang>/<doc>`                         | `apps/web/src/pages/legal/[lang]/[doc].astro`  |
| function | `legalPath`, `legalPlaceholders`              | `apps/web/src/lib/legal.ts`                    |
| function | `subprocessors`                               | `packages/core/src/legal/subprocessors.ts`     |
| function | `dataCategories`, `NO_PERSONAL_DATA_TABLES`   | `packages/core/src/legal/data-categories.ts`   |
| function | `OUTSIDE_SERVICE_KEYS`                        | `apps/server/src/platform/outside-services.ts` |
| function | `TERMS_HISTORY`, `TERMS_VERSION`              | `packages/core/src/web/terms.ts`               |
| function | `parseLegalVersion`, `nextLegalVersion`       | `packages/core/src/web/legal-version.ts`       |
| function | `legalTextsDigest`, `legalTextParts`          | `apps/web/src/lib/legal-checks.ts`             |
| function | `costToRun`, `pilotCost`, `costModel`         | `packages/core/src/metrics/cost-model.ts`      |
| page     | the three links on sign-in, setup and Account | `apps/web/src/components/legal/LegalLinks.tsx` |

## Data

No table. The papers hold no personal data and no value of an environment variable. The Markdown sources are in `apps/web/src/legal/<lang>/<doc>.md`; the internal papers are in `docs/legal/`. A member's accepted version is `users.terms_version` (see [web-panel.md](web-panel.md)). The cost model has no stored data: `pilotCost` is a constant, the sum of four `stats:week` runs.

## Limits

- Every paper is a draft, not legal advice. A lawyer has not read them. Open facts are `<to confirm: …>` placeholders (the B2 bucket region, the home VPS cost and some provider terms).
- The pages are static: they do not follow a provider switch and show each row with its "used when" condition.
- The in-app texts are drafts for a private install with one owner. A public sign-up or billing needs a new ADR (ADR 0020) and a lawyer.
- The breach register is outside this repository.
- The pilot has 87 triaged mails, under the 100 of the `measured` rule, so `costToRun` gives `basis: "estimate"` until a longer window replaces `pilotCost`. The price of $25 is a placeholder; the pricing page is E10b.

## Decisions

- ADR 0020 (accounts, plan state, consent by mode, deletion), ADR 0012 (LLM data rules), ADR 0035 (EU endpoint).
- PD-049 (papers and cost v1), PD-059 (cost target and the hosting reference), PD-101 (one typed sub-processor file) in `docs/product/stage-2/decisions.md`.

## Tests

- `apps/server/src/legal-papers.test.ts` (records, claims, paper paths, placeholders)
- `apps/server/src/platform/outside-services.test.ts` (sub-processor rows against the config)
- `apps/server/src/cost-model-doc.test.ts` (the cost table against `costToRun`)
- `packages/core/src/legal/subprocessors.test.ts`, `packages/core/src/legal/data-categories.test.ts`
- `packages/core/src/metrics/cost-model.test.ts`
- `apps/web/src/lib/legal-version.test.ts` (the version guard), `apps/web/src/lib/legal-checks.test.ts`, `apps/web/src/lib/legal-tables.test.ts`, `apps/web/e2e/tests/legal.spec.ts`
