# F168 stage 05 — The demo steps of Approvals and Activity

Needs stage 04: the queue page (its button names, outcome texts, `?id=` rule). Needs stage 07: the Activity row (the Undo button). May run next to 08. Runs `demo:record` on the shared demo DB, under the shared lock.

Part of [`../plan.md`](../plan.md). The demo recording follows the new pages. No product code changes here. CI does not run the recording, so this stage is its only check in this ticket.

## Step 1 — Step 6 `approval` and step 8 `undo`

- **Files:** `apps/web/e2e/demo/record.spec.ts` (steps 6 and 8 only), `apps/web/e2e/demo/README.md` (rows 6 and 8), `apps/web/e2e/lib/demo/steps.ts` only if a step text names a button.
- **Decisions:**
  - Step 6 keeps its story: open `/approvals?id=<editSendId>`, "Change", save the new text, wait until "Yes, send it" is on, approve, see the outcome text of stage 04 ("Sending to …" or "Sent to …").
  - Step 8 keeps its story: on `/activity`, find the row by `li[data-email-id]`, press Undo, see the undo toast.
  - Locators use roles and `en` keys, as today. The docs and video ticket (F171) records the takes again; this stage keeps the steps runnable.
- **Check:** `flock /tmp/email-assistant-shared-tests.lock bun run demo:record`. If the tool can run single steps, run steps 6 and 8 only and say how. Not verified at plan time (`../plan.md` § Not verified).

## Out of scope

The page code and its specs. Other demo steps. The user docs page of approvals (`../plan.md` D11).

## Done when

- The recording ran steps 6 and 8 to their end (their log lines in the final message).
- `mkdir -p /tmp/f168-05 && bun run check:job > /tmp/f168-05/check.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock bun run demo:record > /tmp/f168-05/demo.log 2>&1 && echo PROOF_OK` prints `PROOF_OK`.
