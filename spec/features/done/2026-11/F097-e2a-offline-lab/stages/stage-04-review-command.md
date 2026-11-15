# F097 stage 04 — `/review` command (F028)

Part of [`../plan.md`](../plan.md). Review job before the land (user-visible command, tenant filter). Coordinator steps C2 and C3 (deploy, flag on for the pilot) after the land.

After this stage a linked Telegram chat can send `/review` and get up to 10 unlabelled recent real mails in a seeded random order, each with ✅ / ✏️ buttons that record `source = 'review'`, when the flag `review_command` is on for its organization (D4, D5, D6). Source: `spec/features/dropped/2026-11/F028-telegram-review-command/plan.md`.

Shared files: `channels/commands.ts`, `callbacks.ts`, `texts.ts`, `telegram/polling.ts` and `packages/core/src/digest/` are also edited by F098 stages 06–12 (Telegram texts in en and pl); `packages/core/src/features.ts` was edited by F099 stage 12 (landed: flag `security_log`; plan F13). Merge `master` before your proof if one of them landed during your job. Follow plan D39 at your start: if `packages/core/src/texts/index.ts` exists (F098 stage 06), the English texts below go into the core texts registry with a Polish entry and `renderReviewPage` takes `texts: CoreTexts` as its last parameter. If `packages/core/src/texts/bot.ts` exists too (F098 stage 11), add the `/review` line to `texts.bot.help` (en and pl) and `review` to `texts.bot.commands` and to its type test against `commandNames`, and test 7 checks `texts.bot.help` and `BOT_COMMANDS`, not `helpText()`. Otherwise `channels/texts.ts` and `BOT_COMMANDS` take the English lines as written below.

## Step 1 — Flag and the page renderer

**Goal.** A flag exists; a pure renderer builds the page (D4, D6).

**Files.** `packages/core/src/features.ts`, `packages/core/src/features.test.ts`, `packages/core/src/digest/review.ts` (new), `review.test.ts` (new), `packages/core/src/digest/index.ts`.

**Interfaces.**

```ts
// features.ts
review_command: {
  default: false,
  description: "The /review command in Telegram: label a random sample of recent mail.",
  epic: "E2a",
  removeBy: "2027-03-01",
},

// digest/review.ts
export interface ReviewItem {
  emailId: string;
  category: Category;
  from: string | null;
  subject: string | null;
  receivedAt: Date;
  aiText: string | null;
}
export const REVIEW_EMPTY_TEXT = "Nothing to review: every recent mail has a label.";
export const REVIEW_OFF_TEXT = "This command is not on for your account.";
export function renderReviewPage(input: { items: readonly ReviewItem[]; now: Date; timeZone: string }): OutMessage;
```

