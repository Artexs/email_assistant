FAIL 22ba2c44deeed78f939039641e9d51d796e38bed

I reviewed commit `22ba2c44d`. It is the tip of `limen/2026-11-20-f122-stop-using-the-old-style-te-eda7d152`, and `git rev-parse HEAD` matches it. The work is in `f86308103`, followed by two merges of master. I diffed against master `9b3e980d9`.

The code, the migration and the privacy maps are sound. One acceptance bullet of the stage fails: two capability pages still describe the old signature fallback.

## Blocking

**B1. Two capability pages still say the signature falls back to `organizations.style_text`.** Proven by reading. The stage's "Done when" names `reply-drafts.md` and `drafts-and-send.md`. Each must say that the signature lives only in the mailbox profile and that the next release drops the column.
- `docs/capabilities/reply-drafts.md:16` was not changed. It still says "The profile falls back as `resolveReplyStyle` says (D13): the signature to the old organization `style_text`, then the owner name". The code now does profile, then owner name (`packages/core/src/replies/profile.ts:74`).
- This page never says that the column is dropped next. Line 71 says "The signature lives only here" but does not name the drop.
- `docs/capabilities/drafts-and-send.md:299` still says "`organizations.style_text` is the signature." That contradicts rule 2 of the same page (line 16), which the candidate rewrote.
- Fix: rewrite line 16 of `reply-drafts.md` to "the signature to the owner name", and add the drop of the column. Delete or rewrite the last sentence of `drafts-and-send.md:299`. No code change is needed.

## Unverified

- **The worker's `check:job` result:** I did not see the worker's final message, so I cannot say whether it passed at this tip. Per the review rule, I ran no suite, lint or typecheck.
- **The migration on a real DB:** I read it and its test file but did not run either.

## The check that would prove this candidate wrong

Drop the column on the job's DB, as stage 05 will. Then run the stage-04 integration tests that read `organizations`:

```
psql "$MIGRATOR_DATABASE_URL" -c 'ALTER TABLE organizations DROP COLUMN style_text'
bun test apps/server/test/integration/privacy-export.test.ts apps/server/test/integration/web-organization.test.ts apps/server/test/integration/replies-profile-routes.test.ts
```

A failure there means the code of this release does not run on the stage-05 schema. That is the swap and rollback case of plan review B1. I did not run this.

## Verified by reading (not blocking)

- **The copy migration** (`db/migrations/20261120100001_style_text_copy.sql`):
  - **What it does:** the UPDATE fills a profile signature that is NULL or blank, and only for an organization whose text is not blank. The INSERT makes a row only where none exists (`NOT EXISTS`). Both trim the text and cut it to 1000 characters with `left(...)`, so the copy meets the profile CHECK. Then every organization text becomes NULL.
  - **Idempotent:** a second run matches nothing, because `style_text` is NULL after the first run.
  - **Down part:** empty, with a forward-only comment.
  - **RLS:** the `tenant_rows` policy is `TO app` (`20261117130001_reply_drafts.sql:71`). The migrator role does not get it, which is the same pattern as the F115 copy. The INSERT takes `org_id` from `mailboxes`.
  - **Same text for old code:** the old fallback was profile, then trimmed org text, then owner name. The migration writes that same trimmed text into the profile. So during the swap window, and after a rollback, the old code reads NULL from the column and sends the same signature.
  - **Old panel during the swap:** it cannot write the column. The organization card was read-only, as the removed e2e asserts showed; only a raw API call could write it.
  - **Contract rules:** the migration holds no statement that the contract-check rules (`check-migrations-rules.ts`) flag.
- **The `rg` scan matches stage 04 Step 2, test 6.** `style_text|styleText` occurs only in these places:
  - `schema.ts`
  - the two privacy exclusions: `address-map.ts:286` and `export-map/tables-n-s.ts:47`, each with its reason
  - the 400 test at `web-organization.test.ts:174`
  - `style-text-copy-migration.test.ts`
  - `reply-drafts-schema.test.ts`
- **Export:** the `organizations` export now uses `byOrgExcluding`. `privacy-export.test.ts:306` pins the exact key list without `style_text`. The lab demo-seed export uses the same column list.
- **DSR erase:** `organizations.style_text` was already in `NOT_PERSONAL`, so the erase never wrote to it; only the reason text changed. The copied text now sits in `mailbox_profiles.signature`, which the erase covers (`erase.ts:33`). That is a privacy gain.
- **Organization delete:** no migration function names the column.
- **`PATCH /api/organization`:** `organizationPatchSchema` is now `strictObject`, so `{ styleText }` gives 400 `validation`. A timezone-only patch gives 200, and the 200 body holds only `id`, `name`, `retentionDays` and `timezone`. The audit kind `org.style_changed` stays (`audit/repo/events.ts:53`).
- **Fallback signature:**
  - `profileFallbacks` now returns signature = name, which is the owner name, else the address. The unit test uses "Wiktor Szalewski".
  - For `buildOutgoingMessage`, a null or blank profile signature gives the owner name, and "Anna" gives "Anna".
  - In the routes test, `fallbackSignature` is "Owner".
