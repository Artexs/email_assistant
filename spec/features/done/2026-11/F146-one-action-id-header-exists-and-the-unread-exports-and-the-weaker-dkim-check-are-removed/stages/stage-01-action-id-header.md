# F146 stage 01 — one ACTION_ID_HEADER and its scan test [risky]

Needs: nothing (reads HEAD only). May run next to 02 and 03.
Part of [`../plan.md`](../plan.md). Review: Opus, before the land (the own-mail check of every sync reads this header).

## Goal

The header name `X-EA-Action-Id` has one production spelling, in `@ea/core`. A scan test fails when a hand spelling comes back. Nothing a mailbox or a user sees changes (P1).

## Step 1 — the constant and its users

- **Files.** New `packages/core/src/outgoing/headers.ts` (+ `headers.test.ts`), exported from `outgoing/index.ts`. Users: the core message builders (`outgoing/message.ts`, `outgoing/report-mail.ts`), the IMAP adapter (fetch list, mapper, probe send) and the fake adapter (`mail/fake/`). Find the rest with `rg -i 'x-ea-action-id'` outside tests and comments.
- **Interfaces.** `ACTION_ID_HEADER` and `ACTION_ID_HEADER_KEY` exactly as in D1. `REPORT_MAIL_ID_HEADER` is deleted. The message types keep their shape: `headers: { [ACTION_ID_HEADER]: string }`.
- **Decisions.** P1, D1, D2, D4, D5. Writers use `ACTION_ID_HEADER`; readers of lower-cased maps and IMAP fetch lists use `ACTION_ID_HEADER_KEY`. The regex in `probe-send.ts` that reads the header from raw text uses `ACTION_ID_HEADER_KEY` with its `i` flag as today.
- **Not verified (plan).** Run `rg -i 'x-ea-' apps/*/src packages/*/src scripts` and check that no header name is built from parts. Name each hit in the final message.
- **Test.**
  1. `headers.test.ts`: `ACTION_ID_HEADER` is `"X-EA-Action-Id"`; `ACTION_ID_HEADER_KEY` is `"x-ea-action-id"`; `ACTION_ID_HEADER_KEY` equals `ACTION_ID_HEADER.toLowerCase()`.
  2. The existing core tests (`message.test.ts`, `report-mail.test.ts`, `follow-up.test.ts`) and the mail adapter tests pass unchanged; they keep the literal (D4).

## Step 2 — the scan test

- **Files.** New `apps/server/src/action-id-header-scan.test.ts`. Copy the shape of `apps/server/src/address-rule-scan.test.ts` (TypeScript AST, `findings(file, text)`, a `Glob` over the roots).
- **Decisions.** D3: the roots, the excluded paths, the one allowed file, the pattern `/x-ea-action-id/i` on string literals, regex literals (`ts.isRegularExpressionLiteral`, match on the node text) and template parts only.
- **Test.**
  3. Zero findings over the production files at HEAD. On failure the message lists `file:line` per finding.
  4. The scanned file list is not empty and holds `packages/core/src/outgoing/message.ts` and `apps/server/src/modules/mail/imap/mapper.ts` (a glob that matches nothing must fail).
  5. `findings()` on fixed snippets (`test.each`):
     - `const a = "X-EA-Action-Id";` → 1
     - ``const b = `x-ea-action-id: ${v}`;`` → 1
     - `const c = { "x-Ea-AcTion-iD": v };` → 1
     - `// the X-EA-Action-Id header` → 0
     - `/** X-EA-Action-Id */ const d = 1;` → 0
     - `const e = "X-EA-Probe";` → 0
     - `const r = /x-ea-action-id/i;` → 1
  6. `packages/core/src/outgoing/headers.ts` is in the scanned list and gives zero findings only because it is the allowed file: `findings()` on its text without the allow gives 2.
- **Break check (final message).** Put `"x-ea-action-id"` back into `mail/imap/mapper.ts`: case 3 fails and names the file and line. Revert.

## Step 3 — docs

`docs/capabilities/sync.md` rule 9: one clause that the header name lives in `ACTION_ID_HEADER` (`@ea/core`) and the scan test keeps it so. `docs/code-patterns.md` § Side effects line on `X-EA-Action-Id`: name the constant.

## Done when

- Plan § Done when items 1 and 2 hold.
- `rg -w REPORT_MAIL_ID_HEADER apps packages` finds nothing.
- No file under `apps/server/test/` and no `*.test.ts` other than the two new ones changed (`git diff --stat master...HEAD`).
- The Proof of `plan.md` with `NN=01` prints `PROOF_OK`.

## Out of scope

- The `X-EA-Probe` header, `Message-ID` building, any header value.
- `tools/mail-oauth-spike/` (D5). Test files and fixtures (D4).
- Comments that name the header in prose.
