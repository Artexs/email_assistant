# F121 stage 04 — Home and positioning page (en and pl)

Needs stage 02: `/security/` with its `#claim-<id>` anchors and `publicClaims` ids. Needs stage 03: `/pricing/` (`pricing.mdx`). Needs stage 01: `OWNER_REVIEW_PENDING` holding `index`.

Part of [`../plan.md`](../plan.md). Decisions P1, P4. New user-facing Polish text: Opus review before the land.

Carry-over reads: `docs/product/stage-2/03-product-frame.md` §2 (thesis, three jobs, PD-101 text), `E10-discovery-notes.md` §4.1, `apps/docs/src/content/docs/index.mdx` and `pl/index.mdx` (the F112 landing), `apps/docs/src/polish.test.ts` (T4: same `##` count and same links in en and pl), `apps/docs/scripts/stale.ts`, `packages/core/src/site.ts` (`PRODUCT_NAME`), `apps/docs/src/flagged-text.ts`.

`index` is in `POLISH_SET` and in the strict stale set. An English edit without the Polish twin breaks `polish.test.ts` T4 and `docs:stale --strict` (review 1 B2). So this stage changes both pages and stamps the Polish one.

## Step 1 — The English page

**Files.** `apps/docs/src/content/docs/index.mdx` (rewrite; Starlight `splash` template allowed).

**Decisions.**
- Sections: one-sentence thesis; the three jobs (`03` §2); who it is for (managers and executives, with or without an assistant); "What is different" (any IMAP host with a password, Polish and English, runs on your own server, it chases delegated work, it never sends without your tap on the exact text); links: tutorial, security, pricing, FAQ, changelog; a short "About this site" with the F112 language lines.
- Each "What is different" bullet links to its proof: a claim anchor `security/#claim-<id>` or an existing user page. A bullet with no link is not allowed (review 1 N12).
- Name through `PRODUCT_NAME`; no second hard-coded name.
- No video place and no promise of one (stage 11 adds it). No flagged text, no feature that a default-off flag gates, no competitor names.
- The first link of the main content is the tutorial ("Start here"), for a user who comes from the panel Help link.

## Step 2 — The Polish page

**Files.** `apps/docs/src/content/docs/pl/index.mdx`.

**Decisions.** Same sections, same `##` count, same links in the same order (relative, so `security/` resolves under `/pl/`; Starlight's fallback serves the English security and pricing pages there until stage 05). Terms as in the panel's Polish UI. Stamp with `bun run docs:stale --stamp`.

**Test.**
1. Browser check: `/` has an `h1` with `PRODUCT_NAME`, links to `security/`, `pricing/`, `start/`; the first main link is the tutorial; axe zero violations; same for `/pl/`.
2. Unit: every list item under "What is different" in the built en and pl home HTML holds a link, and each `#claim-<id>` target is an id of `publicClaims`.
3. `polish.test.ts` passes (T4: same `##` count and links); `docs:stale --strict` exits 0.
4. `flagged-text.test.ts` passes.

Mutation: remove the link from one bullet → test 2 fails; link `/securty/` → the link check fails.

**Check.** `bun test apps/docs/src`, `bun run docs:stale --strict`, `bun run docs:build`, `flock /tmp/email-assistant-shared-tests.lock bun run docs:test`.

**Done when.** Tests 1–4 pass; Proof prints `PROOF_OK`.

## Step 3 — Pricing links to security

Add one line with a link to `/security/` on the English pricing page (stage 03 left it out so it could land before stage 02). Stage 05 writes the Polish pricing page with the same links.

**Out of scope.** Polish security and pricing (stage 05); the video (stage 11); renaming the product (Q7).
