---
opened: 2026-11-13
---

# F106 · E7-T3 Account data (delete, export, DSR)

## Outcome

An owner can delete their organization and all its data from the Account card, with the password and the typed name, and then sees which mailbox passwords to change. The operator can export an organization's data as an encrypted file, and can find and erase the data of a person who is not a user (a sender) on the owner's instruction, with an audit row that holds no address and no re-import of the erased mail. This is row 12 of the Stage 2 ticket table (`docs/product/stage-2/05-execution-plan.md` §2.1) and the S6c part of the E7 epic.

## Scope

- One privileged database function deletes an organization; the route, the dialog and `org:delete` use it.
- `org:export`: an `age`-encrypted file of every table that the export registry names.
- `org:dsr --find | --erase` over one address registry, with tombstones that sync, rescan and backfill skip.
- Erase also blanks stored Telegram digests that listed the erased mail.
- Security-log kinds for export, refused delete and DSR; docs and runbook; the VPS smoke check.

## Out of scope

- A panel page for data-subject requests (PD-038), a grace period, a passphrase export.
- Changes in the user's mailbox (drafts and folders the assistant made stay, PD-039).
- The legal papers that describe these steps (E7-T4, F107).

## Acceptance

- The deletion test covers every table with `org_id` or `user_id` (from `information_schema`); a second organization stays whole.
- `DELETE /api/organization` needs the owner, the flag `org_delete`, the password and the typed name, and works for a suspended organization.
- The export decrypts and holds no password hash, credential, token or session.
- After an erase, a rescan or backfill does not store the erased mail again.
- Every check with its test: [plan.md](plan.md) § Done when (7 lines).

## Slices

Twelve stages, one worker job each; stage 12 is run by the coordinator. Stage 01 is the only migration; stage 05 is the only `bun.lock` change. Order and parallel lanes: [plan.md](plan.md) § How to run. No owner checkpoint.

## Sequenced

- Plan after: F105 (identity A; its tables `auth_two_factors` and `memberships.break_glass` are on `master` and the deletion test covers them) and F099 (the security-log registry, done).
- Build after: F082 and F098 (E7-T1), both in `spec/features/done/`.
- Gate: —. Advisory file overlap: F105 stage 11 (Account card) with stage 04, F105 stage 13 (security-log registry and texts) with stage 10; on a land conflict, merge `master` and prove again.

## Notes

Defaults for the owner: [questions.md](questions.md) (17 items, 11 important). Sources: `docs/product/stage-2/epics/E07-platform-and-trust.md`, `E07-discovery-notes.md` §4, §11; `tasks/planned/s6c-account-data.md` (history). F078 (expired `auth_verifications` cleanup) is done separately and not part of this ticket.
