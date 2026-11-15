# F110 stage 10 — Trust notice kinds

Part of [`../plan.md`](../plan.md). Polish text: review by `claude-opus-5-5`.

## Step 1 — Two kinds as facts

- **Goal:** the report-ready and the paused notices exist as F088 notice kinds, with en and pl texts (P2, D15, D16).
- **Files:** `noticeKinds`, `noticeViewSchemas`, `noticeRenderers` and their `queuedBy` map (`channels/notices/`); texts in `packages/core/src/texts/` (en, pl); `apps/server/src/modules/channels/notices/registry.test.ts` stays green.
- **Interfaces:**
  - `trust_report_ready` view: `{ mailboxId, recommended: MovingCategory[], blocked: number, checked: number, reportUrl: string | null }`. Dedup `trust_report:<mailbox id>`.
  - `autonomy_paused` view: `{ mailboxId, category: BarCategory, reason: "corrections" | "important_hidden" | "model_switch", corrections: number, settingsUrl: string | null }`. Dedup `autonomy_paused:<trip id>`.
  - A queue helper in `channels` that stages 07, 08 and 09 call inside their transaction: `queueTrustNotice(trx, ctx, { kind, view, mailboxId })` → one row per linked owner (`users.locale`).
  - URLs: `<WEB_BASE_URL>/report?mailbox=<id>` and `<WEB_BASE_URL>/settings`, only when `WEB_BASE_URL` is set; a text line, not a URL button (as F102 D5).
- **Decisions:**
  - D15: the texts hold category names, counts, and fixed reason phrases only. No address, sender, subject or domain. No consent bump.
  - No buttons. Quiet hours apply (they are notices).
  - Texts (en; pl in the same meaning, checked by the review):
    - ready: `📋 Your check is ready: I looked at <checked> mails from the last 30 days.` then `Recommended: <categories>` or `Nothing to turn on yet.`, then the link line.
    - paused, `corrections`: `⏸ Automatic moves for <category> are off: you corrected <n> of them in 7 days.`
    - paused, `important_hidden`: `⏸ Automatic moves for <category> are off: one of them hid a mail you needed.`
    - paused, `model_switch`: `⏸ Automatic moves for <category> are off: the AI model changed and has no proof yet for this category.`
    - Each paused text ends with `Turn it on again in Settings.` and the link line.
- **Test:**
  1. Render each view in en and pl; each fits 4096 characters; no `undefined`.
  2. A view with an extra key fails the strict schema (`NoticeViewError`).
  3. `queueTrustNotice` with two linked owners and one linked member → two rows; twice → still two (dedup).
  4. `reportUrl: null` → no link line.
- **Check:** `bun test apps/server/src/modules/channels/notices packages/core/src/texts`

## Done when

- `registry.test.ts` passes with both kinds in `queuedBy` (producers: the trust module).
- Proof (`s10`) prints `PROOF_OK`.

## Out of scope

Delivery by mail (stage 19). Who calls the helper (stages 07–09).
