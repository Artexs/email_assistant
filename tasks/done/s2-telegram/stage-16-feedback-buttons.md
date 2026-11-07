# s2-telegram — Stage 16

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 16 — Feedback buttons [risky]

- [x] **16.1 ✅ / ✏️ taps write `triage_feedback` after the tenant check**
  - Goal: a tap writes one `triage_feedback` row through `triage.recordFeedback()` (architecture §4.4) for a mail of the member's own organization only (P5); a repeat tap with the same answer writes nothing.
  - Files: create `apps/server/src/modules/channels/callbacks.ts`, `apps/server/test/integration/channels-callbacks.test.ts`; change `apps/server/src/modules/triage/feedback.ts`, `triage/repo.ts`, `triage/index.ts`, `apps/server/test/integration/triage-feedback.test.ts`, `apps/server/src/modules/channels/index.ts`.
  - Interfaces:
    - `triage/repo.ts`: `latestFeedback(db, ctx, emailId: string): Promise<{ id: string; verdict: FeedbackVerdict; true_category: Category | null } | undefined>` (newest by `created_at`, then `id`); `getLabelTarget(db, ctx, emailId: string): Promise<{ category: Category; subject: string | null } | undefined>` (the latest triage result of the e-mail and its subject; both tables filtered by `org_id`).
    - `triage/feedback.ts`: `RecordFeedbackInput` gets `skipIfSame?: boolean`; `recordFeedback(…): Promise<{ id: string; verdict: FeedbackVerdict; saved: boolean }>`.
    - `channels/callbacks.ts`: `interface CallbackDeps { db: Db | Transaction<DB>; now(): Date }`; `handleCallback(deps: CallbackDeps, link: LinkedChat, data: string): Promise<CallbackResult>`; `pickerMessage(emailId: string, subject: string | null, current: Category): OutMessage`.
  - Decisions:
    - `recordFeedback` with `skipIfSame: true`: after the verdict is known, read `latestFeedback`; same `verdict` and the same `true_category` (`trueCategory ?? null`) → return `{ id: <that row>, verdict, saved: false }` without an insert. Without the flag the behaviour does not change (`triage:label` writes every label), and `saved` is `true`.
    - `handleCallback` (`ctx = { orgId: link.orgId, userId: link.userId }`; `label(c)` = `categoryLabels[c].name`):
      - `parseCallback(data)` null → `{ answer: "This button is not valid any more." }`.
      - Every kind except `cancel` first runs `getLabelTarget(ctx, emailId)`; undefined → `{ answer: "This mail is not in your account." }`. The same answer for an unknown id and for another organization's id (no leak).
      - `right` → `recordFeedback(db, ctx, { emailId, trueCategory: category, source: "telegram", userId: link.userId, skipIfSame: true })`; saved → `` `✅ Saved: ${label(category)} is right.` ``; not saved → `Already saved.`
      - `edit` → `{ answer: "", send: pickerMessage(emailId, target.subject, target.category) }`.
      - `pick` → `recordFeedback(… trueCategory: category, skipIfSame: true)`; answer `Saved.` or `Already saved.`; ``edit: { text: `✏️ Saved: ${label(category)} (AI said ${label(target.category)}).`, buttons: [] }``.
      - `cancel` → `{ answer: "", edit: { text: "✏️ Cancelled.", buttons: [] } }` (no DB access: it only edits the picker in the member's own chat).
      - Other errors are not caught here: the router answers `ERROR_TEXT` and logs the label (stage 14).
    - `pickerMessage`: text `✏️ Pick the right category` / `<cleanSubject(subject)>` / `` `AI said: ${categoryTag(current)}` ``; three button rows `[🔴 Urgent, ✉️ Reply]`, `[ℹ️ Info, 🔔 Notification]`, `[🚫 Spam, ✖️ Cancel]` with data `fc:<code>:<emailId>` and `fx:<emailId>` (step 3.2).
    - A tap on an `unsure` line can only come from ✏️ (the digest shows no ✅ there); a forged `fr:` on an `unsure` mail writes a normal label with that true category (verdict `wrong`): accepted.
    - The verdict comes from `recordFeedback` (true category = the latest result category → `right`, else `wrong`). The eval reads the latest row per mail (`listLabeledResults`), so a changed answer wins.
  - Test (`channels-callbacks.test.ts`, `withRollback`; org A with an `info` mail (subject `MARKER-SUBJECT`) and an `unsure` mail from `insertTriaged`; `link` = A's owner; org B with an `info` mail):
    1. `fr:i:<info id>` → one `triage_feedback` row: verdict `right`, `true_category` `info`, source `telegram`, `user_id` = the owner; answer `✅ Saved: Info is right.`
    2. The same tap again → still one row; answer `Already saved.`
    3. `fe:<info id>` → `send` = the picker: 3 rows, 6 buttons, data `fc:u:…`, `fc:r:…`, `fc:i:…`, `fc:n:…`, `fc:s:…`, `fx:…`, each ≤ 64 bytes; the text has `MARKER-SUBJECT` and `AI said: ℹ️ Info`; answer `""`.
    4. `fc:s:<info id>` → a new row: verdict `wrong`, `true_category` `spam`; `edit.text` = `✏️ Saved: Spam (AI said Info).`; answer `Saved.`
    5. Then `fc:s:<info id>` again → no new row, `Already saved.`; then `fc:i:<info id>` → a new row with verdict `right`; `listLabeledResults` gives `right` / `info` for this mail (the latest wins).
    6. `fc:n:<unsure id>` → a row with verdict `wrong`, `true_category` `notification`.
    7. B's mail id, and a random uuid → `This mail is not in your account.` (the same text) and no row.
    8. `"junk"` → `This button is not valid any more.`
    9. `fx:<info id>` → `edit` `✏️ Cancelled.` with no buttons.
    10. `triage-feedback.test.ts`: without `skipIfSame` a repeat label writes a second row (`saved` true both times); with `skipIfSame` the repeat returns the first row's id with `saved` false.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: the Undo button (S3), approval buttons (S4).
