# Stage 06 split log

Base for all four files: `73801f3e`. Each file was split with the history merge of `history-copies.sh`, then trimmed by a script that places every top-level setup statement by use (one part: stays in the part; two or more parts: the helpers file).

## packages/core/src/digest/approvals.test.ts

- Old: 1,666 lines, 170 cases.
- Parts: `approvals-request` 338, `approvals-request-texts` 236, `approvals-set-request` 155, `approvals-send-results` 355, `approvals-edit` 205, `approvals-card-text` 385 (all `.test.ts`); helpers file `approvals.test-helper.ts` 34.
- Proof: `split-proof PASS cases=170`. No `assertions` line.
- Setup list of the old file (no hook, no mock, no `let`): `ID`, `NOW`, `TZ`, `CONTROL`, `view`, `request`, `recipient` in the helpers file; `SET_ID`, `item` in the set-request part; `PANEL_URL`, `SEND_LINE_EN` in the request-texts part; `SendKind`, `sendKinds`, `closings`, `result`, `joined` in the send-results part.
- References repointed: `docs/capabilities/delegation.md` (request and send-results parts), `docs/capabilities/drafts-and-send.md` (all six parts).