- **Expand, then contract:** no code of this release selects the column by name. The `selectAll` / `returningAll` reads on `organizations` still work after a drop. Stage 05 still waits for the release that carries stage 04.
- **Web texts:** `sig_title`, `rs_org_note`, `rs_org_old`, `rs_org_link`, `style_too_long` and `style_bad_char` are gone from both `en` and `pl`, and nothing else uses them. `sig_counter` stays, because the style card still uses it. `SignatureCard.tsx`, its tests and its e2e asserts are deleted. The docs-site page `apps/docs/.../settings.mdx` is updated.
- **Other docs:** the changes in `tenancy-and-plans.md`, `web-panel.md` and `architecture.md` are correct.

## Notes

- **N1 (plausible): old demo seeds no longer import.** A demo seed exported before this release has the key `organizations.style_text`. `checkDemoSeed` (`lab/demo-seed/format.ts:52`) now refuses it with `bad_seed`, and the format name `ea-demo-seed/1` did not change. No seed file is committed, and I found none on this machine. The likely impact is one re-export. Options: say so in `live-lab.md`, or drop unknown excluded keys on import.
- **N2 (plausible, low): the migration can fail if a profile is saved at the same moment.** The INSERT uses `NOT EXISTS` with no `ON CONFLICT (mailbox_id) DO NOTHING`. The old code is live while the migration runs. If an owner saves a first profile for a mailbox in that moment, the migration fails on the primary key and the release stops. A re-run then works. Adding `ON CONFLICT DO NOTHING` closes the gap.
- **N3 (proven by reading): stale comments in the web code.**
  - `apps/web/src/components/settings/ReplyStyleCard.tsx:43` and `:349` still mention "the organization signature card" and its links. The `#style-card` scroll code may now have no caller.
  - The title of the test at `apps/web/src/i18n/reply-style.test.ts:91` still says "read-only card".
- **N4 (plausible): an open old tab breaks until reload.** An old web bundle parses `/api/organization` with `styleText: z.string().nullable()` as a required key. After the swap, a tab that is already open fails that parse until the page reloads.
- **N5 (proven by reading): stage test 5, "a DSR erase runs with no statement on the column", has no new test.** The behaviour did not change, because the column was already in `NOT_PERSONAL`, so I do not count this as a gap.
- **N6 (proven by reading): the idempotency test cannot catch a weak guard.** Test 4 of the migration tests passes because the first run sets `style_text` to NULL. It would not see a missing guard on the UPDATE or the INSERT. The statements are correct as written.

## Checks I ran

- `git rev-parse HEAD`: `22ba2c44deeed78f939039641e9d51d796e38bed`, a match.
- `git log` and `git diff 9b3e980d9 HEAD` (67 files).
- `rg -n "style_text|styleText|..."` over `apps`, `packages`, `scripts`, `tools` and `docs`, as listed above.
- `rg` for the deleted i18n keys: none are left.
- Reads of `db/migrations`, the privacy export map and its kinds, `address-map.ts`, `erase.ts`, the lab demo-seed format, `check-migrations-rules.ts` and the changed tests.

I ran no `bun` command, no test, no lint and no typecheck.

## Note check

- **Migration (copy, insert, null; idempotent; empty down; safe with old code):** proven by reading `db/migrations/20261120100001_style_text_copy.sql` and `apps/server/test/integration/style-text-copy-migration.test.ts`. This is not runtime proof; a run of the test file is unverified.
- **No read or write of the column outside the allowed files:** not proven by a command. My `rg` calls used `|` or `;`, so Limen cannot count them. The files I read that hold the allowed uses: `apps/server/src/modules/privacy/export-map/tables-n-s.ts`, `apps/server/src/modules/privacy/address-map.ts` and `apps/server/src/platform/db/schema.ts`.
- **Export, DSR, delete, 400 and fallback:** proven by reading `apps/server/test/integration/privacy-export.test.ts`, `apps/server/test/integration/web-organization.test.ts` and `packages/core/src/replies/profile.ts`. This is not runtime proof; no test ran.
- **Docs and en/pl texts:** proven, and the result is a failure. `docs/capabilities/reply-drafts.md` (line 16) and `docs/capabilities/drafts-and-send.md` (line 299) contradict the new behaviour. This is blocking finding B1.

## Easy-to-miss rule

- **"Run no suite": followed.** Only `git`, `rg`, `sed`, `ls`, `find` and `cat` ran. No `bun` command ran.

## Project reminders

- **Tests once per job, no `test:*` runs:** followed. No test ran.
- **`check:job` for a product-code job:** not applicable. This review commits no code.
- **A review runs no suite, lint or typecheck:** followed.
- **Never delete `node_modules/.cache/`:** followed. I deleted nothing.

## Decisions for the owner

none
