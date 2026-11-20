# F121 stage 02 — Security and data page (en)

Needs stage 01: `publicClaims`, `claimProblems`, `proofUrl`, the `claimCheck` integration, `OWNER_REVIEW_PENDING` holding `security`. Needs F138 stage 02: `subprocessors.ts` without the row `gemini`. May run next to 03 (shared sidebar: merge, re-prove). Playwright (`docs:test`): lock rule until F136 lands.

Part of [`../plan.md`](../plan.md). `[risky]` security claims: an overclaim is the main risk of the epic. P2, D2, Q9, Q11.

Carry-over reads: notes §4.2, `docs/legal/claims.md`, `subprocessors` (`@ea/core/web`), ADR 0015, 0017, 0024, 0030, PD-101 (`03-product-frame.md` §2).

## Step 1 — Claim rows

**Decisions.**
- Start from the 13 rows of notes §4.2; keep a row only when it passes the stage 01 check. Write the claim no stronger than its ledger row; reuse its wording.
- Order: never sends alone → mail storage → what the AI provider receives → Telegram → backups → logs → Healthchecks → retention → export and delete → Undo → private-network panel.
- Buyer facts that only weak rows hold (training, processing location; ledger C033, C036 at the plan base): not in the table. They go to "What this product does not promise" worded "The provider states …; this project has not checked the contract.", with date and source link (Q9).
- A claim that a default-off flag changes is left out (owner rule); stage 01 scans the claim text.
- `condition` in plain words, no env names. `pl` text written now.
- No claim cites a ledger row that F138 stage 04 rewrites (the Gemini rows C038, C139–C141 and the recipient lists C182, C184, C196 at the base), so F138 ledger edits cannot break the claim check; no claim text names Gemini (P2).

**Test.**
1. `claimProblems(publicClaims, repoRoot(), ledger)` = `[]` at HEAD.
2. Every row has `en` and `pl`, no `<`, no `TODO`.
3. The first row id is `never-sends-alone`; its ledger holds the send-approval row (C018 at the plan base).

## Step 2 — The page

**Files.** New `apps/docs/src/content/docs/security.mdx`, `apps/docs/src/components/ClaimsTable.astro`, `Subprocessors.astro`; new `apps/docs/src/security/subprocessor-view.ts` and test; sidebar entry.

**Decisions.**
- Checklist: 5–7 one-line items, each a link to `#claim-<id>`.
- Table: claim; proof links (`proofUrl`, text = file name); condition or "—".
- Sub-processors (review 1 B3): every registry row through `subprocessorView(row, lang)`, with a "used when" text that `subprocessorView` makes from `activeWhen` in plain words, en and pl, and no env key name (review 2 N5: `usedWhenText` prints keys and is not importable). For example: `always` → "Always"; `env` → "When the operator sets up this service"; `llmProvider` → "When the install uses this AI provider"; `host` → "When the server makes backups". Flag-gated rows and texts (`web-push`, reply-draft data) show as the registry says (Q11). A field that holds `<` … `>` (`<to confirm: location>`, `<SMTP provider>`) renders as "Not confirmed yet" / "Jeszcze nie potwierdzone"; a placeholder `termsUrl` renders no link.
- "Hosts of this site": GitHub Pages; GitHub logs visitor IPs; no cookies, no analytics, no user data (ADR 0030).
- "Does not promise": no certification or audit, no legal review, no EU-only AI by default (PD-101), no end-to-end encryption of Telegram notices, drafts can be wrong, the weak buyer facts above.
- Front matter `capabilities` set. No competitor, person or host name.

**Test.**
4. `subprocessorView` on a row with `location.en = "<to confirm: country>"` → `"Not confirmed yet"`; `termsUrl = "<to confirm: …>"` → `termsUrl: null`; a clean row unchanged; each `activeWhen` kind gives its text, and an `env` row's text does not hold its `key`.
5. Built HTML of `/security/` (`dist` after `docs:build`, or in `docs:test`): one table row per claim with the claim text equal to `publicClaims[i].text.en`; one sub-processor row per registry row; the page holds no `&lt;to confirm` and no `<to confirm`.
8. The same built HTML holds no `gemini` (case-insensitive).
6. Browser check: heading, ≥ 5 checklist links that resolve to anchors; axe zero violations.
7. Mutation: a row with a proof outside its ledger row → `docs:build` fails `proof_not_in_ledger`; restore.

**Check.** `bun test apps/docs/src apps/docs/integrations`, `bun run docs:build`, `flock /tmp/email-assistant-shared-tests.lock bun run docs:test`.

**Done when.** Tests 1–8 pass; the final message lists the left-out §4.2 rows with reasons; Proof prints `PROOF_OK`.

**Out of scope.** Polish page (stage 05); ledger, registry or legal text edits (report gaps instead).

## Coordinator amendment 2026-11-20 (F138 dropped)

The owner dropped F138: Gemini stays in the code as an optional provider, off by default. Ignore every "Needs F138 stage 02/04" line and every test that says the built page holds no `gemini`. New rule: a public page names only the providers and sub-processors that run by default (the OpenAI provider and the hosting). It never says that Gemini is removed, and it never claims "only OpenAI" for the code. If a ledger row names Gemini, a claim may cite it only with its condition "optional, off by default". Replace the "no `gemini`" test by a test that the page holds no Gemini text outside such a condition. The pages stay held by `OWNER_REVIEW_PENDING`.
