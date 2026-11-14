# F097 stage 03 — Review source, review sample, review callbacks

Part of [`../plan.md`](../plan.md). **[risky]**: the one migration of this ticket, and new button data. Review job before the land. Coordinator step C1 (`bun run db:migrate` on the shared dev DB) after the land.

After this stage the database accepts `triage_feedback.source = 'review'`, one repository query returns a seeded random page of unlabelled real mail of an organization, and four new callback kinds encode and parse the review buttons. Nothing calls them yet (stage 04).

## Step 1 — Migration and the source list

**Goal.** `review` is a feedback source (D3).

**Files.** `db/migrations/<YYYYMMDDHHMMSS>_feedback_source_review.sql` (a timestamp later than every file in `db/migrations/`), `packages/core/src/triage/categories.ts`, `packages/core/src/triage/settings.test.ts`, `apps/server/src/platform/db/schema.ts` (only through `bun run db:types`; it may not change, the column is `text`).

**Interfaces.**

```sql
-- migrate:up
-- Labels from the Telegram /review page (a random sample) get their own source, so metrics can tell them from digest taps.
ALTER TABLE triage_feedback DROP CONSTRAINT triage_feedback_source_check;
ALTER TABLE triage_feedback ADD CONSTRAINT triage_feedback_source_check
  CHECK (source IN ('cli', 'telegram', 'undo', 'imap_move', 'web', 'review'));

-- migrate:down
ALTER TABLE triage_feedback DROP CONSTRAINT triage_feedback_source_check;
ALTER TABLE triage_feedback ADD CONSTRAINT triage_feedback_source_check
  CHECK (source IN ('cli', 'telegram', 'undo', 'imap_move', 'web'));
```

First confirm the constraint name in your job DB with a throw-away integration test in `/tmp/f097-s03/` or a temporary case that runs `SELECT conname FROM pg_constraint WHERE conrelid = 'triage_feedback'::regclass AND contype = 'c'` and prints the names (never print `.env` or a DB URL). Postgres names an inline column CHECK `<table>_<column>_check`. If the name differs, use the real name and say so in the final message.

`feedbackSources = ["cli", "telegram", "undo", "imap_move", "web", "review"] as const`.

Then `bun run db:migrate` (your job DB) and `bun run db:types`; commit `schema.ts` only if it changed.

**Decisions.** D3.

**Test.**

1. `settings.test.ts`: the list test expects the 6 values in this order.
2. Integration (`apps/server/test/integration/triage-feedback.test.ts`): `recordFeedback(trx, ctx, { emailId, trueCategory: "info", source: "review" })` writes a row with `source = 'review'`; an insert with `source = 'other'` through raw Kysely fails with a check violation.

**Check.** `bun run db:migrate && bun test packages/core/src/triage/settings.test.ts apps/server/test/integration/triage-feedback.test.ts`

