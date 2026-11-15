# F110 stage 15 — Optional panel review "Check 10 decisions"

Part of [`../plan.md`](../plan.md). Web stage. Flag `panel_review`.

## Step 1 — API

- **Goal:** the panel twin of Telegram `/review`: a random sample of 10 unlabelled real decisions, labelled with the source `review` (P2, Q11).
- **Files:** routes `GET /api/review/sample?mailboxId=<uuid>` (any member) and `POST /api/review/label` (any member, as the Telegram buttons), with `apiDoc`; schemas in `packages/core/src/web/review.ts`. Reuse `listReviewSample` (`triage/review-repo.ts`) and `recordFeedback` with `source: "review"`, `skipIfSame`.
- **Decisions:**
  - The sample rules are those of `/review` (`docs/capabilities/digest-and-notices.md` rule 9): real mail of 30 days, no feedback row, no test mail, random order. The seed is the user id and the request time, so each load gives a new sample.
  - An item shows: category, confidence, the AI summary or reason, sender name, subject, date (the panel may show these; Telegram `/review` shows the summary only).
  - The label body: `{ emailId, verdict: "right" } | { emailId, category }` (as `vr`/`vc`; `delegation` allowed when the org has delegates). A foreign email id → 404. The same answer twice → `{ saved: false }`.
  - The label never unlocks anything (P1): it feeds the tripwire (stage 09) and the real-label block only.
  - Flag `panel_review` off → both routes 404.
- **Test** (`apps/server/test/integration/web-review.test.ts`):
  1. 12 unlabelled real mails and 1 labelled → the sample has 10, none labelled, no test mail.
  2. A label `right` → one feedback row with source `review`; the same again → `saved: false`.
  3. A foreign email id → 404; flag off → 404.

## Step 2 — Page part

- **Goal:** a panel view of the sample, reached only from the report page's optional link.
- **Files:** a section on the report page or its own page `review.astro` (pick the one that keeps the nav unchanged; name it in the final message); page keys en and pl; turn on the stage 14 link.
- **Decisions:** each item has `✅ Right` and a category select; after 10 answers or "Done", a thank-you line and a link back. Never shown as a required step (no onboarding item, no badge).
- **Test:** e2e: open from the report, label 2 items, read back 2 `review` rows; `expectNoA11yViolations`; keyboard reaches each button.

## Done when

- Proof (`s15`, with the web part) prints `PROOF_OK`.

## Out of scope

Telegram `/review` (E2a). Any change to `listReviewSample`.