Add `review_command` as the last entry of `featureFlags` (registry order is the list order). Then update every test that lists all flags (plan fact F21): `apps/server/test/integration/tenancy-features.test.ts` (case 8 `featureStates`, ~lines 168–173: a row `{ flag: "review_command", enabled: false, source: "default" }` after `security_log`), `apps/server/test/integration/web-operator.test.ts` case 4 (~lines 106–121: a `review_command` flag row after `security_log`, one more `false` in the other organization's list (five), and the title "four keys per row" becomes "five keys per row": F099 stage 12 made the number count the flags) and case 6 (~line 137: `toHaveLength(4)` becomes `toHaveLength(5)`), `apps/server/test/integration/org-flag-cli.test.ts` case 1 (~line 71: add `review_command off (default)` after `security_log off (default)`). Each list holds every key of the registry at your commit, in registry order (at `072e3c9`: `stats_page`, `approvals_page`, `sent_sync`, `security_log`, then `review_command`). Find more with `grep -rln "sent_sync" packages apps --include=*.test.ts`.

Page text: first line `Review: ${n} ${n === 1 ? "mail" : "mails"} without a label (random sample of the last 30 days). Tap ✅ when the AI category is right, ✏️ to correct it.`; then per item a block like a digest item (reuse `categoryTag`, `senderLabel`, `cleanSubject`, `cutText`, `formatClock` from the digest helpers; do not copy them), numbered `1.` … Buttons: one row per item, `[✅ n]` (when the category is one of `reviewLabelCategories`, so also `delegation`; not for `unsure`) with `review_right`, `[✏️ n]` with `review_edit`. The whole message ≤ `MESSAGE_MAX_CHARS`: drop items from the end until it fits (as `renderDigest` does). No mail body: the page shows the AI summary (`aiText`) only, as the digest does (ADR 0005).

**Decisions.** D4, D5, D6.

**Test** (unit, `review.test.ts`; `now = 2026-11-20T12:00:00Z`, `timeZone = "Europe/Warsaw"`):

1. 0 items → `REVIEW_EMPTY_TEXT`, no buttons.
2. 3 items (`info`, `unsure`, `delegation`) → header says `3 mails`; item 1 has buttons `vr:i:…` and `ve:…`; item 2 (`unsure`) has only `ve:…`; item 3 has `vr:d:…` and `ve:…`.
3. 10 items with 400-char summaries → text length ≤ 4096 and the button rows match the items kept.
4. `featureFlags.review_command.default === false` and `epic === "E2a"` (the registry test in `features.test.ts` already checks the patterns).

**Check.** `bun test packages/core/src/digest/review.test.ts packages/core/src/features.test.ts` and the three integration files above.

**Done when.** Cases 1–4 pass.

**Out of scope.** Web panel review (E4-A).

## Step 2 — The command

**Goal.** `/review` runs for a linked chat behind the flag (D4, D6).

**Files.** `apps/server/src/modules/channels/port.ts` (`commandNames` gains `"review"`), `channels/telegram/polling.ts` (`BOT_COMMANDS` gains `{ command: "review", description: "Label a sample of recent mail" }` before `help`), `channels/texts.ts` (`helpText` gains `/review – label a random sample of recent mail`), `channels/commands.ts` (`runCommand` case and `reviewMessage`), `CommandDeps` (gains `testMail: TestMailRule`), `apps/server/src/main.ts` (fills it), the Telegram runtime if it maps text to `CommandName`, `apps/server/test/integration/channels-commands.test.ts`.

**Interfaces.**

```ts
export async function reviewMessage(deps: CommandDeps, link: LinkedChat): Promise<OutMessage> {
  // 1. flag: isFeatureOn(deps.db, ctx, "review_command") → else REVIEW_OFF_TEXT
  // 2. mailboxes: the organization's mailboxes, as the digest lists them (listMailboxes) → none: "No mailbox."
  // 3. seed = `${link.chatId}:${now.toISOString()}`; listForReview(deps.db, ctx, { mailboxIds, now, seed, testMail: deps.testMail })
  // 4. renderReviewPage with the time zone the digest uses for this user (see buildDigestMessage)
}
```

The suspended-org wrapper in `createUpdateHandlers` already refuses every command but `help`; keep it.

**Decisions.** D1, D4, D6.

**Test** (integration, fake channel and the existing command test helpers, fixed `now`):

1. Flag off → `REVIEW_OFF_TEXT`, no buttons, no feedback row.
2. Flag on (`setOrgFeature`), 3 unlabelled real mails → a page with 3 items; a fourth mail with a label and a fifth from a test sender are not on it.
3. Flag on, all mails labelled → `REVIEW_EMPTY_TEXT`.
4. Suspended org → the paused text (the existing wrapper).
5. Tap `vr:<code>:<id>` from the page of case 2 → one `triage_feedback` row `source = 'review'`; the same tap again → no new row (`skipIfSame`).
6. Org B's chat with the flag on sees none of org A's mail.
7. `BOT_COMMANDS` holds `review` and `helpText()` holds `/review` (unit).

**Check.** `bun test apps/server/test/integration/channels-commands.test.ts apps/server/test/integration/channels-callbacks.test.ts apps/server/src/modules/channels/`

**Done when.** Cases 1–7 pass.

**Out of scope.** A scheduled review reminder. The `\Answered` part of review (E3a).

## Step 3 — Capability pages

**Goal.** The pages list the command and the flag (PD-009, plan fact F19).

**Files.** `docs/capabilities/digest-and-notices.md`: rule 9 (commands) gains `/review` (flag `review_command`, up to 10 unlabelled real mails of the last 30 days in a random order, AI summary only, taps write `source = 'review'`); the Entry points commands row gains `/review`; the `commands.ts` function row gains `reviewMessage`. `docs/capabilities/tenancy-and-plans.md`: rule 5 (~line 31, "No code outside the CLI reads a flag yet: `isFeatureOn` has no caller in the server") and § Limits (~line 93, "No flag has a reader in the server yet (rule 5). The registry has three flags: …"): both say that `review_command` has a reader in `channels/commands.ts` and list every flag of the registry at your commit (do not hard-code a count from this file). `docs/capabilities/triage.md` rule 10 (feedback sources, ~line 40) gains the `/review` page, and rule 12 (feedback rows) one sentence that `review` rows are the random sample for unbiased metrics (E3a). Keep the "Checked against" lines.

**Check.** `bun test apps/server/src/capability-map.test.ts && bunx prettier --check docs/capabilities/digest-and-notices.md docs/capabilities/tenancy-and-plans.md docs/capabilities/triage.md`

**Done when.** The three pages carry the lines; the test passes.
