# F100 stage 13 — The answered check in `/review`

Part of [`../plan.md`](../plan.md). Review job before the land (labels that feed M1 and `eval --real`).

**Wait:** stages 06 and 10 of this ticket and F097 stage 04 (`/review`, `reviewMessage`) must be on `master`. Check: `grep -n "reviewMessage" apps/server/src/modules/channels/commands.ts`. If missing, stop and say so. Not next to stage 12 (same callback files).

After this stage, with the flags `review_command` and `answered_check` on, `/review` also lists up to 5 recent mails that the user answered (`\Answered`) but the assistant put in "other mail", and asks "Did they need a reply?" with Yes / No buttons (D22). Yes writes a `needs_reply` label with source `answered_check`; No only records the answer.

## Step 1 — Core: flag, callbacks, block renderer

**Goal.** The pure parts (D22, D26).

**Files.** `packages/core/src/features.ts` (+ test), `packages/core/src/digest/callback.ts` (+ test), `packages/core/src/digest/answered-check.ts` (new) + test, `packages/core/src/digest/index.ts`.

**Interfaces.**

```ts
// features.ts
answered_check: {
  default: false,
  description: "In /review: mails you replied to that the assistant did not mark 'needs reply'.",
  epic: "E3a",
  removeBy: "2027-03-01",
},

// callback.ts
| { kind: "answered_yes"; emailId: string } // ay:<uuid>
| { kind: "answered_no"; emailId: string }  // an:<uuid>
// isFeedbackCallback stays `"emailId" in callback`; the channels handler routes these two kinds before the feedback kinds.

// answered-check.ts
export const ANSWERED_CHECK_LIMIT = 5;
export interface AnsweredItem { emailId: string; category: Category; from: string | null; subject: string | null; receivedAt: Date }
/** The block appended to the /review page. [] items → null (no block). */
export function renderAnsweredCheck(items: readonly AnsweredItem[], opts: { now: Date; timeZone: string }): OutMessage | null;
/** The page and the block in one message ≤ MESSAGE_MAX_CHARS: drops block items from the end until it fits; none left → the page alone. */
export function withAnsweredCheck(page: OutMessage, items: readonly AnsweredItem[], opts: { now: Date; timeZone: string }): OutMessage;
```

Block text: first line `You replied to ${n} ${n === 1 ? "mail" : "mails"} that the assistant did not mark "needs reply". Did ${n === 1 ? "it" : "they"} need a reply?`; then per item `${i}. ${categoryTag(category)} · ${senderLabel(from)}` and `cleanSubject(subject)` (reuse the digest helpers; numbering starts at 1 in the block). Buttons: one row per item `[✅ Yes ${i}]` (`ay:`) `[➖ No ${i}]` (`an:`). In `withAnsweredCheck` the page text, a blank line, then the block text; buttons = page buttons, then block buttons.

**Decisions.** D22, D26.

**Test** (unit):

1. `ay:<id>` ↔ `{ kind: "answered_yes", emailId }`, `an:<id>` ↔ `answered_no`; byte length ≤ 64; old prefixes parse as before.
2. 2 items → text starts `You replied to 2 mails`, 2 button rows with data `ay:…`/`an:…`; 0 items → `renderAnsweredCheck` null and `withAnsweredCheck` returns the page unchanged.
3. A page of 4,000 chars and 5 items → result ≤ 4,096 chars; the buttons match the items kept.
4. `featureFlags.answered_check.default === false`, epic `E3a`.

**Check.** `bun test packages/core/src/digest/ packages/core/src/features.test.ts`

**Done when.** Cases 1–4 pass.

**Out of scope.** The server parts.

## Step 2 — Candidates, the answer service, the command and the taps

**Goal.** `/review` appends the block; a tap writes the answer in one transaction (D22).

**Files.** `apps/server/src/modules/mail/repo/flags.ts` (`setAnsweredCheck`), `apps/server/src/modules/triage/answered-check.ts` (new: candidates reader and service) + `triage/index.ts`, `apps/server/src/modules/channels/commands.ts` (`reviewMessage`), `apps/server/src/modules/channels/answered-taps.ts` (new: the tap handler and its answer texts; `callbacks.ts` only routes the two kinds to it), `apps/server/src/modules/channels/callbacks.ts`, `apps/server/test/integration/triage-answered-check.test.ts` (new), `channels-commands.test.ts`, `channels-callbacks.test.ts`.

