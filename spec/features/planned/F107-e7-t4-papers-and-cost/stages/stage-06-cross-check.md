# F107 stage 06 — Cross-check and claims list

Part of [`../plan.md`](../plan.md). Decisions P2, P5, D5, D9, E2. Needs stage 05. A fresh worker checks stages 01–05.

## Step 1 — Claims list

**Goal.** `docs/legal/claims.md` lists every factual claim of the six in-app texts, the two registries and the three internal papers, with its source, for an auditor and E10b.

**Interfaces.** D9 table `| # | Claim | Source | Condition |`. `#` is `C001`, `C002`, … in text order. "Claim" is one English sentence (the pl text makes the same claims; one row covers both). "Source" is a repo path (a test file where one proves the claim, else the code or the capability page), an ADR, or a public URL with the date read. "Condition" is the config or the ticket that changes the claim (`LLM_PROVIDER=openai`; F117 for Telegram detail), or `—`.

**Decisions.**
- A claim is a statement that can be false: a number, a period, a data item, a recipient, a location, a behaviour, a right and its path. Headings, placeholders and definitions are not claims.
- Open each source at `HEAD` and check the claim against it. Three outcomes:
  1. True: one row.
  2. False in the text: fix the text (pl and en), then one row.
  3. False in the code (the text states a rule that the code breaks): leave the text, add the row with "Source: gap", and report the gap in the final message; the coordinator opens a ticket.
- A claim with no source becomes `<to confirm: …>`; no row.
- Public facts (provider terms URLs, OpenAI and Telegram data locations, transfer mechanisms, the GDPR articles of plan § Not verified): read the page if the job has network access, and write the URL and the date; without access, keep the placeholder and list the fact in the final message. Each `termsUrl` of the sub-processor registry gets a row.
- A false registry value (any row, any category) is outcome 2: fix the row. The consent text `tg_consent_text` is owner-approved: the `telegram` row follows it, never the reverse.
- Also check the rows that stages 03–05 reported as wrong.

## Step 2 — Version guard and the one bump

**Goal.** D5: from now on no legal text ships without a new version; the papers get their first real version.

**Files.** `packages/core/src/web/terms.ts`; the test-only module `apps/web/src/lib/legal-checks.ts` (`legalTextsDigest(parts: readonly string[]): string`, SHA-256 hex, CRLF → LF, fixed order) and its unit test.

**Interfaces.** `TERMS_HISTORY: readonly { version: string; sha256: string | null }[]`, append-only; the first entry is `{ version: "2026-11-12", sha256: null }` (the stub era); `TERMS_VERSION` is the version of the last entry. This stage appends `{ version: <UTC date of the commit>, sha256: <digest> }`.

**Decisions.** The digest covers the six Markdown files, `JSON.stringify` of both registries, and the `en` and `pl` values of every `legal_*` key and of `tg_consent_text`.

**Test.**
1. `legalTextsDigest(["x\r\n"]) === legalTextsDigest(["x\n"])`; `legalTextsDigest(["a","b"]) !== legalTextsDigest(["b","a"])`.
2. The last entry's `sha256` equals the digest of the current files; on a mismatch the message is "append a new TERMS_HISTORY entry".
3. Versions are unique; non-null digests are unique; only the first entry has `null`; each version matches `^\d{4}-\d{2}-\d{2}(-\d+)?$`.
4. `TERMS_VERSION` equals the last entry's version; the existing terms tests pass (the dialog shows for the old version).

## Step 3 — Close

- `docs/legal/README.md` gains the claims list line; the claim counts per paper go at the top of `claims.md`.

**Test.**
5. A unit test (the stage 05 file): every row of `claims.md` has a non-empty claim and source; ids are unique and in order; every repo path in the Source column exists.
6. Every ADR number in the Source column is a file in `docs/decisions/`.
7. The placeholder and parity checks pass.

**Check.** The unit tests; `bun run web:build`; `legal.spec.ts` under the lock (Proof with e2e).

**Done when.** Tests 1–7 pass, each claim has a row or became a placeholder, and the Proof prints `PROOF_OK`. The final message holds: the claim counts, each text fix (paper, old, new), each code gap, each public fact that stays unverified.

**Out of scope.** New sections or new claims; code fixes for a gap (a ticket); the cost model (08).
