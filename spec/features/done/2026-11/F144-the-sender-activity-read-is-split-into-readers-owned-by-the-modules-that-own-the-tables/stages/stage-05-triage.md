# F144 stage 05 — triage readers of the newest result and the newest feedback

Part of [`../plan.md`](../plan.md). Review: `claude-sonnet-5-5` before the land (new tenant filters, a new layer edge).

Needs stage 02: `senderWindow`, `SenderWindow`, `SenderWindowOptions` in the mail module, and the `categories` statement of `contacts/activity.ts` with its suspicious count. Needs stage 01: `contacts-activity-golden.test.ts`.
May run next to 03 and 04: this stage adds only `triage/repo/sender-activity.ts`, its exports and the `layers.json` edge, and changes the triage statements of `contacts/activity.ts`. A land conflict in `contacts/activity.ts` or the module graph files: merge master, run `bun run graph:modules` again, re-prove.

## Step 1 — the layer edge (D8)

- **Goal:** contacts may import the triage `index.ts`.
- **Files:** `apps/server/src/modules/layers.json` (one `sameLayerEdges` entry: from `contacts`, to `triage`, why "The profile pass reads the newest triage result and feedback counts per sender."); then `bun run graph:modules`, and commit its output.
- **Test:** `layers.test.ts` and `bun run lint` pass.

## Step 2 — the two readers (D2, D3, D4, D5, D6)

- **Goal:** the `categories` and `feedback` statements become triage readers; contacts calls them.
- **Files:** new `apps/server/src/modules/triage/repo/sender-activity.ts`, exported through `triage/repo/index.ts` and `triage/index.ts`; `contacts/activity.ts`.
- **Interfaces:**
  - `newestResultsBySender(db: DbOrTrx, ctx: TenantContext, window: SenderWindowOptions): Promise<{ address: string; category: Category; mails: number; suspicious: number }[]>` — one row per address and category of the newest result of each window mail (`DISTINCT ON (email_id)`, newest `created_at`, then `id`); `suspicious` counts those with suspicious reasons.
  - `newestFeedbackBySender(db, ctx, window: SenderWindowOptions): Promise<{ address: string; kind: "correction" | "moved_back" | "rescued"; category: Category | null; mails: number }[]>` — the newest feedback of each window mail, with the three kinds of today's statement: `correction` (`verdict = 'wrong'` with a true category, grouped by true category), `moved_back` (`source = 'imap_move'`), `rescued` (newest result `spam` or `notification`, and moved back or corrected to another category).
  - Each reader builds the window with `senderWindow` (stage 02) and embeds it as the CTE `win` in its one statement. Categories are parsed with `categorySchema` in the reader; contacts gets typed values.
- **Decisions:** D4 — `suspicious90` = sum of `suspicious` over the address's rows; the stage 02 temporary count in contacts goes. D6 — rows hold the rule form from the window.
- **Test** (new `apps/server/test/integration/triage-sender-activity.test.ts`; `NOW` and `ago` of `contacts-fixtures.ts`):
  1. Newest result: a mail with results `spam` (older) then `info` (newer) counts as `info` once; a second mail `info` with suspicious reasons: `[{ category: "info", mails: 2, suspicious: 1 }]`.
  2. Two results with the same `created_at`: the higher `id` wins.
  3. Feedback: a mail with feedback `wrong → spam` then `wrong → action` counts one `correction` with `category: "action"`.
  4. Rescued: a mail with newest result `spam` and feedback `wrong → info` gives `correction` `info` 1 and `rescued` 1; a mail with result `info` and source `imap_move` gives `moved_back` 1 and no `rescued`.
  5. Window: a result of a mail at 91 days is not counted.
  6. Tenant: org B has a `triage_results` row with org B's id on a mail of org B with the same address; org A returns only test 1's rows; with org A's `ctx` and org B's mailbox id both readers return `[]`.
- **Guard check:** remove the window `org_id` filter, see the `[]` part of test 6 fail. `tr.org_id` and `tf.org_id` stay by the `org_id` rule of `docs/code-patterns.md` § Data access, though the window already scopes them (no guard check can fail for them); swap the order to `created_at ASC`, see test 1 fail.
- **Check:** `bun test apps/server/test/integration/triage-sender-activity.test.ts apps/server/test/integration/contacts-activity-golden.test.ts apps/server/test/integration/contacts-refresh.test.ts apps/server/test/integration/contacts-refresh-guards.test.ts apps/server/src/modules/layers.test.ts`.
- **Done when:** the golden test passes unchanged, the new tests pass, `contacts/activity.ts` names no `triage_results` or `triage_feedback`, and the Proof prints `PROOF_OK`.
- **Out of scope:** other triage readers (`listLatestTriageByEmailIds` and others stay); the Sent statements (03, 04); docs (06).
