# F121 stage 12 — Close-out: axe, docs, cold-read pack

Needs stage 05: the pl security and pricing pages. Needs stage 06: the reference pages (and whether the evidence page exists). Needs stage 07: the image-path check and the seed source (ADR text). Needs stage 11: `DemoVideo`, `DEMO_VIDEO_SHA256`, the fetch step (ADR text). Needs stage 10: the `demo:record` script (the release checklist names it). Playwright: lock rule until F136 lands.

Part of [`../plan.md`](../plan.md). Extra proof link: `flock /tmp/email-assistant-shared-tests.lock bun run docs:test > /tmp/f121-s12/site.log 2>&1` before `echo PROOF_OK`.

Carry-over reads: ADR 0030 § Built, `docs/code-patterns.md` § Docs site, `docs/capabilities/README.md`, `apps/docs/e2e/site.spec.ts` and `a11y.ts`, `E10-discovery-notes.md` §4.8, `apps/docs/src/publish-gate.ts`.

## Step 1 — Checks on all new pages

**Decisions.**
- Every F121 page (home, security, pricing, their pl twins, API and evidence reference) is in the browser check list with axe (WCAG 2.2 AA, zero violations) at desktop and phone width.
- A unit test: every id in `OWNER_REVIEW_PENDING` is an existing page id (en); an evidence page that stage 06 did not write is removed from the list.

**Test.**
1. The site spec visits the 8 (or 7 without the evidence page) new pages; axe zero violations.
2. `OWNER_REVIEW_PENDING` with `"nope"` → the unit test fails; with the real list → passes.
4. No built F121 page (en and pl) holds `gemini` (case-insensitive; P2).

## Step 2 — Docs

**Decisions.**
- `docs/release-checklist.md` (moved from stage 11): "When the demo flow changed: `bun run demo:record`; only a run that logs `demo_source demo` is a candidate (D10); the owner watches it, uploads it to the release `demo-video` and the coordinator commits its sha256 to `DEMO_VIDEO_SHA256` (G3)." The upload command (`gh release create demo-video …` or `gh release upload demo-video … --clobber`) goes to `deploy/README.md` § docs as an owner step.
- ADR 0030 § Built: one F121 paragraph: the publication hold (D1), the claim check (D2), the image-path check, the video path (release asset `demo-video`, pinned by `DEMO_VIDEO_SHA256`, fetched in the deploy), the OpenAPI file in `docs/api/`.
- `docs/code-patterns.md` § Docs site: a new public claim needs a ledger row and a proof path; `bun run api:spec` after a route change (the drift test says so); re-record the demo when the shown flow changes.
- `docs/capabilities/web-panel.md` rule 6: the public copy of the OpenAPI file and its drift test.
- `notes/2026-11-19-f121-close-out.md` (date of the stage): the owner gates G1–G3 with exact commands, the left-out claims of stage 02, the spike table of stage 09, the follow-up ticket that records from the C1 seed (D10).

## Step 3 — Cold-read pack for the coordinator (C2)

**Goal.** The coordinator can run the cold read without writing a prompt.

**Files.** New `apps/docs/cold-read.md` (not a page: outside `src/content`).

**Decisions.** The file holds: how to build the site (`bun run docs:build`, the output folder), the rule "read only the built HTML in `apps/docs/dist/`, not the repo", the ten buyer questions of notes §4.8, and for each the `publicClaims` id or page that holds the expected answer. Question 10 ("how do I see it work") expects the tutorial page while no video is published, and the video once G3 is done (review 1 N13). Questions whose fact sits only in "does not promise" (training, location) expect that section. The coordinator's C2 scout gets: "Follow `apps/docs/cold-read.md`. Answer each question from the built site only, quote the page. Then compare with the expected sources and list each mismatch."

**Test.**
3. A unit test: the file lists 10 questions, and every claim id it names exists in `publicClaims`.

**Check.** `bun test apps/docs/src`, `bun run docs:build`, the browser check under the lock.

**Done when.** Tests 1–4 pass; Proof prints `PROOF_OK`. Then the coordinator runs C2; stage 13 only if it finds something; then asks the owner for G1–G3 (defaults: hold).

**Out of scope.** Emptying `OWNER_REVIEW_PENDING` (G1); any deploy.