**Done when.** Both cases pass; `bun run db:rollback && bun run db:migrate` runs clean in the job DB (write both outputs' last lines to `/tmp/f097-s03/migrate.log`).

**Out of scope.** Any other column or table.

## Step 2 — `listReviewSample`

**Goal.** One query returns the review page: unlabelled, triaged, real mail of the last 30 days of the given mailboxes, in a seeded random order (D4).

**Files.** `apps/server/src/modules/triage/review-repo.ts` (new; `triage/repo.ts` is 629 lines, over the 400-line rule, so it does not grow: plan D38; import `UnlabeledResult` and the helpers it needs from `./repo`), `triage/feedback.ts` (a service wrapper that adds summaries, like `listForLabeling`), `triage/index.ts`, `apps/server/test/integration/triage-review-sample.test.ts` (new).

**Interfaces.**

```ts
export const REVIEW_PAGE_SIZE = 10;
export const REVIEW_WINDOW_DAYS = 30;

// repo: one row per mail (its latest triage result), no feedback row, real mail only (D1 rule), received in the window.
// Order: md5(email_id::text || seed), then email_id. Filters org_id on emails, triage_results and triage_feedback.
export async function listReviewSample(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { mailboxIds: readonly string[]; since: Date; seed: string; limit: number; testMail: TestMailRule }
): Promise<UnlabeledResult[]>;

// service (feedback.ts): the same rows as LabelItem[] with summaries, like listForLabeling.
export async function listForReview(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { mailboxIds: readonly string[]; now: Date; seed: string; testMail: TestMailRule }
): Promise<LabelItem[]>; // since = now − 30 days, limit = REVIEW_PAGE_SIZE
```

Build the order with `sql<string>\`md5(${sql.ref("triage_results.email_id")}::text || ${input.seed})\`` (a bound parameter, never string concatenation). An empty `mailboxIds` returns `[]` without a query.

**Decisions.** D1, D4.

**Test** (integration, fixed `now = 2026-11-20T12:00:00Z`, two orgs made with `createOrgWithMailbox` from `apps/server/test/integration/fixtures.ts` (the `createTwoTenants` helpers in other test files are private), org A one mailbox with 14 triaged mails received 2026-11-01 … 2026-11-14 at 09:00Z; mail 3 has a feedback row; mail 5 is from `t@agentmail.test` with rule `{ senders: ["t@agentmail.test"] }`; mail 7 has a synthetic Message-ID; mail 1 was received 2026-10-15 (outside the window); org B has 3 triaged unlabelled mails):

1. `seed = "s1"`, limit 10 → 10 rows, none of mails 1, 3, 5, 7, none of org B.
2. The same call twice → the same ids in the same order.
3. `seed = "s2"` → the same set of eligible mails (10 of the 10 eligible: mails 2, 4, 6, 8–14) but the test asserts only that the order differs from `s1` for these fixed seeds (pin the two orders in the test after the first run; md5 is stable).
4. Limit 3 → 3 rows, the first 3 of case 1's order.
5. Org B's context with org A's mailbox id → `[]`.
6. A mail with two triage results → one row, with the latest result's category.

**Check.** `bun test apps/server/test/integration/triage-review-sample.test.ts`

**Done when.** Cases 1–6 pass.

**Out of scope.** The command and the page text (stage 04).

## Step 3 — Review callback kinds

**Goal.** Review buttons carry their own kinds, so a tap records `source: "review"` (D5).

**Files.** `packages/core/src/digest/callback.ts`, `callback.test.ts`, `packages/core/src/digest/index.ts` if exports change.

**Interfaces.**

```ts
// The review page may also confirm or pick `delegation` (code `d`): without it a delegation mail could never leave the review sample.
export const reviewLabelCategories = [...labelCategories, "delegation"] as const;
export type ReviewLabelCategory = (typeof reviewLabelCategories)[number];

export type FeedbackCallback =
  | … the five existing kinds …
  | { kind: "review_right"; category: ReviewLabelCategory; emailId: string }  // vr:<code>:<uuid>
  | { kind: "review_pick"; category: ReviewLabelCategory; emailId: string }   // vc:<code>:<uuid>
  | { kind: "review_edit"; emailId: string }                            // ve:<uuid>
  | { kind: "review_cancel"; emailId: string };                         // vx:<uuid>

export function isReviewCallback(c: Callback): boolean; // the four kinds above
```

The regexes `WITH_CODE` and `WITHOUT_CODE` gain the prefixes; the review prefixes accept the codes `u r i n s d` (`d` = `delegation`), the old prefixes keep `u r i n s` only (`fr:d:…` still parses to `null`). `isFeedbackCallback` stays `"emailId" in callback` (true for the new kinds). The longest value stays 41 bytes.

`apps/server/src/modules/channels/callbacks.ts` must keep compiling: map each review kind to the same branch as its plain kind with a `source` variable (`"review"` for the review kinds, `"telegram"` for the others), and the review picker's buttons use `review_pick` / `review_cancel` so the whole flow stays `review`. The review picker offers the six `reviewLabelCategories` (the digest picker keeps its five). The pick edit keeps today's `pickedText(category, aiCategory, saved)` (F030). `callbacks.ts` is 393 lines: the review picker and the kind-to-source helpers go into a new `apps/server/src/modules/channels/review-taps.ts`, and `callbacks.ts` gets only the dispatch lines (plan D38). F098 stages 09 and 11 edit `callbacks.ts` too (tap texts): if `packages/core/src/texts/index.ts` exists, every new text follows plan D39.

**Decisions.** D5.

**Test** (unit, `callback.test.ts`; `id = "11111111-2222-4333-8444-555555555555"`):

1. `encodeCallback({ kind: "review_right", category: "info", emailId: id })` → `vr:i:${id}`; `parseCallback` of it → the same object.
2. The same round trip for `review_pick` (`vc:s:…`), `review_edit` (`ve:…`), `review_cancel` (`vx:…`).
3. `parseCallback("vr:z:" + id)` → `null`; `parseCallback("vq:" + id)` → `null`; `parseCallback("vr:d:" + id)` → `{ kind: "review_right", category: "delegation", … }`; `parseCallback("fr:d:" + id)` → `null`.
4. Every old prefix still parses to its old kind (keep the existing cases green).
5. Byte length of every encoded review callback ≤ 64.

Integration (`apps/server/test/integration/channels-callbacks.test.ts`, one new case): a `vr:` tap on a triaged mail writes one `triage_feedback` row with `source = 'review'` and `verdict = 'right'`; a `ve:` tap answers with a picker whose buttons start with `vc:` and `vx:` and include `vc:d:` (delegation); a `vc:d:` tap writes `true_category = 'delegation'`, `source = 'review'`.

**Check.** `bun test packages/core/src/digest/callback.test.ts apps/server/test/integration/channels-callbacks.test.ts`

**Done when.** All cases pass.

**Out of scope.** The `/review` command.

## Step 4 — Capability pages

**Goal.** The pages list the new source and the new prefixes (PD-009, plan fact F19).

**Files.** `docs/capabilities/triage.md`: § Data, the `triage_feedback.source` list gains `review`; § Entry points, the Telegram callbacks row gains `vr:`, `vc:`, `ve:`, `vx:`; § Tests gains `apps/server/test/integration/triage-review-sample.test.ts`. `docs/capabilities/digest-and-notices.md`: rule 10 (callback prefixes) and the Entry points callbacks row gain `vr vc ve vx` with one line on what they do (the review page of stage 04 uses them; `vr:d:` and `vc:d:` accept `delegation`). Keep the "Checked against" line.

**Check.** `bun test apps/server/src/capability-map.test.ts && bunx prettier --check docs/capabilities/triage.md docs/capabilities/digest-and-notices.md`

**Done when.** Both pages carry the lines; the test passes.
