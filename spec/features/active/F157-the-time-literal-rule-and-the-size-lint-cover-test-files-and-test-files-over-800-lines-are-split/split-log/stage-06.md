# Stage 06 split log

Base for all four files: `73801f3e`. Each file was split with the history merge of `history-copies.sh`, then trimmed by a script that places every top-level setup statement by use (one part: stays in the part; two or more parts: the helpers file).

## packages/core/src/digest/approvals.test.ts

- Old: 1,666 lines, 170 cases.
- Parts: `approvals-request` 338, `approvals-request-texts` 236, `approvals-set-request` 155, `approvals-send-results` 355, `approvals-edit` 205, `approvals-card-text` 385 (all `.test.ts`); helpers file `approvals.test-helper.ts` 34.
- Proof: `split-proof PASS cases=170`. No `assertions` line.
- Setup list of the old file (no hook, no mock, no `let`): `ID`, `NOW`, `TZ`, `CONTROL`, `view`, `request`, `recipient` in the helpers file; `SET_ID`, `item` in the set-request part; `PANEL_URL`, `SEND_LINE_EN` in the request-texts part; `SendKind`, `sendKinds`, `closings`, `result`, `joined` in the send-results part.
- References repointed: `docs/capabilities/delegation.md` (request and send-results parts), `docs/capabilities/drafts-and-send.md` (all six parts).

## packages/core/src/digest/digest.test.ts

- Old: 1,344 lines, 103 cases.
- Parts: `digest-rows` 308, `digest-lines` 428, `digest-polish-order` 209, `digest-limit` 139, `digest-minimal` 235 (all `.test.ts`); helpers file `digest.test-helper.ts` 63.
- Proof: `split-proof PASS cases=103`. No `assertions` line.
- Setup list of the old file (no hook, no mock, no `let`): `timeZone`, `now`, `slot`, `mailbox`, `uuid`, `item`, `input`, `render`, `blockStarts` in the helpers file; `act` in the rows part; `emailIdOf` in the lines part; `digestOfLength` in the limit part.
- References repointed: `docs/capabilities/digest-and-notices.md` (all five parts), `docs/capabilities/trust.md` (rows and lines parts: why lines, spam review line).

## packages/core/src/replies/digits.test.ts

- Old: 1,022 lines, 107 cases.
- Parts: `digits-budget` 210, `digits-free-numbers` 287, `digits-pins` 356, `digits-long-sequence` 172 (all `.test.ts`); helpers file `digits.test-helper.ts` 8.
- Proof: `split-proof PASS cases=107`. No `assertions` line.
- Setup list of the old file (no hook, no mock, no `let`): `failuresOf`, `say` in the helpers file; `repeat`, `letterIban` in the pins part.
- References repointed: `scripts/test-audit/README.md` (one line, a guess about which part hits a timeout; the guess names the two budget parts).

