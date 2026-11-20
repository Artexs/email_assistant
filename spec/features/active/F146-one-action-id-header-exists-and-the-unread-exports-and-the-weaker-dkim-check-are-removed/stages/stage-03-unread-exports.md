# F146 stage 03 — unread exports go

Needs: nothing (reads HEAD only). May run next to 01 and 02 (02 also edits `docs/capabilities/trust.md`, another paragraph).
Part of [`../plan.md`](../plan.md). No review; lands on the proof.

## Goal

Five exports that no production code reads are gone; their test cases run through the function production calls. No behaviour change.

## Step 1 — `renderDigest` and `routeOfKind` (core)

- **Files.** `packages/core/src/digest/digest.ts` and `digest.test.ts`; `packages/core/src/loops/brief.test.ts`; `packages/core/src/notices/routes.ts` and `routes.test.ts`.
- **Decisions.** D8.
- **`renderDigest`.** Delete it. In `digest.test.ts`, the `render` helper and the inline calls use `renderDigestWithBrief(input, texts).message`; every expected value stays. The two describe titles that name `renderDigest` become `renderDigestWithBrief (no brief)` and `renderDigestWithBrief in Polish (no brief)`. In `brief.test.ts`, the "no brief" case loses only its line that compares the result with `renderDigest`; its other assertions stay.
- **`routeOfKind`.** Delete it. Its test case in `routes.test.ts` keeps its table and expected routes and calls `effectiveRoute({ stored: group === null ? undefined : routes[group], hasChat, hasDevice, group })` with `group = noticeGroupOf(kind)`, through a small test-local helper. This is the same composition that `apps/server/src/modules/channels/notice-fan-out.ts` does.
- **Test.**
  1. Every case of `digest.test.ts` passes with its HEAD expected value (same count of tests; name both counts).
  2. The moved route case passes for the five group-less kinds, `urgent`, `sync_ok` and `approval_set`, with the HEAD expected routes.
- **Break check (final message).** In `effectiveRoute`, return `{ telegram: hasChat, push: hasDevice }` for `group === null`: the moved route case fails. Revert.

## Step 2 — server and web exports

- **Files.** `apps/server/src/modules/channels/report-members.ts`, `apps/server/src/platform/log-fields.ts`, `apps/web/src/lib/urgency-form.ts`.
- **Decisions.** D8.
- Delete `mailReportKinds`, and its type alias `MailReportKind` when `rg -w MailReportKind` finds no reader; drop the `reportMailKinds` and `ReportMailKind` imports that only the aliases used. Delete `isLogFieldName`; keep `fieldNameSet` (`logFieldKind` reads it). Delete `EMPTY_URGENCY_DRAFT`.
- **Test.**
  3. No new test: these names have no test and no caller. `bun run typecheck` and `bun run lint` are the check.

## Step 3 — docs

- `docs/capabilities/digest-and-notices.md` rule 4, the two prose mentions in rule 6, the function table, and `docs/modules.md` (the `renderDigest` row and the `buildDigestMessage` line): name `renderDigestWithBrief`.
- `docs/capabilities/trust.md`: the `mailReportKinds` mention in rule 19 names `reportMailKinds` (`@ea/core`).

## Done when

- `rg -w 'renderDigest|routeOfKind|mailReportKinds|isLogFieldName|EMPTY_URGENCY_DRAFT' apps packages scripts tools docs/capabilities docs/modules.md` finds nothing.
- `rg -w MailReportKind apps packages` finds nothing, or the final message names its reader.
- No production behaviour file changed beyond the deleted exports and their now unused imports.
- The Proof of `plan.md` with `NN=03` prints `PROOF_OK`.

## Out of scope

- `expiredFlags` (D9 keeps it).
- `renderDigestWithBrief`, `effectiveRoute`, `noticeGroupOf` behaviour.
- `docs/product/` and `notes/` (history; do not edit).
- A tool that finds unused exports (D10).
