# F106 plan review 1 (job 2026-11-14-f106-plan-review-9ebb6f2c, claude-opus-5-5, candidate 33a6f706)

Filed whole: the job's final message.

FAIL 33a6f7061b5fd4db9e4db33c9cec530ebecfaf12

Verdict: FAIL. There is one blocking gap. Erase leaves the erased mail's data in Telegram outbox rows that have no `email_id`, and the stage 06 pattern does not remove a cut-short address. The rest of the plan is sound: the size is within limits, and most code facts hold at HEAD. The other findings are notes.

HEAD check: `git rev-parse HEAD` = 33a6f7061b5fd4db9e4db33c9cec530ebecfaf12. This matches the candidate.

## Blocking

**B1 — Erase leaves the person's data in digest (and similar) outbox rows.** Label: proven, by reading the code and by a probe.
- **Where the data stays.** Digest outbox rows have no `email_id`, so deleting the mail does not cascade to them:
  - `apps/server/src/modules/channels/digest-job.ts:52-60`: `queueNotice` is called with `digestId` and `view: { text, buttons }`, and no `emailId`.
  - The digest text holds the sender, the subject and the AI text of each mail: `apps/server/src/modules/reports/digest.ts:107-128` and `packages/core/src/digest/digest.ts:114-117`.
- **Why scrubbing fails.** The sender in that text is cut to 40 characters: `packages/core/src/digest/text.ts:26-28` (`senderLabel` → `cutText(from, 40)`).
  - Probe `/tmp/f106rev/probe.ts`: `senderLabel("jan.kowalski-nowak.dzial.ksiegowosci@example-firma.test")` gives `"jan.kowalski-nowak.dzial.ksiegowosci@ex…"`.
  - The stage 06 pattern does not match that text (`regex match: false`).
- **Result.** After `--erase`, `outbox.text` and `outbox.view` of sent and pending digests still hold:
  - a cut-short form of the address,
  - the subject of the erased mail,
  - its AI summary.
- **Plan lines.** stage-06:37 ("Mentions … match by … text, json") and stage-08:32 (step 6, regexp_replace only) cover only an exact address match. This breaks D9 "other rows lose the address" (plan.md:101), and so plan Done when 5 (plan.md:118). Stage 08 test 11 (stage-08:54) does not catch it.
- **The same class of row:**
  - `approval_set` notices carry only the first mail's id (`channels/notices/approval-set.ts:52`).
  - `/review` lists (`packages/core/src/digest/review.ts:46`) use `senderLabel`.
- **Precedent at HEAD.** `delete_mailbox` already handles digests: it deletes pending ones and sets sent ones to `text='[removed]', view='{}'` (`db/migrations/20261114100002_rls_tenant_policies.sql:117-119`).
- **Decision needed.** Stage 06 must decide what happens to an outbox row whose `email_id` is NULL but that names an erased mail. Options: blank or drop it as `delete_mailbox` does, or remove the items whose `emailId` is in the erased set. Add a stage 08 test with an address longer than 40 characters in a digest.

## Unverified

- F3: the `age-encryption` 0.3.1 facts and npm date. No network here; I did not check them.
- F5: the Postgres look-behind behaviour. No DB in this job; I did not run it.
- I ran no test suites. The candidate is a plan, with no code diff.

## Notes

**N1 — Two rules conflict: the audit data shape.** Label: proven, by reading the code.
- `apps/server/src/modules/audit/repo.ts:8-9`: `AuditData = Record<string, string | number | boolean | null>`, with the comment "no nested objects".
- The plan sets `dsr.find` and `dsr.erase` data to `{ address_hash, counts }`, and `counts` is the nested `DsrCounts` (stage-02:26, stage-07:14, stage-07:29, stage-08:33).
- `org.exported` `{ tables, rows }` (stage-05:52) is unclear: are these counts or `Record<string, number>`?
- As written, the stage 07 and 08 Proof fails typecheck. The worker must guess: flatten the data, or widen a shared type. Pin a flat shape, for example `mails`, `mentions`, `listed_delegates`, `listed_sender_rules`, `open_actions`, `tombstones`.

**N2 — Two rules conflict: the address in CLI stdout.** Label: proven, by reading the text.
- plan.md:126: CLI tests "assert that no test address … appears" in stdout.
- stage-02:49 prints `change the password of <address>`, and plan.md:109 (D17) allows it.
- Add the `org:delete` stdout exception to the rule.

**N3 — Two rules conflict: `users` excluded columns in the export.** Label: proven, by reading the text.
- stage-05:23 excludes every other `users` column "with a reason", for example `email_verified`, `image`, `updated_at`.
- stage-05:25 says "Excluded columns: only a column that holds a secret".
- Pick one rule.

