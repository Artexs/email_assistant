# F115 stage 15 — Panel reply kind

Part of [`../plan.md`](../plan.md). Needs 14. Web stage; new Polish text (Opus review). Checkpoint C2 after this stage (not a stop).

The F102 approvals page shows and acts on reply drafts; the activity rows get "Draft reply".

## Step 1 — Reply items on the approvals page

- **Goal:** a reply item shows, in this order: the gaps ("Fill these before you send") with each label, `To`, `Cc` (each address spelled out), `Reply-To` when set, the full body, the quote (collapsed), the version, `expiresAt`. Actions: Approve (disabled with the reason while gaps exist), Reject, Edit (F102 edit form; the body may hold `[[`, the page then shows the gaps again), the instruction field (one line, counter "n / 300", "Redraft", disabled at `redraftsLeft = 0` with the text "No redrafts left for this mail"), the Reply all toggle (shows the added addresses before the tap) and "Use Reply-To".
- **Decisions:** Redraft and Draft reply show "Drafting…" and poll the request route (stage 14); on `done` the page shows the new version; on `no_draft` or `failed` it shows the reason text (the same keys as Telegram, `apps/web/src/i18n/`). A 409 `changed` reloads the item with `currentId` (F102 rule). With `sentVisible: false` the item shows "I cannot see your sent mail; check you did not answer already."
- **Test (e2e):**
  1. A reply with one gap: Approve disabled; Edit fills the gap → the new version approves.
  2. Redraft with "tak na wtorek" (fake LLM) → version 2 shows; `redraftsLeft` 4.
  3. Reply all → the Cc line shows two addresses; version 2.
  4. A member sees the item without action buttons.
  5. Keyboard: the instruction field, Redraft and Approve are reachable in order.
  6. Zero axe violations; `cspErrors` empty.

## Step 2 — Draft reply on the activity row

- **Goal:** each activity row of a stored mail (owner view) gets "✍️ Draft reply" while the flag is on and the mail has no open reply send; the row with an open reply send gets "Open the draft" (link to the approvals item).
- **Test (e2e):**
  1. Tap Draft reply on a clean mail → "Drafting…", then the link to the new item.
  2. On a flagged mail → the blocked reason text.
  3. Unit: every new key exists in `en.ts` and `pl.ts`; one Polish value test.

## Proof (web)

```
mkdir -p /tmp/f115-s15 && bun run lint > /tmp/f115-s15/lint.log 2>&1 && bun run typecheck > /tmp/f115-s15/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f115-s15/unit.log 2>&1 && bun run test:int:ci > /tmp/f115-s15/int.log 2>&1 && bun run web:build > /tmp/f115-s15/web.log 2>&1 && grep -q 'csp checked in' /tmp/f115-s15/web.log && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f115-s15/e2e.log 2>&1 && echo PROOF_OK
```

Own e2e DB first (name `f115_s15_e2e`). Never `web:dev`.

- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** samples (16), docs (17).
