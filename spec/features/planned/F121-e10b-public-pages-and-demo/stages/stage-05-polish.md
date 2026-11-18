# F121 stage 05 — Polish twins and strict set

Part of [`../plan.md`](../plan.md). New user-facing Polish text: review by Opus before the land. Decisions P1, decision 6. Needs stages 02, 03, 04.

Carry-over reads: `apps/docs/src/front-matter.ts` (`POLISH_SET`), `apps/docs/scripts/stale.ts` (strict rule), `apps/docs/src/polish.test.ts`, an existing pl page (`pl/start/index.mdx`) for tone and the `source`/`sourceHash` front matter, the panel Polish strings (`apps/web/src/i18n/pl*`) for the same terms.

## Step 1 — Pages

**Goal.** Home, security and pricing read the same in Polish.

**Files.** New `apps/docs/src/content/docs/pl/index.mdx` (rewrite of the F112 pl landing), `pl/security.mdx`, `pl/pricing.mdx`.

**Decisions.**
- Same sections, same order, same `##` count as the en page. Claim rows and sub-processor rows come from the `pl` fields of the data (components with `lang="pl"`), never retyped.
- Terms match the panel's Polish UI words (for example the names of the modes and the Undo button). Formal register as the existing pl pages.
- Numbers keep USD and the dot or comma rule of the existing pl pages (check one existing pl page with a number; follow it).
- Stamp each page with `bun run docs:stale --stamp <file>`.

**Test.**
1. `polish.test.ts` (extend): each pl page of the set has `source` and a 16-hex `sourceHash`, and the same `##` count as its source.
2. Browser check: `/pl/security/` shows the Polish claim text of the first row; `/pl/pricing/` shows 3 table rows.

## Step 2 — Sets

**Goal.** The release cannot ship a stale public page.

**Files.** `apps/docs/src/front-matter.ts`, `apps/docs/scripts/stale.ts` and tests.

**Decisions.** `POLISH_SET` gains `security` and `pricing`. The strict set = source `index`, any `start*`, `security`, `pricing`.

**Test.**
3. `stale --strict` with a changed en `security` body and an old pl hash → exit 1, the page named.
4. Same for `pricing`; a changed en `faq` → exit 0 with a warning (not in the strict set).

Mutation: drop `security` from the strict set → test 3 fails.

**Check.** `bun test apps/docs/src apps/docs/scripts`, `bun run docs:stale --strict`, `bun run docs:build`, `flock /tmp/email-assistant-shared-tests.lock bun run docs:test`.

**Done when.** Tests 1–4 pass; `docs:stale --strict` exits 0; Proof prints `PROOF_OK`.

**Out of scope.** Polish for reference pages (English only, decision 6).