**N4 — Gap: form mail with Reply-To.** Label: plausible.
- D9 (stage-06:36) erases a mail only when the person is the sender, or the only other party in to/cc.
- A contact-form mail (`From: noreply@site`, `Reply-To: p`, the body is the person's message) is kept. Only the address is scrubbed; the person's name, phone and message text stay.
- `reply_to` is captured (`modules/mail/imap/capture.ts:136`).
- Decide: does `reply_to` = the person (alone) count like the sender?

**N5 — Gap: the tombstone is per organization, but D9 is per mailbox.** Label: plausible, an edge case.
- D3 (plan.md:96) keys the tombstone by organization. D9 (stage-06:36) decides per mailbox M ("every other address is M's own address").
- If the same mail (the same dedup key) goes in M1 and stays in M2 (for example a Bcc to M2), the next rescan of M2 skips the kept copy: a kept mail is lost. A wrong row is removed.
- Fix: use the organization's own addresses in D9, or tombstone per mailbox plus a per-organization check.

**N6 — Gap: the sync planning phase runs without the lock.** Label: plausible, a race.
- `planChunk` (`modules/mail/sync.ts:218-300`) reads copies and picks `copyDedupKey(base, n)` (`sync-rules.ts:136`, `:162`) before `applyChunk` takes `lockSyncFolder` (`sync.ts:316`).
- A chunk planned before the erase commits can insert `base#2` after it. Only the exact erased keys are tombstoned (stage-01:22-23).
- The stage-08:28 claim "no chunk runs between match and commit" covers apply only, not planning.
- Cheap fix: hash the base key with the `#n` suffix stripped, in the trigger and in `tombstoneKeyHash`.

**N7 — Gap: the seam with F104.** Label: plausible; F104 is not built.
- F104 adds its own table `sent_emails`, with its own upsert (F104 plan.md:29, D1; seam S6 at :192).
- D18 (plan.md:110) only asks for the column classification. Neither the tombstone (a trigger on `emails` only, stage-01:22) nor D9 covers Sent rows. Sent mail to an erased person could be stored again by the Sent rescan.
- Name in D18 which ticket extends the trigger, or the erase rule, to `sent_emails`.

**N8 — Gap: backup restore.** Label: plausible; no decision.
- `deploy/README.md:551` handles sessions after a real restore, but nothing re-applies org deletes or erases done after the backup.
- The org delete removes its own audit rows (D15), and a restore rolls back `dsr_tombstones`. So no record survives that the operator could replay.
- Decide on a ledger outside the organization (deleted org ids, tombstone key hashes), or a runbook step (stage-09:41).

**N9 — `blocked` erase: the fact is known now, but there is no next step.** Label: proven fact.
- `actions` FKs `depends_on_action_id` and `reverses_action_id` have no ON DELETE action (`db/migrations/20261104000001_triage.sql:94-95`). So stage 08 test 9 gives `blocked` (23503). It is not the open question that plan.md:90 and stage-08:52 leave it as.
- The runbook (stage-09:41) has no step for `blocked`, so the operator cannot finish the request in one month.

**N10 — A step a Sonnet worker must guess: reuse of the sign-in failure path.** Label: proven, by reading the code.
- stage-03:16 says "Reuse the sign-in failure path; do not copy it".
- That path is the private `countSignIn` (`platform/auth.ts:247-276`). It is tied to `HookContext`, `deps.onEvent` (the `report` callback) and `deps.sendLockoutMail`.
- Name the exported function that the route and the hook share, and its deps.

**N11 — Export file writing.** Label: plausible.
- stage-05:51 checks that `path`/`path.part` exist, then writes, then renames. A plain `rename` overwrites a `path` that appears in between.
- Require create with O_EXCL (`wx`) and no-clobber at the end (`link` then `unlink`).

**N12 — An `approval_set` row cascades with its first mail.** Label: plausible.
- `approval-set.ts:52` sets `emailId: first.email_id`. If the erased mail is first, the cascade deletes the set notice of approvals for mails that are kept.

**N13 — The runbook omits Telegram.** Label: note.
- stage-09:41 tells the owner that the mailbox copy and the backups stay. It does not say that the Telegram messages already sent (digests, urgent notices) stay in the chat.

**N14 — After the delete, the login notice can be lost.** Label: plausible.
- A `/api/me` poll that gets 401 runs `location.assign('/login?next=…')` (`apps/web/src/lib/api.ts:55`, `:68`). It can race the 200 handler of stage-04:15.
- Showing the list whenever `ea.deleted_mailboxes` exists makes the notice independent of `?deleted=1`.

**N15 — Small items.** Label: note.
- The Better Auth 2FA attempt rows (`2fa-attempts-*`, value `"0"`) stay after a delete. They hold no user link, so this is harmless.
- `OPERATOR_USER_IDS` can point to a user that the delete removed.

## Pre-mortem: which stage let the bug through

- **Data left after a delete:** stage 01 is complete for all `org_id`/`user_id` tables and `auth_verifications` value = user id. The leftovers are the restore gap (N8, stage 09) and harmless 2FA attempt rows.
- **Data left after an erase:** stages 06 and 08 (B1 digests, N4 Reply-To).
- **Data leaked in an export:** stage 05. No leak found (skip list and secrets are correct); there is a file-write race (N11).
- **Erased mail re-imported:** stages 01 and 08 (N6 race, N7 the `sent_emails` seam).
- **Address in a log:** stages 02, 07, 08. The rule conflict N2 can make a worker strip the required stdout.
- **Wrong row erased:** stage 06 (N5 per-organization tombstone against the per-mailbox rule) and stage 08 (N12 approval set).

## Code facts checked and found true

- **F1:** `insertEmail` returns false on 0 rows (`modules/mail/repo/emails.ts:31-38`).
- **F4:** `verifyPassword` is a server endpoint with the session middleware, and gives `INVALID_PASSWORD` (`node_modules/better-auth/dist/api/routes/password.mjs:167-198`, version 1.7.18).
- **F7:** `insertEmail` is the only `emails` insert (grep).
- **Backfill takes the folder lock:** it goes through `applyChunk` and `lockSyncFolder` (`sync.ts:641-646`), so the "stop and ask" condition of stage-08:28 does not occur.
- **RLS:** an unset scope admits every row (`20261114100002_rls_tenant_policies.sql:1-13`), so the trigger sees tombstones in jobs and CLIs.
- **Verification rows:** the trusted-device and 2FA rows have value = user id (`better-auth/dist/plugins/two-factor/index.mjs:317-349`).
- **Session cookie:** prefix `ea` (`platform/auth.ts:381`); no cookie cache.
- **Lockout:** 10 failures in 15 minutes (`platform/auth-lockout.ts:6-8`).
- **Security log actor:** `cli` maps to operator (`modules/tenancy/security-log.ts`, `actorOf`).
- **Suspended delete:** S6a S2 allows "delete organization" when suspended (`spec/features/done/2026-11/F077-s6a-customer-core/plan.md:75`).
- **FK rules:** every FK to `users` is CASCADE or SET NULL (migrations grep).
- **Primary keys:** every table has one (export batches by PK work).
- **Folders and tests:** F078, F082 and F098 are in done. `org-cli.test.ts`, `rls-policy.test.ts`, `web-suspended.test.ts` and `web-helpers.ts` exist.
- **Size:** `wc -w` gives plan.md 1490 and stages 387–699, all within § Plan size. No stage is too big for one job; stage 05 (dependency, map, writer, CLI) is the fullest.

## Checks run

- `git rev-parse HEAD` → 33a6f7061b5fd4db9e4db33c9cec530ebecfaf12.
- `bun install --frozen-lockfile` with Bun 1.4.4 (= `.bun-version`) → 967 packages installed.
- `bun /tmp/f106rev/probe.ts` (the `senderLabel` and pattern probe) → `"jan.kowalski-nowak.dzial.ksiegowosci@ex…" false`, `regex match: false`.
- `wc -w plan.md stages/*.md` → the counts above.
- I ran no lint, typecheck or test suite: the candidate holds no code.

## Note check

- Every finding cites file and line, checked against code at HEAD 33a6f70: proven. Each finding above names its file and line. Summary file: `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-14-f106-plan-review-9ebb6f2c/review-draft.md`. Probe: `/tmp/f106rev/probe.ts`.
- The pre-mortem names the stage for each bug class (delete leftover, export leak, re-import, address in a log, wrong row): proven. See § Pre-mortem above; the summary file is `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-14-f106-plan-review-9ebb6f2c/review-draft.md`.
- The first line is `PASS <sha>` or `FAIL <sha>`, with a verdict: proven. The first line of this message is `FAIL 33a6f7061b5fd4db9e4db33c9cec530ebecfaf12`; the same line is in `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-14-f106-plan-review-9ebb6f2c/review-draft.md`.
- Easy-to-miss rule ("missing code detail is not a finding"): followed. Each finding names a missing decision, edge case, interface, test or rule conflict (B1, N1–N15). None names missing line numbers or edit text.
