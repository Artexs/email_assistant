# F121 stage 02 — Security and data page (en)

Part of [`../plan.md`](../plan.md). `[risky]` security claims: an overclaim here is the main risk of the epic. Decisions P1, P2, D2. Needs stage 01.

Carry-over reads: `E10-discovery-notes.md` §4.2 (draft claim list and "does not promise"), `docs/legal/claims.md` (the ledger), `packages/core/src/legal/subprocessors.ts`, `apps/web/src/lib/legal-tables.ts` (`usedWhenText`), `apps/web/src/components/legal/SubprocessorsTables.astro`, ADR 0015, 0017, 0024, 0028, 0030, PD-101 text in `docs/product/stage-2/03-product-frame.md` §2, `apps/docs/src/flagged-text.ts`.

## Step 1 — Claim rows

**Goal.** `publicClaims` holds the rows of the page, each tied to the ledger and a proof.

**Decisions.**
- Start from the 13 rows of notes §4.2; keep a row only when a ledger row (not weak) and a proof exist at HEAD. A row that cannot be proved is left out and named in the final message. Do not soften a ledger claim into a stronger one.
- Order (buyer questions of notes §3 fact 10): never sends alone → where mail is stored → AI provider: what it receives, training, retention → processing location (US today; PD-101 text) → Telegram: what it receives, not end-to-end encrypted → backups encrypted → logs → Healthchecks → retention → export and delete → Undo and reasons → the panel on a private network.
- A claim that a default-off flag changes (for example earned autonomy under `trust_ladder`) is left out (owner rule 2026-11-15); the page holds no flagged text.
- `condition` names the config that changes the claim in plain words (no env names that hold secrets). "This install" claims hold for the home VPS install (ledger header rule).
- Polish text of each row is written now (the `pl` field); stage 05 uses it.

**Test.**
1. `claimProblems(publicClaims, repoRoot(), ledger)` = `[]` at HEAD.
2. Every row has `en` and `pl` text, no `<to confirm`, no `TODO`.
3. A test pins the first row id to `never-sends-alone` and asserts its ledger includes the send-approval row (C018 at the plan base; follow the ledger).

## Step 2 — The page

**Goal.** `/security/` renders the checklist, the table, the sub-processors, hosts and limits.

**Files.** New `apps/docs/src/content/docs/security.mdx`; new `apps/docs/src/components/ClaimsTable.astro`, `Subprocessors.astro`; sidebar entry in `astro.config.mjs` (top group, after home).

**Decisions.**
- Checklist: 5–7 one-line items, each a link to its table row anchor (`#claim-<id>`).
- Table cells: claim text; proof links (`proofUrl`, link text = file name); condition or "—".
- Sub-processors: every registry row, with `purpose`, `dataReceived`, `location`, `personalData`, and when it is used (`usedWhenText`). The page never invents a row.
- "Hosts of this site": GitHub Pages serves this static site; GitHub logs visitor IP addresses; the site sets no cookies and has no analytics; it holds no user data (ADR 0030).
- "What this product does not promise": no certification or audit, no legal review, no EU-only AI processing by default (PD-101), no end-to-end encryption of Telegram notices, drafts can be wrong.
- Front matter `capabilities` names the capability pages the claims rest on (the front-matter rule).
- No competitor name, no person name, no host name.

**Test.**
4. Unit: the rendered table (component test or a build-output read in `docs:test`) has one row per `publicClaims` entry and one sub-processor row per registry row.
5. Browser check (`apps/docs/e2e/site.spec.ts`): `/security/` has the heading, at least 5 checklist links, each resolving to an anchor on the page; axe zero violations.
6. Mutation: add a row with a missing proof path → `bun run docs:build` fails with `proof_missing`; restore.

**Check.** `bun test apps/docs/src apps/docs/integrations`, `bun run docs:build`, `flock /tmp/email-assistant-shared-tests.lock bun run docs:test`.

**Done when.** Tests 1–6 pass; the final message lists left-out §4.2 rows with the reason; Proof prints `PROOF_OK`.

**Out of scope.** Polish page (stage 05), changes to the ledger, registry or legal texts (report gaps to the coordinator instead).
