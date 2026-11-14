# F095 stage 01 — Boundary docs (PD-001)

Part of [`../plan.md`](../plan.md). Decisions P1, D14, D15. Read "Rules for every stage" first.

Every document states one goal: sell-ready, not sold. Three steps. Docs only.

Base: find each line by its words (the line numbers are from `9d9bfb8`). If a line has changed since and no longer holds the stale words, leave it and name it in the final message.

## Step 1 — `spec/vision.md` (owner-owned file, D14)

- **Goal:** "Current direction" opens with the PD-001 text, and no line of the file says the product is sold or serves an external customer.
- **Files:** `spec/vision.md`.
- **Edits (exact text):**
  1. Insert as the first bullet of `## Current direction`, word for word (from `docs/product/stage-2/02-inventory-and-roadmap.md` §7):
     `- Goal (owner, 2026-11-12): a sell-ready product that is not sold. It is built, tested, documented and operated as a real product for other people, but it runs only on the owner's home VPS for the owner and test organizations. No real customer, billing account, company or lawyer. Each feature must meet the bar a paying customer would set.`
  2. Line 7, `- Product: an AI email assistant for executives and managers, sold as SaaS to business owners.` → `- Product: an AI email assistant for executives and managers, built as a multi-tenant product that business owners could buy (sell-ready, not sold: see "Current direction").` Keep the rest of the line (`It sorts, summarizes …`).
  3. Line 15, `EU location before external customers.` → `EU location before any outside user's mail.` Keep the rest of the line.
  4. Line 22, `- Pilot MVP (S0–S4) and the web panel lite (S5) are built and run on the home VPS on the user's own Interia mailbox.` → `- The MVP (S0–S5 and S6a customer core) is built and runs on the home VPS on the user's own Interia mailbox.` Keep ``Detail: `docs/roadmap.md`.``
  5. Line 23 (`- Now: S6 pre-sale, so the first external customer can sign up: …`), the whole bullet → ``- Now: Stage 2, sell-ready (`docs/product/stage-2/`). Ticket order: `docs/product/stage-2/05-execution-plan.md` §2. The old S6 segments are E7 tickets.``
  6. Line 24 (`- Open product question for S6: which mail providers the target customers use (market check P9 not done).`) → `- Open product question: which mail providers the target executives use (PD-007: five conversations, the owner's call).`
  7. Line 25 (pilot results) stays.
- **Interfaces:** none.
- **Decisions:** D14 (the owner may change or revert these lines; Q2).
- **Test:** none (docs).
- **Check:** `wc -l spec/vision.md` ≤ 1000. `grep -nE "sold as SaaS|external customer|first external" spec/vision.md` → no line.
- **Done when:** the check holds; `git diff spec/vision.md` shows only these six edits.
- **Out of scope:** any other line of `spec/vision.md`.

## Step 2 — `docs/product-brief.md`, `docs/roadmap.md`, `docs/architecture.md`, `docs/modules.md`

- **Goal:** the four docs agree with PD-001.
- **Files:** the four files.
- **Edits (exact text; "→" replaces the quoted words only, the rest of the line stays):**

