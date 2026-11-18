# F118 stage 02 — push devices migration: notes for the next worker

Ticket: `spec/features/active/F118-e9b-phone-channel-pwa-push-telegram-detail/` (stage 02). Migration: `db/migrations/20261118130001_push_devices.sql`.

## What stage 02 built

- Table `push_subscriptions` (D3), column `outbox.push_subscription_id` (D4), outbox channel `push`, column `memberships.notice_routes` (D7). Up, down and up again ran on the job DB (log `.f118s02-logs/migrate-updownup.log`, an untracked folder in the job worktree).
- Repository `apps/server/src/modules/channels/push/repo.ts`, exported by `channels/push/index.ts`: `upsertPushSubscription`, `listLiveDeviceIds`, `listDeviceViews`, `loadDeviceSecret`, `removeDevice`, `markPushSuccess`, `markPushError`, `pushDedupKey`, `endpointHash`, `MAX_DEVICES_PER_USER`, `PushDeviceElsewhereError`.
- Fail code `no_device` in `outboxFailCodes`; log field `push_subscription_id`.
- The flag `web_push` (default off, epic E9, remove-by 2027-06-01) is in `packages/core/src/features.ts` with all its registries (the job instruction asked for it here). **Stage 03 must not add it again**; its stage file says it adds the flag.
- Data maps: export map (`push_subscriptions` with `secret`, `endpoint_hash`, `key_version` excluded), address map (`NOT_PERSONAL`), data category `push-devices`, records of processing (record A), claims row, delete-test seed, rls list, lab seed list, flagged-text reason, architecture and account-data pages.

## Deviations from the stage file (all small; each has a reason)

1. **Composite FK on the outbox column.** `FOREIGN KEY (push_subscription_id, org_id) REFERENCES push_subscriptions (id, org_id) ON DELETE SET NULL (push_subscription_id)`, not a single-column FK. The job instruction asks for composite keys; a push row cannot point at a device of another organization (test 7). It needs `UNIQUE (id, org_id)` on the table.
2. **`-- contract: v0.2.1` line in the migration.** `db:check-migrations` reads the two table constraints on the new outbox column as `add_constraint` (contract) findings. They refuse nothing that the previous release writes. The mark only silences the check. Test 15 of `push-devices-schema.test.ts` pins this: without the mark the check finds exactly two `add_constraint` and nothing else, and the Up part holds no `DELETE`, `UPDATE`, `INSERT` or `TRUNCATE`.
3. **Stage test 3 ("delete the membership → outbox rows keep with a null device") cannot hold.** The outbox row of a member has the same `(org_id, user_id)` and cascades with the membership (existing FK). The test now checks: a removed membership takes the devices of that organization only (the same user's device in another organization stays), and a removed device (not a removed member) leaves its outbox rows with a null device (test 8).
4. **Export map uses `byOrgExcluding`, not `secret(...)`.** The export holds the label, the session id and the times (the member's own data) and leaves out `secret`, `endpoint_hash` and `key_version`. The test `privacy-export.test.ts` plants a secret and a hash and checks that neither is in the file.
5. **One device row per user and endpoint, across organizations.** The unique key is `(user_id, endpoint_hash)` as in the plan. A user with memberships in two organizations who subscribes the same browser in the second one gets `PushDeviceElsewhereError` (the row of the first organization is invisible to the second under RLS). Stage 03 must map it to an answer. If the product wants one device per organization, change the key to `(org_id, user_id, endpoint_hash)` in a later migration.
6. **A secret that does not open removes the device** (`loadDeviceSecret`, as the stage says). A key rotation therefore removes every device whose `key_version` differs from the configured one. Stage 08 and the key rotation docs must know this.

## Things the next worker must know

- `TERMS_HISTORY` needs one new line before the land: see `questions-stage-02-terms-version.md` in the ticket folder (exact line and digest). The worker did not bump it (instruction).
- The land order is F120 stage 02 first. A local merge of the F120 branch conflicts in six files (all "both sides append": `apps/docs/src/flagged-text.ts`, `apps/server/src/modules/lab/seed.ts`, `apps/server/test/integration/tenancy-features.test.ts`, `apps/server/test/integration/web-operator.test.ts`, `packages/core/src/features.ts`, `docs/legal/claims.md`). Keep both sides: F120 entries first, `web_push` and `push-devices` after them. In `claims.md` take the F120 file, add the `push-devices` row after the F120 `sender-context` row (it becomes C177), renumber the later rows by one, update the counts table (data-category registry 14 rows C164 to C177, records C178 to C190, DPIA C191 to C220, breach C221 to C242, total 242) and add `push-devices` to the row "Record A lists the categories". The worker did this in a working tree, ran 13 integration files (163 pass, 0 fail, log `.f118s02-logs/f120-merge-check-int.log`) and the legal unit files, then aborted the merge.
- After the land of stage 02: `bun run db:migrate` on the shared dev DB (owner step).
- Stage 03 carry-over from the stage 01 review: `decodeBase64Url` refuses padded base64url; the device API must not add padding.
- A new device is never live until its `session_id` is set to an unexpired session: `listLiveDeviceIds` joins `auth_sessions` on both `id` and `user_id`.
