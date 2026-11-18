# F120 stage 04 — Retention, DSR, export [risky]

Part of [`../plan.md`](../plan.md). Decisions D6, D11, D14, PD-106.

Carry-over reads: `docs/capabilities/account-data.md` rules 7–13, `docs/capabilities/retention.md`, `apps/server/src/retention.ts` (`runOrg`, `clearers`), `modules/privacy/dsr-match.ts`, `erase.ts`, `export-map.ts`, stage 02–03 code.

## Step 1 — retention

- Goal: two clearers in `contacts`, called from `runOrg` and counted in `retention_org_done` (`profile_rows`, `suggestion_rows`):
  - `deleteOldProfiles`: rows with `last_seen_at < now − 365 days` (also a row whose `last_seen_at` is null and `refreshed_at` older than 365 days).
  - `deleteEndedSuggestions`: rows not `open` with `ended_at < now − 90 days`; and `open` rows older than 30 days become `expired`, `pattern = null`, `ended_at = now` first (D11; the stage 05 pass also expires them).
- Retention runs whatever the flags say: data stays covered after a flag goes off.
- Test (`contacts-retention.test.ts`):
  1. Profile `last_seen_at` 366 days ago → deleted; 364 days → kept.
  2. Suggestion dismissed 91 days ago → deleted; 89 days → kept (it still hides the key).
  3. Open suggestion 31 days old → `expired`, `pattern` null; 29 days → open.
  4. Org B rows untouched by the run of org A.

## Step 2 — DSR find and erase

- Goal: `org:dsr --find` prints `sender profiles <n>` and `sender suggestions <n>`; `--erase` deletes every `sender_profiles` row whose `key_hash = senderKeyHash(key, orgId, address)` in all mailboxes of the org, and every `sender_suggestions` row with that address key or with `pattern = address`. A domain suggestion (`@acme.pl`) does not match an address erase: it names a domain, not the person (default, Q5). The find report lists only address rows.
- Lock (D8): before it deletes profile rows, the erase takes `pg_advisory_xact_lock(profileLockKey(mailboxId))` (blocking) for each mailbox of the org, in mailbox id order, inside its transaction. A running pass finishes first; a pass that starts later skips while the erase holds the lock, and its next run reads the mail after the erase.
- The erase writes the counts `sender_profiles`, `sender_suggestions` into the audit data (flat counts, as rule 13; the DSR exception of plan.md § Rules).
- A later refresh can write the row again from mail that the erase kept (the erase deletes the person's mail that goes; mentions stay). That is accepted: the profile then counts only mail that still exists. Write this in the capability page (stage 12).
- Test (`privacy-dsr-sender-context.test.ts`):
  1. Profiles of `anna@acme.pl` in mailboxes M1 and M2 → find counts 2; erase deletes both; the row of `bob@acme.pl` stays.
  2. An open VIP suggestion with `pattern = anna@acme.pl` → erased.
  3. Org B row of the same address → untouched.
  4. Audit row holds counts and `address_hash`, never the address.
  5. All mail of `anna@acme.pl` goes in the erase → a refresh pass after it writes no row for her.
  6. A domain suggestion `@acme.pl` → not erased by the erase of `anna@acme.pl`.
  7. Race: a pass holds the lock on connection 1 after its read; the erase starts on connection 2 and waits; the pass commits; the erase then deletes the row → after both, no row of `anna@acme.pl`. A second variant: the erase holds the lock; a pass on connection 1 returns `skipped`.

## Step 3 — export

- Goal: the org export gives each profile row with `address` = the plain address whose `senderKeyHash` equals `key_hash`, looked up among the distinct addresses of `emails.from_address_lower`, `sent_emails` To and Cc, `sender_rules` patterns and `delegates.email` of the org; else `address: null`. Suggestions export whole.
- Test (`privacy-export-sender-context.test.ts`):
  1. A row whose address is still on a mail → `address` set.
  2. A row whose mails are past retention and no rule names it → `address: null`, counts present.
  3. The export map completeness test passes.

## Done when

All tests pass; mutations: remove the org filter from the erase delete → step 2 test 3 fails; remove the erase lock → test 7 fails. Then the Proof command. Checkpoint after this stage (plan.md § Owner checkpoints).