| File                    | Find                                                                                                                                                            | Change                                                                                                                                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --- | --- | --------- | ---------------------------------------------------------------- | --- |
| `docs/product-brief.md` | Q1 row: `**A product (SaaS) for sale to business owners and managers.** Not only an own tool.`                                                                  | append `` Changed 2026-11-12: sell-ready, not sold (see `spec/vision.md`). The product must be ready for outside users; no outside user is served.`` (the PD-001 text, word for word)                                                                                                                |
| `docs/product-brief.md` | `## 5. Consequences of "a product for sale"`                                                                                                                    | `## 5. Consequences of "a sell-ready product"`                                                                                                                                                                                                                                                       |
| `docs/product-brief.md` | Q10 row: `External customers later need a hosted EU server.`                                                                                                    | ``External customers later need a hosted EU server. Changed 2026-11-12: no outside user is served (PD-001); production stays on the home VPS (E7-T5, `spec/features/planned/F108-e7-t5-production-on-the-vps/`).``                                                                                   |
| `docs/product-brief.md` | Privacy row: `Before external customers: Vertex AI with the EU endpoint and zero data retention.`                                                               | ``Before external customers: Vertex AI with the EU endpoint and zero data retention. **Changed 2026-11-13 (PD-110, ADR 0035 proposed):** the EU endpoint is an OpenAI Europe project, built in E11b (`spec/features/planned/F111-e11b-private-model-option/`); no outside user is served (PD-001).`` |
| `docs/roadmap.md`       | under the H1, after the last `>` line of the header                                                                                                             | a new header line ``> **Changed 2026-11-12 (PD-001):** sell-ready, not sold. After S6a the work follows Stage 2: `docs/product/stage-2/05-execution-plan.md` §2.``                                                                                                                                   |
| `docs/roadmap.md`       | `### Sellable MVP (+ S5, S6)`                                                                                                                                   | `### Sell-ready MVP (+ S5, S6a, S6b)`                                                                                                                                                                                                                                                                |
| `docs/roadmap.md`       | the bullet `- Sign-up, billing, account and data deletion, hosted EU production, Vertex AI EU, privacy policy and DPA, cost model.`                             | `- S6a customer core: plan state, suspend and resume, mailbox limit, retention (F077, deployed 2026-11-12). S6b login hardening (F082). Account data, papers and cost, VPS production: Stage 2 E7 (F106, F107, F108). No sign-up and no billing (PD-001, PD-047).`                                   |
| `docs/roadmap.md`       | §5 Data bullet: `Vertex AI EU before the first external customer (S6).`                                                                                         | `an EU endpoint before any outside user's mail (ADR 0035 proposed, E11b F111; PD-001: no outside user is served).`                                                                                                                                                                                   |
| `docs/architecture.md`  | §1 table, driver cell `SaaS for business owners and managers`                                                                                                   | `Sell-ready multi-tenant product for business owners and managers (not sold, PD-001)` (keep the table aligned: run prettier)                                                                                                                                                                         |
| `docs/architecture.md`  | §6.3: `Vertex AI with the EU endpoint and its zero-data-retention setup before the first external customer.`                                                    | `An EU endpoint before any outside user's mail: ADR 0035 (proposed, E11b F111). No outside user is served (PD-001).`                                                                                                                                                                                 |
| `docs/architecture.md`  | §10: `- **Production for external customers (S6):** a hosted EU VPS with the same Compose files (availability, physical security, GDPR duties of a processor).` | `- **Production (E7-T5, F108):** the home VPS (PD-001). A hosted EU VPS with the same Compose files is the path if outside users come later (availability, physical security, GDPR duties of a processor).`                                                                                          |
| `docs/architecture.md`  | §11 table, the `S6 Pre-sale` row content                                                                                                                        | ``S6a customer core (F077) and S6b login (F082); the rest is Stage 2 E7 (F098, F099, F105–F108, F119; `docs/product/stage-2/`)``                                                                                                                                                                     |
| `docs/modules.md`       | §3.11 row ``                                                                                                                                                    | `billing`                                                                                                                                                                                                                                                                                            | Plans, payments, limits (S6) | ``  | ``  | `billing` | Dropped (PD-047): no payments; the plan state lives in `tenancy` | ``  |

- **Decisions:** D15. Do not touch §2 history rows of `product-brief.md` other than the two named, and no ADR.
- **Test:** none (docs).
- **Check:** step 3.
- **Done when:** step 3 holds.
- **Out of scope:** other roadmap rows (the S3 and S4 state lines are stage 09 and stage 10); `docs/product/stage-2/*`.

## Step 3 — Check the boundary

- **Goal:** prove that no stale boundary line is left.
- **Check (run each, paste the output in the final message):**
  1. `grep -nE "SaaS for sale|first external customer|sold as SaaS|for external customers \(S6\)" docs/*.md spec/vision.md` → no line.
  2. `grep -nE "external customer" docs/*.md spec/vision.md` → only the lines that also hold `Changed 2026-11-12` or `Changed 2026-11-13` (the brief's Q10 and Privacy rows, old history kept with the change note), and the history row of `docs/product-brief.md` §5 "Consequences" bullets (`EU data location (for customers: …)`). List each hit and why it stays.
  3. The epic exit grep: `grep -l "SaaS for sale\|first external customer" docs/*.md spec/vision.md` → no file.
  4. `wc -l spec/vision.md` ≤ 1000.
- **Done when:** checks 1, 3 and 4 hold; check 2 has only the listed kinds of hit.

## Review focus

The six vision edits are exactly the text above and nothing else in `spec/vision.md` changed; every table row of step 2 is applied; check 2 hits are only history with a change note.

## Done when

- Steps 1–3 hold.
- The Proof command of `plan.md` (stages 01, 03–10 form, `/tmp/f095-s01`, files: `spec/vision.md docs/product-brief.md docs/roadmap.md docs/architecture.md docs/modules.md`) prints `PROOF_OK`.
