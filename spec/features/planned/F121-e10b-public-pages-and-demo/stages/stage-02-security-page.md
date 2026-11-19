# F121 stage 02 — Security and data page (en)

Part of [`../plan.md`](../plan.md). `[risky]` security claims: an overclaim here is the main risk of the epic. Decisions P2, D2, Q9. Needs stage 01.

Carry-over reads: `E10-discovery-notes.md` §4.2, `docs/legal/claims.md`, `packages/core/src/legal/subprocessors.ts`, `apps/web/src/lib/legal-tables.ts` (`usedWhenText`), ADR 0015, 0017, 0024, 0030, PD-101 text in `docs/product/stage-2/03-product-frame.md` §2.

## Step 1 — Claim rows

**Decisions.**
- Start from the 13 rows of notes §4.2; keep a row only when it passes the stage 01 check (strong ledger rows, proofs named in them). Write the claim no stronger than its ledger row; reuse the ledger's wording where it fits.
- Order (buyer questions): never sends alone → where mail is stored → what the AI provider receives → Telegram → backups → logs → Healthchecks → retention → export and delete → Undo → panel on a private network.
- Buyer facts that only weak rows hold (training, processing location; ledger C033, C036 at the plan base): not in the table. They go to "What this product does not promise" as an outside statement with its date and source link, worded "The provider states …; this project has not checked the contract." (Q9.)
- A claim that a default-off flag changes is left out (owner rule); stage 01 scans the claim text.
- `condition` in plain words, no env names. `pl` text written now.

**Test.**
1. `claimProblems(publicClaims, repoRoot(), ledger)` = `[]` at HEAD.
2. Every row has `en` and `pl`, no `<`, no `TODO`.
3. The first row id is `never-sends-alone`; its ledger holds the send-approval row (C018 at the plan base).

## Step 2 — The page

**Files.** New `apps/docs/src/content/docs/security.mdx`, `apps/docs/src/components/ClaimsTable.astro`, `Subprocessors.astro`; new `apps/docs/src/security/subprocessor-view.ts` and test; sidebar entry.

**Decisions.**
- Checklist: 5–7 one-line items, each a link to `#claim-<id>`.
- Table: claim; proof links (`proofUrl`, text = file name); condition or "—".
- Sub-processors (review 1 B3): every registry row through `subprocessorView(row, lang)`. A field whose value holds `<` … `>` (a placeholder such as `<to confirm: location>` or `<SMTP provider>`) renders as "Not confirmed yet" / "Jeszcze nie potwierdzone"; a placeholder `termsUrl` renders no link. No raw placeholder reaches the HTML.
- "Hosts of this site": GitHub Pages; GitHub logs visitor IPs; no cookies, no analytics, no user data (ADR 0030).
- "What this product does not promise": no certification or audit, no legal review, no EU-only AI processing by default (PD-101), no end-to-end encryption of Telegram notices, drafts can be wrong, plus the weak buyer facts above.
- Front matter `capabilities` set. No competitor, person or host name.

**Test.**
4. `subprocessorView` on a row with `location.en = "<to confirm: country>"` → `"Not confirmed yet"`; `termsUrl = "<to confirm: …>"` → `termsUrl: null`; a clean row unchanged.
5. Built HTML of `/security/` (read `dist` in a unit test after `docs:build`, or in `docs:test`): one table row per claim with the claim text equal to `publicClaims[i].text.en`; one sub-processor row per registry row; the page holds no `&lt;to confirm` and no `<to confirm`.
6. Browser check: heading, ≥ 5 checklist links that resolve to anchors; axe zero violations.
7. Mutation: a row with a proof outside its ledger row → `docs:build` fails `proof_not_in_ledger`; restore.

**Check.** `bun test apps/docs/src apps/docs/integrations`, `bun run docs:build`, `flock /tmp/email-assistant-shared-tests.lock bun run docs:test`.

**Done when.** Tests 1–7 pass; the final message lists the left-out §4.2 rows with reasons; Proof prints `PROOF_OK`.

**Out of scope.** Polish page (stage 05); ledger, registry or legal text edits (report gaps instead).
