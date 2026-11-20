# F146 plan — one ACTION_ID_HEADER; the unread exports and the weaker DKIM check go

> **Status 2026-11-20 — planned.** Plan base: 22188c54. Three stages, all parallel. No migration, no `bun.lock` change.

## Input

Task (coordinator, 2026-11-20): "Plan F146: use the plan-task skill, read spec/quality/2026-11-20-pass-2.md for the findings … Keep stages small (one worker each, 1 to 3 hours), name risky ones [risky], say which stages can run in parallel, give each stage a runnable Proof and tests that fail when the guard is removed. Decide yourself where the owner has no rule; record each default in a "Decisions taken" list in plan.md."

Source findings (`spec/quality/2026-11-20-pass-2.md`):
- Finding 7: "One `ACTION_ID_HEADER` in `packages/core/src/outgoing/` (the one header name and its lower-case form for the readers); use it in the ten other sites; delete `REPORT_MAIL_ID_HEADER`."
- Finding 6: "Make `hasTrustedAlignedDkimPass` file-private (its tests call `hasCoveredDkimPass`); delete the other seven or give each a caller. For `expiredFlags`, either call it from `bun run lint` (fail past the remove-by date) or delete it and the promise in `features.ts:10`."

### Decisions taken

The owner has no rule on these; each is a default (see `questions.md`).

- **P1 No behaviour change.** The wire name stays `X-EA-Action-Id`. nodemailer writes it as `X-Ea-Action-ID`; every reader already compares without case. So a release before F146 and a release after it read each other's drafts. Rejected: a new header name (breaks the own-mail check for drafts already in mailboxes).
- **D1 Constant home.** New file `packages/core/src/outgoing/headers.ts`, re-exported through `outgoing/index.ts` (so `@ea/core`):
  ```ts
  export const ACTION_ID_HEADER = "X-EA-Action-Id";
  export const ACTION_ID_HEADER_KEY = "x-ea-action-id" satisfies Lowercase<typeof ACTION_ID_HEADER>;
  ```
  `satisfies Lowercase<…>` makes a typo in the lower-case form a compile error (probe below). Rejected: keep the name in `report-mail.ts` (the header serves drafts, sends, probes and report mail, not report mail only). Rejected: `ACTION_ID_HEADER.toLowerCase()` at run time (loses the literal type that the IMAP fetch lists and parsed-header reads use).
- **D2 Use.** Writers use the computed key `[ACTION_ID_HEADER]`; message types say `headers: { [ACTION_ID_HEADER]: string }`. Readers of lower-cased header maps and IMAP fetch lists use `ACTION_ID_HEADER_KEY`. The local `ACTION_HEADER` constant of `mail/imap/probe-send.ts` goes. The `X-EA-Probe` header is not part of this ticket.
- **D3 Guard = AST scan test** `apps/server/src/action-id-header-scan.test.ts`, the same shape as `apps/server/src/address-rule-scan.test.ts` (TypeScript parser, no new package). It reads every string literal and template part (head, middle, tail, no-substitution) in the production files and reports each one whose text matches `/x-ea-action-id/i`, with file and line. Production files: `*.ts` and `*.tsx` under `apps/*/src/`, `packages/*/src/` and `scripts/`, minus `*.test.ts(x)`, `*.spec.ts`, `*.test-helper.ts`, `**/test/**`, `**/e2e/**`. The one allowed file is `packages/core/src/outgoing/headers.ts`. Comments are not tokens, so the eight comments that name the header in prose stay. Rejected: an ESLint rule (rule file, config block and lint test for one string). Rejected: a line regex (prose comments would need markers).
- **D4 Tests keep the literal.** Test files, fixtures, contract suites and `apps/server/test/` keep `"X-EA-Action-Id"` as written. They are the independent check of the wire format: a wrong constant then fails them.
- **D5 `tools/mail-oauth-spike/` stays as it is** (a spike, no `@ea/core` dependency).
- **D6 DKIM.** Delete `hasTrustedAlignedDkimPass` (a file-private copy would have no caller and fail lint). Its describe block (8 tests: case folding, comments, quoted strings, malformed values, NUL, shared hosting suffixes, alignment) runs through `hasCoveredDkimPass` with a test helper that passes one covering signature (`h=` with both `List-Unsubscribe` headers) for every `header.d` domain that the file's cases use. Every case keeps its expected boolean. Before the delete, one temporary assertion shows that both functions agree on every case; it goes with the delete. Rejected: export `trustedAlignedPassDomains` instead (a weaker primitive in the public API again). Rejected: drop the cases (scout 2: no `hasCoveredDkimPass` test covers the parser cases; the test audit F125 keeps this file as K3).
- **D7 Export guard for DKIM.** A unit test pins the export list of `triage/dkim-pass.ts` (exact sorted list at HEAD minus the deleted name) and checks that `import * as core from "../index"` has no key `hasTrustedAlignedDkimPass`.
- **D8 Dead exports.** Delete `renderDigest` (tests call `renderDigestWithBrief(…).message` through the existing `render` helper of `digest.test.ts`; in `loops/brief.test.ts` "no brief" the self-compare line goes and the other assertions stay), `routeOfKind` (its test table moves to `effectiveRoute` with `group: noticeGroupOf(kind)` and `stored: routes[group]`, same expected routes), `mailReportKinds` and its type alias `MailReportKind` when nothing reads it, `isLogFieldName` (the set `fieldNameSet` stays: `logFieldKind` reads it), `EMPTY_URGENCY_DRAFT`, `REPORT_MAIL_ID_HEADER` (stage 01).
- **D9 `expiredFlags` stays.** The finding is wrong: `packages/core/src/features.test.ts` "no registry flag is past its remove-by date" calls it with the real registry and today's date, and CI runs it in `test:unit` (scout 3). The earliest remove-by date is 2027-03-01. Rejected: a second call from lint (two checks of one rule). Rejected: delete (the remove-by promise loses its only check).
- **D10 No general unused-export checker.** Rejected: knip or similar (a `bun.lock` change, and false positives on the public API of `@ea/core`). This ticket removes the known list only.
- **D11 Docs.** Each stage updates the pages that name what it changes: `docs/capabilities/sync.md` rule 9 names the constant (stage 01); `docs/capabilities/trust.md` (stage 02: the DKIM prose and the function row; stage 03: the `mailReportKinds` mention); `docs/capabilities/digest-and-notices.md` and `docs/modules.md` say `renderDigestWithBrief` (stage 03).
- **D12 Reviews.** Stage 01 touches the sync own-mail check and stage 02 a security check: Opus review before the land (`spec/build.md` standing models). Stage 03 lands on its proof.

