# F102 stage 13 — Approvals edit

Part of [`../plan.md`](../plan.md). Read P2, P3, D2, D3, Q2, Q9, Q11 and [`../commands.md`](../commands.md). Needs stage 12 landed. New Polish text: the review uses `claude-opus-5-5`.

Two steps in `apps/web`.

## Step 1 — The edit dialog

- **Goal:** an owner changes the subject, the body or the delegate of a waiting draft, and then approves the new version.
- **Files:** the approvals components and API helper of stage 12, a new edit dialog component (Radix `Dialog`, as the existing dialogs), `en.ts`, `pl.ts`, unit tests.
- **Decisions:**
  - An Edit button for an owner on a `waiting` item of kind `delegation` or `clarification`. A reminder shows no Edit button (Q2); a `held` item neither.
  - The dialog: Subject (one line), Body (a text area, the full body that the detail shows, prefilled), and for kind `delegation` a Delegate select (the detail's `delegates`, the current one first). The quote shows below, read only, with "The quoted mail is added below your text."
  - Limits in the form (Q9): subject 1–200, body 1–3000 characters; a counter under the body; Save is disabled outside the limits or with no change. The server check is the real one (stage 11).
  - Save sends `POST /api/approvals/<id>/edit` with the id that the dialog opened (D2). Answers: 200 → close, select the new id (`replace` the URL), show "Saved as version {n}. Approve it to send." (Q11: the new version is a new request); 409 `changed` → keep the typed text in the dialog, show "Someone changed this draft. Copy your text, then open the new version." with a button that loads `currentId`; 409 `closed` → close and reload; 400 `unchanged` → "Nothing changed."; 400 `delegate_inactive` → "This delegate is no longer active."; 400 `validation` → the field error.
  - The text "Edit here, not in your mail client." stays visible in the dialog.
  - Closing the dialog with typed changes asks "Discard your changes?" (no loss by a stray click).
- **Test** (unit):
  - T1: the form state helper: Save disabled for subject `""`, for a body of 3001 characters, and when subject, body and delegate equal the start values; enabled after one change.
  - T2: the answer map gives the texts above for 200, 409 `changed`, 409 `closed`, 400 `unchanged`, 400 `delegate_inactive`.
- **Done when:** T1, T2 pass; the typecheck passes.

## Step 2 — e2e and the keyboard path

- **Goal:** the edit works end to end, and the approvals page works with the keyboard only (P3).
- **Files:** `apps/web/e2e/tests/approvals.spec.ts`, the seed of stage 12 (a second delegate, Piotr Lis `piotr@example.com`).
- **Test** (e2e, `desktop` and `mobile` unless named):
  - T3: edit the seed send: subject `Budget 2027`, body `Hello Anna, please send the report.` → "Saved as version 2"; the detail shows "Version 2" and the new subject; Approve → "Approved, sending."
  - T4: a second browser context opens the old id and saves an edit → the "Someone changed this draft" text, and the button opens version 2.
  - T5: change the delegate to Piotr Lis with no text change → the detail shows `Piotr Lis <piotr@example.com>`.
  - T6: a reminder item has no Edit button.
  - T7 (`desktop`, keyboard only, no mouse call): from the page start, Tab reaches the first item; Enter opens its detail; Tab reaches Edit; Enter opens the dialog with focus in Subject; typing changes the subject; Tab reaches Save; Enter saves; Escape on a dialog with changes asks to discard; Tab reaches Approve; Enter approves. Each step checks `document.activeElement` by role and name.
  - T8: `expectNoA11yViolations` with the edit dialog open, both projects.
- **Done when:** T3–T8 pass; the full e2e suite passes.

## Done when (stage)

- Steps 1 and 2 hold. The web Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s13`).
