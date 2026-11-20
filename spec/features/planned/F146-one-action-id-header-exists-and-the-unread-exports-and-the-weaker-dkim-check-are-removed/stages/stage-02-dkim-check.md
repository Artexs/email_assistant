# F146 stage 02 — the weaker DKIM check goes

Needs: nothing (reads HEAD only). May run next to 01 and 03 (03 also edits `docs/capabilities/trust.md`, another paragraph).
Part of [`../plan.md`](../plan.md). Review: Opus, before the land (security: the one-click unsubscribe proof).

## Goal

`hasTrustedAlignedDkimPass` no longer exists. `hasCoveredDkimPass` is the one DKIM check that `@ea/core` exports for a decision. The parser cases that only the old function covered still run, now through `hasCoveredDkimPass`. Production behaviour does not change: `apps/server/src/modules/triage/newsletter-senders.ts` already calls `hasCoveredDkimPass` only.

## Step 1 — move the cases, then delete

- **Files.** `packages/core/src/triage/dkim-pass.ts` and `dkim-pass.test.ts`.
- **Decisions.** D6, D7.
- **Order.**
  1. Add a file-level test helper `alignedCovered(authResults, fromDomain)` = `hasCoveredDkimPass(authResults, TRUSTED, fromDomain, SIGNED)`. Do not name it `covered`: the `hasCoveredDkimPass` block already has a `covered` helper. `SIGNED` holds one signature per `header.d` domain that any case of the file uses. Each signature's `h` names `From`, `List-Unsubscribe` and `List-Unsubscribe-Post`. Build `SIGNED` from a fixed list of domains plus the domains made from the shared-suffix `suffixes` array; do not build it from the case strings. A case that passes a non-default trusted list (for example `[]`) or a `null` value calls `hasCoveredDkimPass` directly with the same arguments and the same `SIGNED`.
  1b. The lasting guard (D6, review 1 finding 1): `alignedCovered` (and each direct call) first checks that every `header.d=<domain>` in the input, also inside comments and quoted strings, is a `d` of `SIGNED`; if one is not, the test fails with `unsigned header.d <domain>: add it to SIGNED`. Without this a false case stays false for a missing signature, whatever the parser does.
  2. Add one temporary assertion: for every case, `covered(...)` equals `hasTrustedAlignedDkimPass(...)`. Run it; it must pass. If one case differs, stop and report it (the domain list is short, or the functions differ).
  3. Change every call of the old describe block to `covered(...)`, keep each expected value, and rename the block to say what it covers (the parser and the alignment of the trusted result). Delete the temporary assertion and the function `hasTrustedAlignedDkimPass`. Fix its comment pointer in `hasCoveredDkimPass` if it names the old function.
- **Test.**
  1. Every case of the old block keeps its old expected boolean through `covered(...)`. Count: the same number of case inputs as at HEAD (name both counts in the final message).
  2. The cases that already called `hasCoveredDkimPass` stay unchanged.
- **Break checks (final message).** Each must make at least one moved case fail; name it, then revert.
  - In `trustedAlignedPassDomains`, stop removing comments (or quoted strings) before the split.
  - In `alignedDomains`, set the registrable-domain floor to 1 (the shared-suffix floor goes): the `co.uk` case and the shared-suffix cases must fail.

## Step 2 — the export guard

- **Test** (in `dkim-pass.test.ts`).
  3. `Object.keys(await import("./dkim-pass")).sort()` equals the exact sorted export list of the file after step 1 (write the list out; read it at HEAD).
  4. `import * as core from "../index"`: `Object.hasOwn(core, "hasTrustedAlignedDkimPass")` is `false`, and `Object.hasOwn(core, "hasCoveredDkimPass")` is `true`.
- **Break check (final message).** Put back an `export function hasTrustedAlignedDkimPass` that calls `trustedAlignedPassDomains`: cases 3 and 4 fail. Revert.

## Step 3 — docs

`docs/capabilities/trust.md`: rule 21 names the parser through `hasCoveredDkimPass` (the RFC 8601 parsing and the shared hosting suffixes stay described); the function table row of `hasTrustedAlignedDkimPass` goes or names `hasCoveredDkimPass` (one row per function; no duplicate). `notes/` files are history: do not edit them.

## Done when

- `rg -w hasTrustedAlignedDkimPass apps packages scripts tools docs/capabilities` finds nothing.
- Plan § Done when items 4 and 5 hold.
- No production file outside `packages/core/src/triage/dkim-pass.ts` changed.
- The Proof of `plan.md` with `NN=02` prints `PROOF_OK`.

## Out of scope

- Any change to `hasCoveredDkimPass`, `trustedAlignedPassDomains`, `registrableDomain` or `dkimCoversOneClickHeaders` behaviour.
- The sender trust that reads `Authentication-Results` elsewhere.
- Other exports of the file.
