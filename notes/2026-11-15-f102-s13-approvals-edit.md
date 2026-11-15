# F102 stage 13: approvals edit (web)

What a later agent needs to know.

## Seams

- Form rules: `apps/web/src/lib/approvals-edit.ts` (limits come from `@ea/core/web`: `EDIT_SUBJECT_MAX`, `EDIT_BODY_MAX`, `cleanUserText`, the same code as the service). Answer map: `editOutcome`.
- Dialog: `apps/web/src/components/approvals/ApprovalEditDialog.tsx`. "Discard your changes?" replaces the form inside the same dialog (no nested dialog); the dialog name changes to the question.
- Page: `apps/web/src/islands/ApprovalsPage.tsx`. After an answer (approve, reject, save, changed, closed) the focus goes to the status line (`role="status"`, `tabIndex=-1`) in an effect after the commit. The Radix modal dialog has no trigger: the page returns the focus to the Edit button itself (`onReturnFocus`).
- `closedTextKey` now has one text per edit code (`payload_gone`, `draft_gone`, `delegation_closed`).

## Decisions and deviations

- A new version has no Drafts copy until the committer runs (up to 15 s in e2e): `draftReady` is false and Approve is off. The detail did not reload by itself (stage 12: `pollMs` 0). The page now polls the detail every 5 s while a waiting send is not ready.
- The subject of a delegation starts with `Fwd: ` (the view subject). The edit form shows it as is.
- Seed: the held delegate is now "Piotr Lis" (`piotr@example.com`), so Piotr Lis is the second delegate that the stage names (the address is unique per organization, so no second Piotr). The seed has two more sends per approvals organization: `edit` (T3, waiting, Anna) and `reminder` (no Edit button). `E2E_APPROVALS_COUNT` (4) and `E2E_APPROVALS_WAITING` (3) hold the list size and the badge at the start.
- Spec order matters (serial): reads, reject of the held send, reminder, conflict (T4), delegate (T5), dialog under axe (T8), keyboard path (T7, desktop; approves the newest version of the first send), edit-and-approve of the `edit` send (T3).
- Axe with the reason select OPEN reports `aria-hidden-focus` for the page behind (Radix hides the rest of the page and leaves its buttons focusable). The spec checks the open list only (`include: '[role="listbox"]'`) and the page with the select shown (closed) and after the answer.
- Not covered by a test: the focus move after "Skip" of the reject reason (the line `focusStatus()` in `onReason`).
