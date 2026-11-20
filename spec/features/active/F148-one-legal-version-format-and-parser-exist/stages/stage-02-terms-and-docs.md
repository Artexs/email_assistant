# F148 stage 02 — terms history, guard message and docs on the one format

Needs stage 01: `packages/core/src/web/legal-version.ts` (`parseLegalVersion`, `compareLegalVersions`, `isCanonicalLegalVersion`, `nextLegalVersion`).

Part of [`../plan.md`](../plan.md).

## Step 1 — the terms history checks

- **Goal:** the terms history is checked with the module, and no new hyphen entry can land (D3, D9).
- **Files:** `packages/core/src/web/terms.ts` (comments only), `packages/core/src/web/terms.test.ts`.
- **Decisions:**
  - D3. After `git merge master`, read the hyphen entries of `TERMS_HISTORY`. They form the frozen list `LEGACY_HYPHEN_VERSIONS` in `terms.test.ts` (`2026-11-18-2`, `2026-11-19-2` at the plan base; add any that master added since, and name them in the result).
  - The comment of `TermsHistoryEntry.version` and the comment above `TERMS_HISTORY` state the format by pointing to the module: new entries use the dot; the hyphen entries are the legacy spelling of the same counter, kept because stored acceptance rows hold these strings.
  - No `version:` string, digest or entry changes.
- **Test (replace test 3 "form" and "versions grow"):**
  - 1. Every version parses with `parseLegalVersion`.
  - 2. Every version is canonical or is in `LEGACY_HYPHEN_VERSIONS`. Failure message names the entry and its canonical spelling (`formatLegalVersion`). Break check: add `{ version: "2026-11-21-2", … }` locally, see the test fail, remove it.
  - 3. Every entry of `LEGACY_HYPHEN_VERSIONS` is in `TERMS_HISTORY` (the list cannot hold a stale name).
  - 4. Each version is strictly after the one before it under `compareLegalVersions` (unique and ordered in one check). Break check: swap two entries locally.
  - 5. `TERMS_VERSION` is canonical (`isCanonicalLegalVersion`) or is in `LEGACY_HYPHEN_VERSIONS` (D3: when master appended a hyphen entry, it is the current version; never rename it).
  - The stub-era test and test 4 stay.
- **Done when:** the tests pass and each break check failed as expected.

## Step 2 — the guard message names the next version

- **Goal:** a worker that changes a legal text sees the version to append (D7).
- **Files:** `apps/web/src/lib/legal-version.test.ts`.
- **Decisions:** the failure message of the digest test becomes: append `{ version: "<next>", sha256: "<digest>" }` to `TERMS_HISTORY` in `packages/core/src/web/terms.ts`, where `<next>` is `nextLegalVersion(TERMS_VERSION, <UTC date of now>)`. The test computes today with `new Date().toISOString().slice(0, 10)`; this is test code, not core. The message adds one line: when `tg_consent_text` changed, `TELEGRAM_CONSENT_VERSION` moves too (`docs/code-patterns.md` § the consent version).
- **Test:** the digest assert itself is unchanged. Check the message by hand once (change one legal key locally, read the message, restore); do not commit it.
- **Done when:** the test passes at `HEAD`; the hand check showed a canonical `<next>`.

## Step 3 — the docs say one format

- **Goal:** the docs that teach the bump rule teach the one format.
- **Files:** `docs/code-patterns.md` § the consent version (the sentence on `<date>.2`, `<date>.3`), `docs/capabilities/papers.md` (rule 5 and its function table row: add `packages/core/src/web/legal-version.ts`).
- **Decisions:** one sentence each: both stamps use `YYYY-MM-DD` and `.N` from 2; `nextLegalVersion` gives the next one; the two old hyphen terms entries stay as stored. Do not restate the grammar in more places.
- **Done when:** ``grep -rnF -e 'YYYY-MM-DD-N' -e '`-2`, `-3`' docs/ packages/core/src apps/web/src`` finds nothing (this is the acceptance; at the plan base it finds `terms.ts` and `terms.test.ts`).

## Out of scope

`consentCovers` and the scan test (stage 01). Other tickets' stage files that still say `-2`: the coordinator gets the list from the plan's final message. Route equality (D8).

## Done when

- Steps 1–3 done; no `version:` value in `terms.ts` changed (`git diff` on the merge base shows comment lines only in that file).
- The Proof of plan.md ends with `PROOF_OK`, run after the last commit.
