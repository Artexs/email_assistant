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

## Step 3 — Consent in the panel

- **Goal:** the Telegram card shows the new consent text and "I agree" for a linked user whose consent is older (stage 12 route), no relink.
- **Test (e2e):** a user linked with the old version sees the button; after the tap it is gone.

## Proof (web)

```
mkdir -p /tmp/f115-s15 && bun run lint > /tmp/f115-s15/lint.log 2>&1 && bun run typecheck > /tmp/f115-s15/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f115-s15/unit.log 2>&1 && bun run test:int:ci > /tmp/f115-s15/int.log 2>&1 && bun run web:build > /tmp/f115-s15/web.log 2>&1 && grep -q 'csp checked in' /tmp/f115-s15/web.log && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f115-s15/e2e.log 2>&1 && echo PROOF_OK
```

Own e2e DB first (name `f115_s15_e2e`). Never `web:dev`.

- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** samples (16), docs (17).

## Carry-over from stage 08

- The Telegram card line is now "Edit here, or edit and send in your mail client." The panel keeps the old texts: `appr_send_note` ("The system sends it after your approval. Do not send the draft from your mail client.") and `appr_edit_hint` ("Edit here, not in your mail client."). Change both (en and pl, in place) so the panel and the card agree. A panel row that ends `expired` / `draft_changed` needs a status text; the approvals list has no text per reason, so check how `expired` rows show their reason.

## Carry-over from stage 09

- `ApprovalItem.sentVisible` for a reply: read it from `isSentVisible(db, ctx, mailboxId)` (`mail` module; the org flag `sent_sync` and the switch of the mailbox), as `approvalViewFor` does for the card view field `sentVisible: false`.
- The sweep closes open replies (`answered`, `newer_mail`, `original_moved`, `suspicious`, `policy_changed`) with no result notice for a waiting reply; the panel list shows them as expired with that `status_reason`.

## First commit of this stage (carry-over from the stage 14 review, PASS 35982907, and the stage 14 hand-over)
- Panel texts (en and pl, informal "ty"): the 400 codes `too_many_recipients`, `no_reply_to`, `no_others`, `bad_recipient`, `unchanged`, `not_editable` and the 409 codes `blocked` (with `reason`), `changed`, `closed`, `redraft_limit`, `drafts_off`.
- Block the redraft button while a request waits (parallel redrafts with different lines all get 202 and the same `requestId`; only the first line is stored).
- Show Cc and Reply-To entries that are not ASCII (IDN homoglyph) as punycode or with a mark, before Send.
- `view.replyTo` in `notices/approval.ts` should skip own mailboxes and their `+tag` forms, as `otherReplyTo` does.
- Docs: the `getReplyRequest` apiDoc summary says "Reads only the request row" but `superseded` also reads the open sends of the thread; the Entry points table in `docs/capabilities/drafts-and-send.md` lists `ownAddressKey` and `bareAddress` under `replies/recipients.ts`, they live in `triage/payloads.ts`.
- Optional tests: pin `REPLY_INSTRUCTION_RAW_MAX`; the `superseded` branch (newest open send; no open send gives `sendId: null`).
