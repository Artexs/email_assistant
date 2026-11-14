# F107 stage 06 — Cross-check and claims list

Part of [`../plan.md`](../plan.md). Decisions P2, D9, E2. Needs stage 05. A fresh worker checks what stages 01–05 wrote; it did not write it.

## Step 1 — Claims list

**Goal.** `docs/legal/claims.md` lists every factual claim of the six in-app texts, the two registries and the three internal papers, with its source, so that an auditor (and E10b) can check each one.

**Interfaces.** D9 table `| # | Claim | Source | Condition |`. `#` is `C001`, `C002`, … in text order. "Claim" is one English sentence (the pl text makes the same claims; one row covers both). "Source" is a repo path (a test file where one proves the claim, else the code or the capability page), an ADR, or a public URL with the date read. "Condition" is the config or the ticket that changes the claim (`LLM_PROVIDER=openai`; F117 for Telegram detail), or `—`.

**Decisions.**
- A claim is a statement that can be false: a number, a period, a data item, a recipient, a location, a behaviour, a right and its path. Headings, placeholders and definitions are not claims.
- Open each source at `HEAD` and check the claim against it. Three outcomes:
  1. True: one row.
  2. False in the text: fix the text (pl and en), then one row.
  3. False in the code (the text states a rule that the code breaks): leave the text, add the row with "Source: gap", and report the gap in the final message; the coordinator opens a ticket.
- A claim with no source becomes a placeholder `<to confirm: …>` in the text; no row.
- Public facts (provider terms URLs, OpenAI and Telegram data locations, transfer mechanisms, the GDPR articles of plan § Not verified): read the page if the job has network access, and write the URL and the date; without access, keep the placeholder and list the fact in the final message. Each `termsUrl` of the sub-processor registry gets a row.
- The consent text `tg_consent_text` and the `telegram` row of the registry must list the same data items; a difference is outcome 2 for the registry row (the consent text is owner-approved, do not change it).

## Step 2 — Final version and docs

**Goal.** One last version bump for the deploy, and the docs that point to the papers.

**Decisions.**
- Set `TERMS_VERSION` and `LEGAL_TEXTS_SHA256` once more if this stage changed a text (D5).
- `docs/legal/README.md` gains the claims list line.
- Count the claims per paper and write the counts at the top of `claims.md`.

**Test.**
1. A unit test (the stage 05 file): every row of `claims.md` has a non-empty claim and source; ids are unique and in order; every repo path in the Source column exists.
2. Every ADR number in the Source column is a file in `docs/decisions/`.
3. The text guard, placeholder and parity tests pass.

**Check.** The unit tests of `apps/server/src/` and `apps/web/src/lib/`; `bun run web:build`.

**Done when.** Tests 1–3 pass, every claim of the papers has a row or became a placeholder, and the Proof prints `PROOF_OK`. The final message holds: the claim counts, each text fix (paper, old, new), each code gap, each public fact that stays unverified.

**Out of scope.** New sections or new claims; code fixes for a gap (a ticket); the cost model (08).
