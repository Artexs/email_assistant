# F098 stage 09 — Approval texts in English and Polish

Part of [`../plan.md`](../plan.md). Decisions: P6, P7, the glossary, D9, D10, D11, D16, D19. Needs stage 08 landed. Review job before the land (it reads every Polish text). One step.

The translation rules and the fixed words of stage 08 (its introduction and table) apply here. After this stage every outbox notice kind and the status line after a tap render from `packages/core/src/texts/` with the texts of the row's locale. The hold of stage 06 still gives English to everyone.

## Step 1 — Approvals, the reminder set, send results, answered delegations, the tap edit

**Goal.** `approval`, `approval_set`, `send_result`, `delegation_answered` and the status line after a tap render per locale (D16, D19).

**Files.** New: `packages/core/src/texts/approvals.ts`. Changed: `packages/core/src/texts/index.ts`, `packages/core/src/digest/approvals.ts` (+ `approvals.test.ts`), `packages/core/src/notices/{renderers,render}.ts`, `apps/server/src/modules/channels/callbacks.ts` (the `renderNoticeEdit` call keeps passing the row's `locale`; nothing else here).

**Interfaces.**

- `texts/approvals.ts`: an `ApprovalTexts` interface with one entry per fixed string or line of `digest/approvals.ts` (titles, `inactive`, `externalSender`, `due`, `draft`, `bodyCut`, `quoted`, `linksHidden`, `quoteCut`, `sendLine`, the set header by count, `reminderOf`, `task`, the set footer lines, the buttons of the table above, `CLOSINGS`, the five cause lines, every `first` line of `renderSendResult`, the `rest` lines, `HELD_TEXTS`, the four status lines of `approvalEdit`, and the answered-delegation lines). Group them as you like; one entry per sentence.
- Every exported render function of `digest/approvals.ts` takes `texts: CoreTexts` last: `renderApprovalRequest(input, texts)`, `renderApprovalSetRequest(input, texts)`, `renderSendResult(input, texts)`, `renderDelegationAnswered(input, texts)`, `approvalEdit(input, texts)`. `formatClock`/`formatDay` get `texts.locale`.
- `cutLinks` prints `texts.common.noSubject` for an empty subject.
- `renderers.ts`: `textsFor(opts.locale)` for these kinds; `send_result` maps a null `recipient.address` to a new entry `texts.common.unknownAddress` (en `"(unknown)"`, today's value at `notices/renderers.ts:96`; pl `"(nieznany)"`). It does not use `unknownSender`.
- `render.ts`: `noticeEditRenderers.telegram.full = (input, opts) => approvalEdit(input, textsFor(opts.locale))`.
- D19 (the stored English sender placeholder): an approval view stores `sender.label` from `senderLabel(…, textTables.en)` at queue time (`outgoing/sender.ts:47`), so an unknown sender is the English `"(unknown sender)"` inside the view. `renderApprovalRequest` prints `texts.common.unknownSender` when `view.sender.label === textTables.en.common.unknownSender`. The view schema does not change (rows of the last 24 h must still render). Comment: `// The view stores the English placeholder (plan D19); the renderer prints it in the row's language.`
- The `MESSAGE_MAX_CHARS` shrink loop of `renderApprovalRequest` works on the built text, so a longer Polish text only shrinks the quote earlier; keep the loop as it is.
- The `SENDER_LINE` pattern already knows `Od:`; do not change it.

**Decisions.** D9, D10, D11, D16, D19.

**Test.** `approvals.test.ts`:

1. Every old case with `textTables.en`, same expected text and buttons.
2. `pl` approval request (kind `delegation`, recipient name `Jan Kowalski`, address `jan@example.test`, a 200-character body, a quote): first line `📤 Wysłać? Zlecenie: Jan Kowalski jan@example.test`; lines `Szkic:` and `Cytowany oryginał:`; buttons `📤 Wyślij`, `✖️ Odrzuć` with the en callback data.
3. `pl` approval request with a body and a quote whose en text is exactly `MESSAGE_MAX_CHARS` long after the shrink: the pl text is at most `MESSAGE_MAX_CHARS` and holds the quote-cut note.
4. `pl` approval request with `sender.label = "(unknown sender)"` → the line `Od: (nieznany nadawca)`; en → `From: (unknown sender)` (unchanged).
5. `pl` reminder set with 1, 3 and 5 items → the first lines `📤 Wysłać 1 przypomnienie?`, `📤 Wysłać 3 przypomnienia?`, `📤 Wysłać 5 przypomnień?` (fix these three texts); buttons `📤 Wyślij wszystkie`, `✖️ Pomiń wszystkie`.
6. `pl` send result for each `result.kind` (and each `expired` reason) → a non-empty first line that starts with the same emoji as the en line; `outcome_unknown` for a delegation has the buttons `📤 Wyślij ponownie` and `✅ Wysłano`.
7. `approvalEdit` pl for each outcome → the stored text plus one Polish status line; the en case unchanged.
8. `notices/registry.test.ts`: the hold case of stage 08 also covers these kinds and `renderNoticeEdit`.

**Check.** `bun test packages/core/src`; `bun run typecheck`; `bun test apps/server/test/integration/channels-callbacks.test.ts apps/server/test/integration/channels-notices.test.ts apps/server/test/integration/channels-sender.test.ts`.

**Done when.** Cases 1–8 pass; the integration files pass unchanged.

**Out of scope.** Tap answers and bot replies (stage 11). The outgoing mail templates (P7).

## Stage done when

- Step 1 is done. `grep -n 'From: \|Subject: \|Draft:' packages/core/src/digest/approvals.ts` finds only comments (and the `SENDER_LINE` pattern).
- The Proof chain for stages without page changes in `plan.md` § Proof (with `NN` = 09) prints `PROOF_OK`.
- The final message lists any `ApprovalTexts` entry you added beyond the interface.
