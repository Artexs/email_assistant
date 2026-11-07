> **Status 2026-11-07 — planned.** Nothing built.

# Telegram picker: say "Already saved" in the message too

Found in the S2 live run on the pilot (2026-11-07, `tasks/done/s2-telegram.md` "Results").

## Problem

`handleCallback` in `apps/server/src/modules/channels/callbacks.ts` edits the picker message to `✏️ Saved: <pick> (AI said <category>).` also when `recordFeedback` saved nothing (`skipIfSame`: the latest feedback row of the mail, of any source, has the same verdict and category). The toast says "Already saved.", but the toast is short and easy to miss. The user saw "Saved" twice and the DB had no new row, because S1b CLI labels had marked the mail `spam` already.

## Proposal

When `saved.saved` is false, edit the picker message to `✏️ Already saved: <pick> (AI said <category>).` Add a test in `apps/server/test/integration/channels-callbacks.test.ts` (or the stage 16 test file) for the same-pick case. Small change, one stage.
