# F121 stage 04 — Home and positioning page (en)

Part of [`../plan.md`](../plan.md). Decisions P1, P4. Needs stages 02 and 03 (it links them).

Carry-over reads: `docs/product/stage-2/03-product-frame.md` §2 (thesis and three jobs, PD-101 text), `E10-discovery-notes.md` §4.1, `apps/docs/src/content/docs/index.mdx` (the F112 landing it replaces), `packages/core/src/site.ts` (`PRODUCT_NAME`), `apps/docs/src/flagged-text.ts`.

## Step 1 — The page

**Goal.** A stranger learns in one screen what the product is, for whom, and what is different.

**Files.** `apps/docs/src/content/docs/index.mdx` (rewrite; Starlight `splash` template allowed); the browser check.

**Decisions.**
- Sections: one-sentence thesis; the three jobs (from `03` §2); who it is for (managers and executives with one mailbox and an assistant or none); what is different: any IMAP host with a password, Polish and English, runs on your own server, it chases delegated work, it never sends without your tap on the exact text; links: tutorial, security, pricing, FAQ, changelog.
- Every claim on the home page is also a row of `publicClaims` or a statement of an existing user page; the page links to it. No claim that the security page does not hold.
- Name: `PRODUCT_NAME` through a component or the title; no second hard-coded name.
- No video yet: a sentence "A two-minute demo video follows." is not allowed (it promises); leave the video place out. Stage 10 adds it.
- No flagged text; no competitor names; no feature that a default-off flag gates (for example the report page, approvals in the panel).
- Keep the two F112 lines on languages (which pages exist in Polish) in a short "About this site" section.

**Test.**
1. Browser check: `/` has an `h1` with `PRODUCT_NAME`, links to `security/`, `pricing/`, `start/`; axe zero violations.
2. Link check passes (`bun run docs:build`).
3. `flagged-text.test.ts` passes (no flagged string).

Mutation: link `/security/` as `/securty/` → the link check fails; restore.

## Step 2 — Landing text in the panel

**Goal.** The panel Help link (F112) still lands on a sensible page.

**Decisions.** No panel change. Check only that the Help link target is the docs root and that the root page still names the tutorial first for a signed-in user ("Start here" link above the fold).

**Test.**
4. Browser check: the first link in the main content is the tutorial.

**Check.** `bun run docs:build`, `flock /tmp/email-assistant-shared-tests.lock bun run docs:test`, `bun test apps/docs/src`.

**Done when.** Tests 1–4 pass; Proof prints `PROOF_OK`.

**Out of scope.** Polish home (stage 05); the video (stage 10); renaming the product (Q7).
