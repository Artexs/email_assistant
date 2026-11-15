# F110 stage 16 — Why-line gaps: confidence, rule hits, delegate reason

Part of [`../plan.md`](../plan.md). Flag `why_lines`. Polish text: review by `claude-opus-5-5`.

## Step 1 — Record which rule decided

- **Goal:** each new triage result says whether a sender rule shaped it, so the digest and Activity can name it (R15; E4 cross-check "Why and confidence").
- **Files:** `triage/service.ts` (where `applyHardRules` runs); `triage_results.fields` gains `rule: "blocklist" | "whitelist" | "vip" | null` (jsonb key, no migration; an old row reads null).
- **Decisions:** `blocklist` when the hard rule gave `spam`; `vip` when the sender is VIP; `whitelist` when whitelisted and not VIP; else null. No pattern text is stored or shown (the pattern can be an address).
- **Test:** integration (triage-job pattern): a blocklisted sender → `fields.rule = "blocklist"`; a VIP → `vip`; no rule → null.

## Step 2 — Digest and notice lines

- **Goal:** each digest item and the urgent notice show how sure the system was and which rule hit.
- **Files:** `packages/core/src/digest/digest.ts`, `notices.ts`, the digest and urgent views (optional new keys: `confidence: number | null`, `rule: ... | null`, `delegateTags: string[] | null`), texts en and pl.
- **Decisions:**
  - The `💬` line ends with ` · <n>%` (confidence × 100, rounded down to a multiple of 5) when `rule` is null, or ` · rule: VIP sender` / `whitelisted sender` / `blocked sender` when set. `blocklist` shows no percent (confidence 1 is not a model mark).
  - A `delegation` item's would-do line adds ` (fits: <tag>, <tag>)`: the competence tags of the chosen delegate that the org wrote (user config, not mail-derived; D15), at most 3, cut at 30 characters each.
  - The views are queued with the keys only when `why_lines` is on; a view without them renders as today (old rows in the outbox still render).
  - The digest stays ≤ 15 lines and ≤ 4096 characters (`DIGEST_MAX_LINES`): the suffix never adds a line.
- **Test** (`packages/core/src/digest/digest.test.ts`, `notices.test.ts`):
  1. confidence 0.87, no rule → ` · 85%`.
  2. confidence 0.70 → ` · 70%`; 0.999 → ` · 95%`.
  3. rule `vip` → ` · rule: VIP sender`, no percent.
  4. A view without the keys → today's text exactly (snapshot).
  5. Delegation with tags `["finance", "legal", "hr", "it"]` → ` (fits: finance, legal, hr)`.
  6. pl text for cases 1, 3 and 5.
  7. A 15-item digest with all suffixes ≤ 4096 characters.

## Step 3 — Activity

- **Goal:** the Activity row and its detail panel name the rule hit (the confidence shows there today).
- **Files:** `ActivityRow.tsx`, `ActivityPanel.tsx`, the activity route schema (`rule` key); page keys.
- **Test:** e2e (extend the Activity spec): a seeded VIP result shows "VIP sender" in the panel; `expectNoA11yViolations`.

## Done when

- Proof (`s16`; the web part only if Step 3 changed web files) prints `PROOF_OK`.

## Out of scope

"Why this folder" beyond the category (the folder follows the category). The weekly report.