**Interfaces.**

```ts
// mail/repo/flags.ts — only while answered_check IS NULL (the first answer wins). True when it wrote.
export async function setAnsweredCheck(
  trx: DbOrTrx, ctx: TenantContext, emailId: string, input: { answer: "yes" | "no"; userId: string; at: Date }
): Promise<boolean>;

// triage/answered-check.ts
export const ANSWERED_CHECK_WINDOW_MS = 14 * 24 * 3_600_000;
/** Real mail of the mailboxes, received ≥ since, email_flags.answered, latest category info|notification|spam,
 *  no triage_feedback row, answered_check null; oldest received first. */
export async function listAnsweredCandidates(
  db: DbOrTrx, ctx: TenantContext, q: { mailboxIds: readonly string[]; since: Date; limit: number; testMail: TestMailRule }
): Promise<AnsweredItem[]>;
/** The same filter, counted over all mailboxes of the organization (the weekly report line, stage 14). */
export async function countAnsweredWaiting(db: DbOrTrx, ctx: TenantContext, q: { since: Date; testMail: TestMailRule }): Promise<number>;

export type AnsweredResult = { kind: "yes" } | { kind: "no" } | { kind: "already" } | { kind: "not_found" };
/** One transaction: setAnsweredCheck; on "yes" also recordFeedback({ trueCategory: "needs_reply", source: "answered_check", userId, skipIfSame: true }). */
export async function answerAnsweredCheck(
  db: Db | Transaction<DB>, ctx: TenantContext, input: { emailId: string; answer: "yes" | "no"; userId: string; now: Date }
): Promise<AnsweredResult>;
```

- `not_found`: no `email_flags` row of this organization for the mail. `already`: `setAnsweredCheck` wrote nothing.
- `reviewMessage` (F097): after it builds the page, when `isFeatureOn(db, ctx, "answered_check")` is also on, `listAnsweredCandidates({ mailboxIds: <the same mailboxes>, since: now − 14 days, limit: ANSWERED_CHECK_LIMIT, testMail: deps.testMail })` and return `withAnsweredCheck(page, items, …)`. With `review_command` off nothing changes (the off text).
- Callbacks: `answered_yes` / `answered_no` (any linked member, as the review taps): `answerAnsweredCheck(… userId: link.userId)`; answers: `yes` → `Saved: it needed a reply.`; `no` → `Saved: no reply needed.`; `already` → `Already answered.`; `not_found` → `NOT_FOUND_TEXT`. No message edit (the page holds several items).

**Decisions.** D18, D22.

**Test.**

1. Candidates (integration): mails with `email_flags.answered` true and categories `info`, `needs_reply`, `spam`; one with a feedback row; one with `answered_check = 'no'`; one received 20 days ago; one synthetic; one of org B → only the `info` and `spam` mails of org A, oldest first; `countAnsweredWaiting` → 2.
2. `answerAnsweredCheck(yes)` → `email_flags.answered_check = 'yes'` and one `triage_feedback` row (`source = 'answered_check'`, `verdict = 'wrong'`, `true_category = 'needs_reply'`); again → `already`, no second row.
3. `answerAnsweredCheck(no)` → `answered_check = 'no'`, no feedback row; then `yes` → `already`.
4. Org B's context with org A's mail → `not_found`.
5. `/review` with both flags on and 2 candidates → one message whose text holds the page and `You replied to 2 mails`, and whose buttons include `ay:` and `an:`; with `answered_check` off → no block.
6. A tap `ay:<id>` → the `yes` answer text and the rows of case 2; the M1 reader (`listTruthRows`, stage 10) then reports this mail with `truth: "needs_reply"`, `truthSource: "answered_check"`.

**Check.** `bun test apps/server/test/integration/triage-answered-check.test.ts apps/server/test/integration/channels-commands.test.ts apps/server/test/integration/channels-callbacks.test.ts`

**Done when.** Cases 1–6 pass; `bun run graph:modules` ran if a new import edge appeared.

**Out of scope.** The E5a "answered by the user" mark (seam S4); a web view of the check.

## Done when (stage)

Steps 1–2 done; the Proof command of `plan.md` passes (`/tmp/f100-s13`).
