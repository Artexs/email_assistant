# F100 stage 04 — Migration: capture, flags, action feedback

Part of [`../plan.md`](../plan.md). **[risky]**: a migration. Review job before the land. Coordinator step C1 (`bun run db:migrate` on the shared dev DB) after the land.

**Wait:** F097 stage 03 (feedback source `review`) must be on `master` before this job starts: both change `triage_feedback_source_check`. Check: `grep -rn "'review'" db/migrations/` finds F097's migration. If it does not, stop and say so in the final message.

After this stage the database has the three tables of D1 and accepts the feedback source `answered_check`. No code writes them yet (stages 05, 06, 13, 15).

## Step 1 — The migration

**Goal.** The tables and the CHECK change of D1, with up and down.

**Files.** `db/migrations/<YYYYMMDDHHMMSS>_measure_capture.sql` (a timestamp later than every file in `db/migrations/`), `apps/server/src/platform/db/schema.ts` (only through `bun run db:types`).

**Interfaces.**

```sql
-- migrate:up
-- Captured headers of a stored mail (one row per mail). Text fields follow the mail body retention; counts and codes stay.
CREATE TABLE email_headers (
  email_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  from_name text CHECK (char_length(from_name) <= 200),
  reply_to text[] NOT NULL DEFAULT '{}' CHECK (cardinality(reply_to) <= 5),
  return_path text CHECK (char_length(return_path) <= 320),
  auth_results text CHECK (char_length(auth_results) <= 1000),
  list_unsubscribe text CHECK (char_length(list_unsubscribe) <= 1000),
  list_id text CHECK (char_length(list_id) <= 300),
  auto_submitted text CHECK (char_length(auto_submitted) <= 100),
  precedence text CHECK (char_length(precedence) <= 50),
  has_calendar boolean NOT NULL DEFAULT false,
  attachments jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(attachments) = 'array'),
  attachment_count integer NOT NULL DEFAULT 0 CHECK (attachment_count >= 0),
  links jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(links) = 'array'),
  link_count integer NOT NULL DEFAULT 0 CHECK (link_count >= 0),
  parts_known boolean NOT NULL,
  captured_at timestamptz NOT NULL,
  texts_cleared_at timestamptz,
  FOREIGN KEY (email_id, org_id) REFERENCES emails (id, org_id) ON DELETE CASCADE
);
CREATE INDEX email_headers_retention_idx ON email_headers (org_id, captured_at) WHERE texts_cleared_at IS NULL;

-- IMAP flags of a stored mail, refreshed by the sync run; the first time each flag was seen; the answered check of /review.
CREATE TABLE email_flags (
  email_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  seen boolean NOT NULL,
  answered boolean NOT NULL,
  flagged boolean NOT NULL,
  first_seen_at timestamptz,
  first_answered_at timestamptz,
  first_flagged_at timestamptz,
  checked_at timestamptz NOT NULL,
  answered_check text CHECK (answered_check IN ('yes', 'no')),
  answered_check_at timestamptz,
  answered_check_by uuid REFERENCES users (id) ON DELETE SET NULL,
  CHECK ((answered_check IS NULL) = (answered_check_at IS NULL)),
  FOREIGN KEY (email_id, org_id) REFERENCES emails (id, org_id) ON DELETE CASCADE
);
CREATE INDEX email_flags_answered_open_idx ON email_flags (org_id) WHERE answered AND answered_check IS NULL;

-- Reject reasons and "this was a mistake" marks on actions (serious-mistake metric).
CREATE TABLE action_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  action_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reject_reason', 'mistake')),
  reason text CHECK (reason IN ('wrong_person', 'wrong_content', 'not_needed')),
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  via text NOT NULL CHECK (via IN ('telegram', 'web', 'cli')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((kind = 'reject_reason') = (reason IS NOT NULL)),
  UNIQUE (org_id, action_id, kind),
  FOREIGN KEY (action_id, org_id) REFERENCES actions (id, org_id) ON DELETE CASCADE
);

-- Labels from the answered check of /review get their own source.
ALTER TABLE triage_feedback DROP CONSTRAINT triage_feedback_source_check;
ALTER TABLE triage_feedback ADD CONSTRAINT triage_feedback_source_check
  CHECK (source IN ('cli', 'telegram', 'undo', 'imap_move', 'web', 'review', 'answered_check'));

-- migrate:down
DELETE FROM triage_feedback WHERE source = 'answered_check';
ALTER TABLE triage_feedback DROP CONSTRAINT triage_feedback_source_check;
ALTER TABLE triage_feedback ADD CONSTRAINT triage_feedback_source_check
  CHECK (source IN ('cli', 'telegram', 'undo', 'imap_move', 'web', 'review'));
DROP TABLE action_feedback;
DROP TABLE email_flags;
DROP TABLE email_headers;
```

