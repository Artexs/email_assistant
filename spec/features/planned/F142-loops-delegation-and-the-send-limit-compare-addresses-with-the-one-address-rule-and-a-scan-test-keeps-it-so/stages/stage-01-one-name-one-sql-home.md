# F142 stage 01 — one name, one SQL home, send limit and sender patterns

Part of [`../plan.md`](../plan.md).

Needs: nothing. Base: `packages/core/src/contacts/address.ts` (`normalizeSenderAddress`) and `apps/server/src/modules/contacts/address-sql.ts` (`normalizedAddress`) at master.
Writes for later stages: `normalizeAddress` and `addressLowerForms` (`@ea/core`), `normalizedAddress` (`apps/server/src/platform/db`).
Parallel: runs first; 02, 03 and 04 need it.

## Step 1 — one name in core (D1, D2)

- **Goal:** the rule has one export.
- **Files:** `packages/core/src/contacts/address.ts` and every caller (grep).
- **Interfaces:** `export function normalizeAddress(address: string): string`. Same output as the old `normalizeSenderAddress`. Inside: printable ASCII (`/^[ -~]*$/`) returns `trim().toLowerCase()`; else the full fold. `normalizeSenderAddress` is deleted, no alias. Comments that name the old function name the new one.
- **Also:** `export function addressLowerForms(address: string): string[]` (D7). Input: a string already in rule form. Output: the input first, then each variant with `ς` in place of `σ`, over every subset of the first four `σ` positions, no duplicates (at most 16). A comment says why: the database `lower()` keeps a `ς` that the address holds, the rule folds it.
- **Test** (`packages/core/src/contacts/address.test.ts`):
  - 01-T2: for every code point 0x20–0x7e, and for `" A.B@EXAMPLE.COM "`, `normalizeAddress` equals `trim().toLowerCase()`. A broken fast path (for example without `trim`) fails this.
  - 01-T3: `normalizeAddress("ΝΊΚΟΣ@example.gr")` and `normalizeAddress("νίκος@example.gr")` both give `νίκοσ@example.gr`; `normalizeAddress("İlker@Example.com")` gives `ilker@example.com`.
  - 01-T4: `addressLowerForms("a@example.com")` is `["a@example.com"]`; `addressLowerForms("σσ@example.gr")` has 4 entries, `ςς@example.gr` among them; an input with 6 `σ` gives 16 entries; `normalizeAddress` of each entry equals the input.
- **Done when:** typecheck passes; 01-T2 to 01-T4 pass.

## Step 2 — SQL form in platform (D3)

- **Goal:** every server module can use the SQL form.
- **Files:** `git mv apps/server/src/modules/contacts/address-sql.ts apps/server/src/platform/db/address-sql.ts`; export `normalizedAddress`, `divergentCodePoints` and `DivergentCodePoint` from `platform/db/index.ts`; remove the re-export from `contacts/index.ts`; fix the importers (contacts, privacy, tests in `apps/server/test/integration/`).
- **Decisions:** one `git mv`, no content split, so history follows. Body unchanged except the imported name `normalizeAddress`.
- **Check:** `bun run lint` (layer rules); `bun run graph:modules` if lint or the graph test reports a changed module edge.
- **Done when:** lint and typecheck pass; the moved tests pass in `test:int:ci`.

## Step 3 — send limit and sender patterns (D1, D4)

- **Goal:** the per-recipient send limit and sender rules count one address once.
- **Files:** `packages/core/src/send-limits.ts` (the private `normalizeAddress` goes; import the core one); `packages/core/src/triage/rules.ts` (`normalizeSenderPattern` and the private `normalizeForMatch` fast path go; match uses `normalizeAddress`); its callers: the web rule schema, the rules CLI, the config service and the config repository write (grep `normalizeSenderPattern` and the repository's own `trim().toLowerCase()` of a pattern).
- **Decisions:** D4: stored patterns stay; match already folds both sides.
- **Test:**
  - 01-T1 (`send-limits.test.ts`): `recipientDay: 5`, five recent sends in the last hour to `νίκος@example.gr`, one to ` ΝΊΚΟΣ@example.gr `; a new send to `νίκοσ@example.gr` is `held` with `recipient_day`. Before this step it is `ok` (the old fold keeps `ς`); see it fail with the old private function.
  - 01-T5 (`triage/rules.test.ts`): a whitelist pattern written as `ΝΊΚΟΣ@example.gr` through the web schema is stored as `νίκοσ@example.gr` and matches sender `νίκος@example.gr`.
  - 01-T6: the web schema turns `" A@Example.COM "` into `a@example.com` (no change for ASCII).
- **Done when:** 01-T1, 01-T5, 01-T6 pass; `rg -n "normalizeSenderAddress|normalizeSenderPattern" apps packages tools` finds nothing.

## Step 4 — pages

`docs/capabilities/drafts-and-send.md` (send limit) and `triage.md` (sender rules): if a line states how addresses compare, it names the one rule. Else no edit.

## Out of scope

Delegation, loops, the scan test. No other private fold outside the named files.

## Done when

Steps 1–4 done, then the Proof of `plan.md` with `NN=01` prints `PROOF_OK`.
