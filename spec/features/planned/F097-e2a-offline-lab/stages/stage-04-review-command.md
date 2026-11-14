# F097 stage 04 — `/review` command (F028)

Part of [`../plan.md`](../plan.md). Review job before the land (user-visible command, tenant filter). Coordinator steps C2 and C3 (deploy, flag on for the pilot) after the land.

After this stage a linked Telegram chat can send `/review` and get up to 10 unlabelled recent real mails in a seeded random order, each with ✅ / ✏️ buttons that record `source = 'review'`, when the flag `review_command` is on for its organization (D4, D5, D6). Source: `spec/features/dropped/2026-11/F028-telegram-review-command/plan.md`.

Shared file: `channels/callbacks.ts` is also edited by F088 stage 05 and F030 (plan § How to run 3). Merge `master` before your proof if one of them landed during your job.

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

Page text: first line `Review: ${n} ${n === 1 ? "mail" : "mails"} without a label (random sample of the last 30 days). Tap ✅ when the AI category is right, ✏️ to correct it.`; then per item a block like a digest item (reuse `categoryTag`, `senderLabel`, `cleanSubject`, `cutText`, `formatClock` from the digest helpers; do not copy them), numbered `1.` … Buttons: one row per item, `[✅ n]` (only when `isLabelCategory(category)`) with `review_right`, `[✏️ n]` with `review_edit`. The whole message ≤ `MESSAGE_MAX_CHARS`: drop items from the end until it fits (as `renderDigest` does). No mail body: the page shows the AI summary (`aiText`) only, as the digest does (ADR 0005).

**Decisions.** D4, D5, D6.

**Test** (unit, `review.test.ts`; `now = 2026-11-20T12:00:00Z`, `timeZone = "Europe/Warsaw"`):

1. 0 items → `REVIEW_EMPTY_TEXT`, no buttons.
2. 2 items (`info`, `unsure`) → header says `2 mails`; item 1 has buttons `vr:i:…` and `ve:…`; item 2 (`unsure`) has only `ve:…`.
3. 10 items with 400-char summaries → text length ≤ 4096 and the button rows match the items kept.
4. `featureFlags.review_command.default === false` and `epic === "E2a"` (the registry test in `features.test.ts` already checks the patterns).

**Check.** `bun test packages/core/src/digest/review.test.ts packages/core/src/features.test.ts`

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
