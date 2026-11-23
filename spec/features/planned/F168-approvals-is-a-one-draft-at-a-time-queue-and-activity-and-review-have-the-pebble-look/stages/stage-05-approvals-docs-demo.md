# F168 stage 05 — Approvals user docs and the demo step

Needs stage 04: the queue page (its button names, outcome texts and `?id=` rule). May run next to 06, 07, 08.

Part of [`../plan.md`](../plan.md). The user docs and the demo recording follow the new approvals page. No product code changes here.

## Step 1 — User docs

- **Files:** `apps/docs/src/content/docs/how-to/approve-a-send.mdx` and its Polish copy in `pl/how-to/`.
- **Decisions:**
  - Add a section "Approve in the panel" after the Telegram steps. It says what the page does today: one draft at a time; "Yes, send it", "Change", "No"; "Later" skips a draft with no change; the list of waiting drafts ("All waiting" on a phone); the short "Sent to" line before the next draft; a link from Telegram opens that draft, and a draft that is already decided shows its state.
  - Button names come from `<UiText k="…" />` with the real keys, never as literal text.
  - No promise beyond the page (PB-8): no time to finish, no count per week.
- **Test:** `bun run docs:test` passes (it checks the `UiText` keys and the links).

## Step 2 — The demo step

- **Files:** `apps/web/e2e/demo/record.spec.ts` (step 6 `approval` only), `apps/web/e2e/demo/README.md` (row 6), `apps/web/e2e/lib/demo/steps.ts` only if the step text names a button.
- **Decisions:** the step keeps its story: open `/approvals?id=<editSendId>`, "Change", save the new text, wait until "Yes, send it" is on, approve, see the outcome text of stage 04. The locators use roles and `en` keys, as today. The F171 ticket records the takes again; this stage only keeps the step runnable.
- **Check:** run the recording under the shared lock: `flock /tmp/email-assistant-shared-tests.lock bun run demo:record`. If the tool can run one step alone, run only step 6 and say how. Not verified at plan time (`../plan.md` § Not verified).

## Step 3 — Capability page

- **Files:** `docs/capabilities/web-panel.md`: check that the approvals rules of stage 04 name the user docs page; add the link if not.

## Out of scope

The page code, the specs of stage 04, other demo steps, the docs site look (F171).

## Done when

- `docs:test` passes; the demo step 6 ran to its end (the log line of the step in the final message).
- `mkdir -p /tmp/f168-05 && bun run check:job > /tmp/f168-05/check.log 2>&1 && bun run docs:test > /tmp/f168-05/docs.log 2>&1 && echo PROOF_OK` prints `PROOF_OK`.
