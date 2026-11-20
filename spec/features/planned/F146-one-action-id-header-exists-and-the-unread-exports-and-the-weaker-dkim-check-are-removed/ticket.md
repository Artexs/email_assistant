---
opened: 2026-11-19
---

# F146 · One ACTION_ID_HEADER exists and the unread exports and the weaker DKIM check are removed

## Outcome

One ACTION_ID_HEADER exists and the unread exports and the weaker DKIM check are removed. Every sync finds the system's own mail by the header `X-EA-Action-Id`; ten production places spell it by hand today, so one typo turns own drafts into foreign mail. After this ticket one constant holds the name and a scan test keeps it so. The weaker DKIM check that one-click unsubscribe replaced, and five exports that no code reads, are gone.

## Scope

- `ACTION_ID_HEADER` and its lower-case form in `packages/core/src/outgoing/`; every production writer and reader of the header uses them.
- A scan test over the production source fails on a hand-spelled header name.
- `hasTrustedAlignedDkimPass` stops being an export; its parser tests run through `hasCoveredDkimPass`.
- Delete `renderDigest`, `routeOfKind`, `mailReportKinds`, `isLogFieldName`, `EMPTY_URGENCY_DRAFT` and `REPORT_MAIL_ID_HEADER`; their tests move to the production twin.

## Out of scope

- Tests and test tools: they keep the literal header name as an independent check of the wire format.
- `tools/mail-oauth-spike/` (a spike outside the product, no `@ea/core` dependency).
- `expiredFlags`: it stays; the unit test "no registry flag is past its remove-by date" already calls it in CI (plan D9).
- A general unused-export checker (plan D10).

## Acceptance

- `bun test apps/server/src/action-id-header-scan.test.ts` passes, and fails when `"x-ea-action-id"` goes back into `mail/imap/mapper.ts`.
- The own-mail integration tests (`mail-sync`, `mail-backfill`, `mail-sent-sync`) pass unchanged.
- `import * as core from "@ea/core"` has no `hasTrustedAlignedDkimPass` (unit test).
- Every case of the old `hasTrustedAlignedDkimPass` describe block keeps its expected value through `hasCoveredDkimPass`.
- The five dead exports and `REPORT_MAIL_ID_HEADER` do not exist (`bun run typecheck`; plan § Done when, 6 items).

## Slices

Three stages, all three may run in parallel. No migration, no `bun.lock` change. Stage 01 is `[risky]` (sync own-mail check). Detail: `plan.md` § How to run.

## Sequenced

Plan after: none.
Build after: none. Gate: none.

## Notes

Source: `spec/quality/2026-11-20-pass-2.md` findings 6 and 7. Default decisions: `questions.md`.