## Facts checked

- 2026-11-20, local probe with TypeScript 5.9.3 (the repo version): `"x-ea-action-ld" satisfies Lowercase<typeof ACTION_ID_HEADER>` fails with TS1360; the right form passes; a type `{ [ACTION_ID_HEADER]: string }` accepts `{ "X-EA-Action-Id": "a" }`.
- Header sites, importers, `expiredFlags`: `scouts.md` scouts 1–3, each checked by `rg` and a read. `findHeader` (fake adapter) compares lower-cased names. `@ea/core` re-exports `triage/dkim-pass` and `notices/routes` with `export *`.

## Not verified

- That no string-built header name exists (for example `X-EA-${…}`). Stage 01 checks with `rg -i 'x-ea-'` over the production roots and reports each hit.

## Done when

1. `packages/core/src/outgoing/headers.ts` holds the only production spelling; the scan test passes with zero findings.
2. The scan test fails when `"x-ea-action-id"` goes back into `apps/server/src/modules/mail/imap/mapper.ts` (stage 01 break check, in the final message).
3. `REPORT_MAIL_ID_HEADER`, `hasTrustedAlignedDkimPass`, `renderDigest`, `routeOfKind`, `mailReportKinds`, `isLogFieldName` and `EMPTY_URGENCY_DRAFT` do not exist: `rg -w` of each name over `apps packages scripts tools docs/capabilities docs/modules.md` finds nothing.
4. Every old `hasTrustedAlignedDkimPass` case passes through `hasCoveredDkimPass` with its old expected value.
5. The export guard of D7 passes, and fails when the export is put back.
6. Lint, typecheck, unit and integration suites pass at the last land; no test file under `apps/server/test/integration/` changed.

## Rules for every stage

- A gap or a deviation from a decision is a question in the final message, not a choice.
- No behaviour change (P1). An integration test that needs an edit to pass is a stop and a question.
- Format only the files of the stage. No `bun.lock` change.
- Each new test fails when its guard breaks: name the break you made and the failing test in the final message.
- Before the final message: `git merge --no-edit master`, then the Proof, then a commit (`.agents/limen/reminders.md`).

## Proof

`mkdir -p /tmp/f146-sNN && bun run lint > /tmp/f146-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f146-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f146-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f146-sNN/int.log 2>&1 && echo PROOF_OK`

(`NN` = stage number.) Run it after the last commit, with nothing after it.

## User checkpoints and steps

None. No migration, no deploy, no secret.

## Review

Stages 01 and 02: `claude-opus-5-5` review before the land (D12). Stage 03: none.

## Stages

| # | Stage | Mark |
| --- | --- | --- |
| 01 | [One ACTION_ID_HEADER and its scan test](stages/stage-01-action-id-header.md) | [risky] |
| 02 | [The weaker DKIM check goes](stages/stage-02-dkim-check.md) | |
| 03 | [Unread exports go](stages/stage-03-unread-exports.md) | |

## How to run (coordinator)

Move the folder to `active/` and commit. Start all three at once: they change no shared code file. Stages 02 and 03 both edit `docs/capabilities/trust.md` (different paragraphs); a land conflict is "merge master, re-prove". Spawn per stage:

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F146" \
  'Implement F146 stage NN. Read spec/features/active/F146-one-action-id-header-exists-and-the-unread-exports-and-the-weaker-dkim-check-are-removed/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the plan Proof with NN. In the final message, list as proven only what a saved log shows.'
```

Drop the job DB after each land. The last land closes the ticket.

## Planning progress

- [written] ticket.md, plan.md, scouts.md (3 scouts, all returned), questions.md, stages 01–03.
- Word counts (`wc -w`): see § Cold review.

## Cold review

Pending.

## Log

- 2026-11-20 plan written at 22188c54.