Before you write it: confirm in your job DB that `emails` and `actions` have a unique `(id, org_id)` (other tables reference it; `pg_constraint` query in a throw-away test under `/tmp/f100-s04/`) and that the source CHECK name and list match F097's migration. If a name differs, use the real one and say so. Then `bun run db:migrate` and `bun run db:types`; commit `schema.ts`.

**Decisions.** D1, D2, D5, D6, D21, D22.

**Test.** Step 2.

**Check.** `bun run db:migrate && bun run db:rollback && bun run db:migrate` — write the last lines of each to `/tmp/f100-s04/migrate.log`.

**Done when.** The three commands run clean; `schema.ts` has `EmailHeaders`, `EmailFlags`, `ActionFeedback`.

**Out of scope.** `outbox.kind` (stage 16); repository functions (stages 05, 06, 13, 15).

## Step 2 — Core list and schema tests

**Goal.** The code knows the new source; the constraints hold as written.

**Files.** `packages/core/src/triage/categories.ts` (`feedbackSources` gains `"answered_check"` after `"review"`), `packages/core/src/triage/settings.test.ts`, `apps/server/test/integration/measure-schema.test.ts` (new), any `switch` over `FeedbackSource` that `bun run typecheck` names (for example a web label of the source in `packages/core/src/web/activity.ts` or `apps/web`: add an `en.ts` key "Answered check" if the web shows sources).

**Interfaces.** `feedbackSources = ["cli", "telegram", "undo", "imap_move", "web", "review", "answered_check"] as const`.

**Decisions.** D1, D22.

**Test** (`measure-schema.test.ts`, each case in `withRollback`; two orgs from `createOrgWithMailbox`; mails with `insertTestEmail`):

1. Insert an `email_headers` row for org A's mail with org A → ok; the same mail id with org B's `org_id` → foreign-key error.
2. `email_headers` with `reply_to` of 6 entries → check error; `from_name` of 201 chars → check error; `attachments = '{}'::jsonb` → check error.
3. `email_flags` with `answered_check = 'yes'` and `answered_check_at` null → check error; `answered_check = 'maybe'` → check error.
4. `action_feedback` kind `reject_reason` with reason null → check error; kind `mistake` with reason `wrong_person` → check error; two rows `(org, action, reject_reason)` → unique error.
5. Deleting the mail deletes its `email_headers` and `email_flags` rows; deleting the action deletes its `action_feedback` rows (cascade).
6. `triage_feedback` with `source = 'answered_check'` → ok; `source = 'other'` → check error.
7. `delete_mailbox(org, mailbox)` (the existing function) removes the new rows of that mailbox's mail.
8. Unit: `settings.test.ts` expects the 7 sources in this order.

**Check.** `bun test packages/core/src/triage/settings.test.ts apps/server/test/integration/measure-schema.test.ts`

**Done when.** Cases 1–8 pass.

**Out of scope.** Retention of the new texts (stage 05).

## Done when (stage)

Steps 1–2 done; the Proof command of `plan.md` passes (`/tmp/f100-s04`).
