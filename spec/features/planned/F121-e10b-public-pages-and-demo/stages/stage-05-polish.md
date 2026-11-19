# F121 stage 05 — Polish security and pricing, strict set

Part of [`../plan.md`](../plan.md). New user-facing Polish text: Opus review before the land. Decision 6 (epic). Needs stages 02, 03, 04.

Carry-over reads: `apps/docs/src/front-matter.ts` (`POLISH_SET`), `apps/docs/scripts/stale.ts` (strict rule), `apps/docs/src/polish.test.ts`, `pl/index.mdx` (stage 04) for tone and front matter, the panel Polish strings (`apps/web/src/i18n/pl*`) for the same terms.

## Step 1 — Pages

**Files.** New `apps/docs/src/content/docs/pl/security.mdx`, `pl/pricing.mdx`.

**Decisions.**
- Same sections, order and `##` count as the en page. Claim rows, sub-processor rows and cost rows come from the `pl` data through the components (`lang="pl"`), never retyped.
- Terms match the panel's Polish UI. Formal register as the other pl pages.
- Numbers: USD; decimal separator as the existing pl pages use (check one; follow it). The component formats, the page text does not.
- Stamp each page with `bun run docs:stale --stamp <file>`.

**Test.**
1. `polish.test.ts` (extend): each new pl page has `source`, a 16-hex `sourceHash`, the same `##` count and links as its source.
2. Browser check: `/pl/security/` shows the Polish text of the first claim; `/pl/pricing/` has 3 table rows; axe zero violations.

## Step 2 — Sets

**Files.** `apps/docs/src/front-matter.ts`, `apps/docs/scripts/stale.ts` and tests.

**Decisions.** `POLISH_SET` gains `security` and `pricing`. Strict set = source `index`, any `start*`, `security`, `pricing`.

**Test.**
3. `stale --strict` with a changed en `security` body and an old pl hash → exit 1, the page named.
4. Same for `pricing`; a changed en `faq` → exit 0 with a warning.

Mutation: drop `security` from the strict set → test 3 fails.

**Check.** `bun test apps/docs/src apps/docs/scripts`, `bun run docs:stale --strict`, `bun run docs:build`, `flock /tmp/email-assistant-shared-tests.lock bun run docs:test`.

**Done when.** Tests 1–4 pass; `docs:stale --strict` exits 0; Proof prints `PROOF_OK`.

**Out of scope.** Polish reference pages (English only).
