# F142 stage 01 — one name, one SQL home, send limit and sender rules

Part of [`../plan.md`](../plan.md).

Needs: nothing. Base: `packages/core/src/contacts/address.ts` (`normalizeSenderAddress`) and `apps/server/src/modules/contacts/address-sql.ts` (`normalizedAddress`).
Writes for later stages: `normalizeAddress`, `storedAddressForm`, `addressLowerForms` (`@ea/core`); `normalizedAddress` (`apps/server/src/platform/db`).
Parallel: runs first; 02, 03 and 04 need it.

## Step 1 — names in core (D1, D2, D5, D7)

- **Files:** `packages/core/src/contacts/address.ts` and every caller of the old name (grep).
- **Interfaces:**
  - `normalizeAddress(address: string): string` — the old `normalizeSenderAddress`, same output. Printable ASCII (`/^[ -~]*$/`) returns `trim().toLowerCase()`; else the full fold. The old name is deleted, no alias; comments name the new one.
  - `storedAddressForm(address: string): string` — `trim().toLowerCase()`, no fold. The comment says: the form that is stored, shown and sent; the rule form is a compare key only (plan D5).
  - `addressLowerForms(address: string): string[]` — input in rule form; output the input first, then each variant with `ς` in place of a word-final `σ` (a `σ` followed by a character that is not a letter, `\p{L}`, or by the end), over every subset of the first four such positions, no duplicates.
- **Test** (`packages/core/src/contacts/address.test.ts`):
  - 01-T2 pin: for every code point 0x20–0x7e and for `" A.B@EXAMPLE.COM "`, `normalizeAddress` equals `trim().toLowerCase()`.
  - 01-T3 pin: `ΝΊΚΟΣ@example.gr`, `νίκος@example.gr` and `νίκοσ@example.gr` all give `νίκοσ@example.gr`; `İlker@Example.com` gives `ilker@example.com`.
  - 01-T4 guard: `addressLowerForms("a@example.com")` is `["a@example.com"]`; `addressLowerForms("σοσ.σσ@example.gr")` holds `σος.σς@example.gr` and does not hold `ςος.σσ@example.gr` (a `σ` before a letter); six word-final `σ` give 16 entries; `normalizeAddress` of each entry equals the input.
  - 01-T7 pin: `storedAddressForm(" ΝΊΚΟΣ@Example.gr ")` is `νίκος@example.gr` (keeps `ς`).

## Step 2 — SQL form in platform (D3)

- **Files:** `git mv apps/server/src/modules/contacts/address-sql.ts apps/server/src/platform/db/address-sql.ts`; export `normalizedAddress`, `divergentCodePoints`, `DivergentCodePoint` from `platform/db/index.ts`; drop the re-export in `contacts/index.ts`; fix the importers (contacts, privacy, `apps/server/test/integration/`). The moved file imports the schema types locally (the platform zone of `eslint.config.js` bans module imports).
- **Decisions:** one `git mv`, body unchanged except the name `normalizeAddress`.
- **Check:** `bun run lint`; `bun run graph:modules` if lint or the graph test reports a changed edge.
- **Done when:** lint and typecheck pass; the moved tests pass.

## Step 3 — send limit and sender rules (D4, D5, D6)

- **Files:** `packages/core/src/send-limits.ts` (the private `normalizeAddress` goes; import the core one). `packages/core/src/triage/rules.ts`: `normalizeSenderPattern` goes (callers: web rule schema, rules CLI, config service, config repository write) and each pattern write uses `storedAddressForm`; the match helper and the no-reply check fold by `normalizeAddress`. The config service `addSenderRule`: before the insert, `exists` when a rule of the same mailbox (or both organization-wide) and kind has `normalizedAddress(pattern)` equal to `normalizeAddress` of the new pattern.
- **Test:**
  - 01-T1 guard (`send-limits.test.ts`): `recipientDay: 5`, now `2026-11-03T12:00:00Z`; four sends in the last hour to `νίκος@example.gr`, one to `ΝΊΚΟΣ@example.gr`; a new send to `νίκοσ@example.gr` → `held` with `recipient_day`. The base code gives `ok`.
  - 01-T5 pin (`triage/rules.test.ts`): a whitelist pattern `ΝΊΚΟΣ@example.gr` written through the web schema is `νίκος@example.gr` and matches sender `νίκοσ@example.gr`.
  - 01-T6 guard (integration, config rule service): an organization-wide whitelist `İlker@Example.com` exists; add `ilker@example.com` (whitelist, organization-wide) → `exists`. A blocklist of the same address → `added` (other kind). Without the pre-check the first add succeeds.
- **Sweep:** grep `toLowerCase` in `send-limits.ts` and `triage/rules.ts`; an address fold moves to the rule; a non-address fold gets `// not an address: <reason>` (plan D9).
- **Done when:** the tests pass; `rg -n "normalizeSenderAddress|normalizeSenderPattern" apps packages tools` finds nothing.

## Step 4 — pages

`docs/capabilities/drafts-and-send.md` (send limit) and `triage.md` (sender rules): if a line states how addresses compare, it names the one rule; `triage.md` states the duplicate refusal.

## Out of scope

Delegation, loops, the scan test, folds outside the named files.

## Done when

Steps 1–4 done, then the Proof of `plan.md` with `NN=01` prints `PROOF_OK`.
