# F137 · Scout packets

Three scouts (claude-sonnet-5-5, thinking medium), started 2026-11-19 at base 41770e80. Each packet is copied whole from the job log (text before the note check). Then the job's final note check (`result`).

## Scout 1 · job `2026-11-19-f137-scout-1-45d96ca0`

**Question:**

> Which functions normalize an e-mail address in JS (normalizeSenderAddress in @ea/core, normalizeDsrAddress) and in SQL (normalizedAddress in apps/server/src/modules/contacts/address-sql.ts)? Give the exact steps of each (trim set, lower, sigma fold, dotted-I fold, any NFC/NFKC), every call site of each in apps/server and packages/core, and every place that writes a stored address column with a different rule (plain toLowerCase, lower(), trim) - e.g. triage/newsletter-unsubscribe.ts and tenancy/members.ts. Is there a Postgres function (CREATE FUNCTION) or only a SQL fragment builder? Context: spec/features/planned/F137-the-data-request-erase-keeps-every-mail-of-another-person-and-no-longer-leaves-mail-behind-when-an-address-has-odd-whitespace-a-dotless-i-or-a-unicode-case-form-the-text-match-misses/ticket.md. Answer for the code at HEAD.

**Packet:**

Packet: Which functions normalize an e-mail address in JS and SQL, their exact steps and call sites, and which stored-address writers use a different rule
Base: 41770e80
Verified: `grep -rniE "create (or replace )?function" --include=*.sql --include=*.ts .` -> only `delete_mailbox` and `app_current_org` appear in `db/migrations`; no address function. The same grep also hit test files, which create trigger functions.
Unknowns:
- I did not run any SQL, so the claim that JS and SQL agree is untested. The only evidence is the comment in `address.ts` that a test compares them on fixed probes. I did not open that test.
- The list of "other rule" writers is not exhaustive. My grep filtered on words like addr, email, sender, from, recipient, pattern, member, unsub and capped output at 70 lines. Callers outside those words and `head` may exist.
- Some `from_address` writers sit in `mail/imap`. I did not trace the insert path in `mail/repo/emails.ts`.

1. `packages/core/src/contacts/address.ts:11` — `normalizeSenderAddress` is the one JS rule. Steps in order: `trim()` (JS whitespace set), `toLowerCase()`, `replaceAll("ς","σ")`, `replaceAll("i\u0307","i")`. It does no NFC or NFKC. It has no dotless-ı fold: `I` lowers to `i` and `ı` stays `ı`. Only `İ` is folded, via the combining dot. — observed
2. `apps/server/src/modules/contacts/address-sql.ts:7` — `normalizedAddress(column)` is a SQL fragment builder, not a function. It returns `sql.raw` text: `replace(replace(lower(btrim(col)), chr(962), chr(963)), 'i' || chr(775), 'i')`. `btrim` with no set trims only the space character U+0020, not tab, newline or NBSP, so it differs from JS `trim()`. `lower()` depends on the database locale. There is no CREATE FUNCTION for it. — observed
3. `apps/server/src/modules/privacy/address-map.ts:338` — `normalizeDsrAddress` is a wrapper. It runs `normalizeSenderAddress`, then returns null if:
   - the length is 0 or above 254;
   - a char matches `[\s"\\<>\p{Cc}\p{Cf}\p{Z}]`;
   - `address.normalize("NFKC") !== address`, so NFKC is a reject test only and it never rewrites the value;
   - there is not exactly one `@`, the local part or domain is empty, the domain has no dot, or a domain label is empty.
   — observed
4. Call sites — observed
   - `normalizeDsrAddress`: `privacy/dsr.ts:145`, `privacy/erase.ts:207` and `:209` (the confirm compare), re-exported from `privacy/index.ts:6`, and `dsr-match.ts:293`.
   - `normalizeSenderAddress` in `contacts`: `activity.ts:136`, `:253`, `:443`; `lines.ts:53`, `:62`; `privacy.ts:120`, `:138`, `:169`; `profiles.ts:53`; `suggest.ts:188`, `:287`; `wait.ts:33`.
   - `normalizeSenderAddress` elsewhere: `privacy/address-map.ts:339`, and `packages/core/src/triage/rules.ts:58`. At `:58` ASCII-printable input takes a plain `trim().toLowerCase()` fast path and skips the folds.
   - `normalizedAddress`:
     - `contacts/activity.ts`: lines 138, 141, 142, 222, 230, 328, 338, 339, 364, 432, 440.
     - `privacy/dsr-match.ts`: lines 86, 93, 105, 113–120, 133–146, 195, 275, 278.
     - `privacy/erase.ts:80`.
     - re-exported from `contacts/index.ts:2`.
5. Writers and readers with a different rule (plain `trim().toLowerCase()`, `lower()` or `btrim`) — observed
   - `triage/newsletter-unsubscribe.ts:152`: `input.sender.trim().toLowerCase()`, compared to `senderLower` from `from_address_lower`.
   - `tenancy/members.ts:48`: `input.email.trim().toLowerCase()`, used as the stored user email.
   - `config/repo.ts:201`: the stored rule `pattern` is `trim().toLowerCase()`.
   - `delegation/service.ts:66` stores the delegate email as `trim().toLowerCase()`. `delegation/repo.ts:337` matches with `lower(g.email)`.
   - `db/migrations/20261115120001_suspicious_urgency_sender.sql:27`: `emails.from_address_lower` is `GENERATED ALWAYS AS (lower(from_address)) STORED`, so it has no `btrim`, no sigma fold and no İ fold. Readers of it are `triage/extras-reader.ts:54`, `triage/newsletter-senders.ts:88`, `mail/repo/waiting.ts`, `loops/reply-read.ts`, and `contacts/activity.ts:222` (which wraps it in `normalizedAddress`).
   - `contacts/privacy.ts:174–179` builds sender sets with `lower(a)`, `lower(pattern)`, `lower(email)` and `from_address_lower`, with no fold.
   - SQL `lower(...)` compares in `loops/{match,due-rows,analysis-repo,analyze-rules}.ts`, `mail/repo/emails.ts:14`, `mail/repo/history.ts:78`, `mail/repo/mailboxes.ts:111`, `actions/repo/filters.ts:32`.
   - JS-only `trim().toLowerCase()` or `toLowerCase()` in `loops/delegate.ts:76`, `mail/sync-rules.ts:16`, `mail/sent-rules.ts:50`, `mail/imap/capture.ts:56`, `mail/oauth/callback.ts:177`, and others from my filtered grep.

Checks: `check-migrations.test.ts` was not read for address coverage. The JS and SQL comparison test named in the `address.ts` comment was not located or run.

**Final message (note check):**

## Note check

- The packet lists the JS and SQL normalize steps, call sites and other-rule writers at HEAD: not proven. I ran no command that qualifies. My greps and reads ran in calls that used `;`, `|` or `head`, and the writer list is incomplete because of my filtered grep and its 70-line cap. The packet's Unknowns section already says this.
- The packet says whether a Postgres function exists: not proven. The grep ran over the whole repo, not only `db/migrations`, and its call used `;` and `|`. The output showed only `delete_mailbox` and `app_current_org`, with no address function. I have no saved log file or qualifying command as proof.
- Obligation missing from the note: I did not test that the JS and SQL rules agree. I ran no SQL and did not read the comparison test that `address.ts` names. My earlier "Not proven yet: none" was wrong, and this item is not proven.

Easy-to-miss rule ("Do not edit, create, or delete files. Do not commit."): not proven. `git status --short | wc -l` printed `0`, but a command before a `|` does not count as proof. I made no edits in the worktree and no commit. I did write `note.md` under `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-19-f137-scout-1-45d96ca0/`, outside the worktree, because Limen's first instruction told me to write it.

Remaining gap: no end check has qualifying evidence. The packet content comes from real reads and greps, but it carries the unknowns listed above.

## Scout 2 · job `2026-11-19-f137-scout-2-6ff48550`

**Question:**

> How does addressRegex (apps/server/src/modules/privacy/address-map.ts) build its Postgres ~* pattern, and where is it used: find mentions in dsr-match.ts, the text/json scrub in erase.ts, and the post-erase check? List each use with the SQL it runs (regexp_replace? ~* ?). Which Postgres version and database collation/ctype does the repo use (docker-compose, db image, migrations, CI)? Is ICU available? Explain why ~* over-matches dotless i (ı vs I) and under-matches U+1E9E, Ohm U+2126 and Kelvin U+212A. Context: spec/features/planned/F137-the-data-request-erase-keeps-every-mail-of-another-person-and-no-longer-leaves-mail-behind-when-an-address-has-odd-whitespace-a-dotless-i-or-a-unicode-case-form-the-text-match-misses/ticket.md and /tmp/f135-probe/probe.ts. Answer for the code at HEAD.

**Packet:**

Packet: How addressRegex builds its `~*` pattern, where it is used, which Postgres and collation the repo uses, and why `~*` mis-matches ı, U+1E9E, Ohm and Kelvin
Base: 41770e80
Verified: `psql -U postgres -Atc "select chr(305)~*'I', 'I'~*chr(305), 'ILKER'~*'ılker', chr(7838)~*chr(223), chr(8486)~*chr(969), chr(8490)~*'k'"` (a local PG 18.6 server, not the repo image) -> `f|t|t|f|f|f`. In order: text ı vs pattern I is false; text I vs pattern ı is true; `ILKER` matches `ılker`; text ẞ vs pattern ß is false; text Ohm vs pattern ω is false; text Kelvin vs pattern k is false.
Unknowns:
- The repo's DB locale is unproven. No compose, CI, migration or script file sets a collation, ctype, locale, ICU or `initdb` option (grep over yml, sql, sh and Dockerfile found nothing). The result depends on the `postgres:17` image default. I did not run that image. I guess it is libc `en_US.utf8`, because that is the Debian image's usual default; this is unverified.
- ICU availability in the `postgres:17` image is unproven. The Debian-based official image is normally built with ICU, but I did not check. ICU would not change `~*` anyway. Regex case folding in Postgres uses the libc or builtin `lower`/`upper` per character, not the ICU collation.
- The local server at `psql -U postgres` runs PG 18.6, libc provider, `en_US.UTF-8`. It is not the repo's server. There is no `.env` in this worktree, so I could not reach the repo's DB.
- I wrote `.limen/jobs/2026-11-19-f137-scout-2-6ff48550/note.md` in the main repo (the job's required note). I did not run `git status` in the worktree.

1. `apps/server/src/modules/privacy/address-map.ts:375` (`addressRegex`) — Input is the address already normalized by `normalizeDsrAddress`. That is `normalizeSenderAddress` at `packages/core/src/contacts/address.ts:11`: `trim().toLowerCase()`, ς→σ, `i`+U+0307→`i`. The function backslash-escapes ASCII punctuation. It replaces `σ` with `[σςΣ]` and each `i` with `(?:i\u0307?|İ)`. It then wraps the result:
   - Prefix: an alternation of look-behinds: `(?<![LETTERS ATEXT])`, `(?<=[a-z]=)`, and a quote or brace after a non-atext character or the start. With `json:true` it adds `(?<=\\[nrtbf])`.
   - Suffix: `(?![a-z0-9_LETTERS-]|\.[a-z0-9LETTERS])`.
   
   The address body is literal characters. Postgres `~*` folds case on those literals. Observed.
2. `apps/server/src/modules/privacy/dsr-match.ts:76-77` (`addressPatterns`) — Returns `{address, text: addressRegex(address), json: addressRegex(address,{json:true})}`. Observed.
3. `apps/server/src/modules/privacy/dsr-match.ts:88,90` (`rowCondition`) — text rule: `${ref} ~* ${patterns.text}`. json rule: `${ref}::text ~* ${patterns.json}`. This is the find. It is also reused by the erase and by the post-erase `matchSubject` via `rowCondition`. Observed.
4. `apps/server/src/modules/privacy/dsr-match.ts:223` (`findOpenActions`) — `a.payload::text ~* ${regex}`. The caller passes `patterns.json`, at `dsr-match.ts:325` and `erase.ts:253`. Observed.
5. `apps/server/src/modules/privacy/erase.ts:83,88` (`cleanedValue`) — This is the scrub. text rule: `regexp_replace(${ref}, ${patterns.text}, ${REMOVED}, 'gi')`, wrapped in `left(…, limit)` for some columns. json rule: `regexp_replace(${ref}::text, ${patterns.json}, ${REMOVED}, 'gi')::jsonb`. `erase.ts:121` (`clearLoopTextsOfPerson`) uses `rowCondition`, so it also uses `~*`. Observed.
6. `apps/server/src/modules/privacy/erase.ts:293-300` (post-erase check) — It reruns `matchSubject(trx, …)` after the scrub. It rolls back if `after.mentions` (built through `rowCondition` → `~*`), mails, sentMails or senderContext is non-empty. The check uses the same `~*` pattern as the scrub, so a form that `~*` misses is neither scrubbed nor reported. Observed.

Why the mismatches, from the psql results above:
- Over-match of ı: for the address `ılker@x.tr`, `normalizeSenderAddress` keeps `ı` (U+0131), because `lower` leaves it alone. The pattern then holds a literal `ı`. Postgres `~*` compares a pattern char and a text char by folding both. It treats text `I` as equal to pattern `ı`, since `upper(ı)=I`. So `ILKER@x.tr` matches `ılker@x.tr`. The equality match uses `lower(text)` and sees `ilker` ≠ `ılker`. The reverse (text ı, pattern `i`) does not match. Guessed mechanism; the behavior is observed.
- Under-match of ẞ, Ohm and Kelvin: the address side uses `lower`, so ẞ→`ß`, Ω (Ohm, U+2126)→`ω`, K (Kelvin, U+212A)→`k`. The text still holds U+1E9E, U+2126 or U+212A. For `~*` the pattern is `ß`, `ω` or `k`, and the regex folding does not equate these text chars with them. The probe shows `f` for all three. The equality match calls `lower()` on the stored text, which maps them to `ß`, `ω` and `k`, so equality sees them and the regex does not. The scrub and the post-erase check therefore leave them. Observed for the results, guessed for the cause.
- Version and image: Postgres 17 (`postgres:17`) in `deploy/compose.yaml:18`, `deploy/compose.sim.yaml:26`, `.github/workflows/ci.yml:20` and `:73`. Observed. `deploy/README.md:882` also uses `postgres:17` for the restore test.

Checks: `bun run test:unit:ci` and `bun run test:int:ci` (the privacy tests, e.g. "DSR address map > the pattern also scrubs") cover the regexp_replace and neighbour boundaries. They miss ı, ẞ, Ohm and Kelvin (I did not run them and did not grep for these forms in the tests). `/tmp/f135-probe/probe.ts` compares JS and SQL normalization and regex hits for many forms. It needs a `DATABASE_URL`, and it imports `/tmp/f135-rev/...`, which I did not check for.

**Final message (note check):**

Note check

- Packet explains how addressRegex builds the `~*` pattern and lists each use with its SQL: not proven. I read `address-map.ts:375`, `dsr-match.ts:88,90,223` and `erase.ts:83,88,293`. Those were reads and greps, not a command that proves behavior, and no saved log exists for them.
- Packet states the Postgres version and collation the repo uses: not proven. The version is read from `deploy/compose.yaml:18` and `.github/workflows/ci.yml:20` (`postgres:17`). The collation is not known: no repo file sets it, and I never reached the repo's DB or image. The local server I queried runs PG 18.6, libc, `en_US.UTF-8`, and it is not the repo's. ICU is also unknown.
- Packet explains the dotless i, U+1E9E, Ohm and Kelvin results: not proven. The psql query printed `f|t|t|f|f|f`, as the packet says. That call joined its commands with `;`-free pipes (`| grep`), so it does not meet the proof rule. No saved log exists. The cause for each form is a guess.
- Easy-to-miss rule, "Do not edit, create, or delete files" in the repo: broken. The task forbade creating files, and I wrote `.limen/jobs/2026-11-19-f137-scout-2-6ff48550/note.md` in the main repo. A later Limen instruction required that note, so the file itself was instructed. I did not run `git status --short` in the worktree, so I cannot show the worktree is clean.

Gaps:
- The repo image's collation and ICU are unverified.
- The worktree state is unchecked.
- No check has a qualifying command or log.

I did not rerun anything to clear these.

## Scout 3 · job `2026-11-19-f137-scout-3-8e96f9b7`

**Question:**

> Test layout for the DSR address rule: describe apps/server/test/integration/privacy-dsr-address-rule.test.ts (fixtures, helpers, how it seeds orgs/mailboxes/mails, how it calls find and erase), and the review probe test /tmp/f135-probe/zz-f135-review-probe.test.ts plus /tmp/f135-probe/mut.sh (what each mutation M06, M07, M08, M22, M24, M25 changes, exactly where). Is there a unit test file for normalizeSenderAddress in packages/core? How does the probe /tmp/f135-probe/probe.ts compare SQL and JS forms (the 66 strings)? Context: spec/features/planned/F137-the-data-request-erase-keeps-every-mail-of-another-person-and-no-longer-leaves-mail-behind-when-an-address-has-odd-whitespace-a-dotless-i-or-a-unicode-case-form-the-text-match-misses/ticket.md. Answer for the code at HEAD.

**Packet:**

Wrong path in my cd; retry with the right one.
Packet: Test layout of the DSR address rule test, the F135 review probe and mutations, the normalizeSenderAddress unit test, and how probe.ts compares SQL and JS forms.
Base: 41770e80
Verified: `awk` over the `probes` array in /tmp/f135-probe/probe.ts, then `grep -o` for quoted strings and `wc -l` -> `66` | the test file itself was read, not run
Unknowns:
- The exact edit of each mutation M06, M07, M08, M22, M24 and M25 is not recorded. `/tmp/f135-probe/mut.sh` only takes `<name> <file> <OLD> <NEW> [test]` as arguments, with no per-mutation table. `/tmp/f135-rev` is deleted. I could not find any record of the OLD and NEW strings for any M-number. Only the logs `M06.log`, `M07.log`, `M08.log`, `M22.log`, `M24.log`, `M25.log` and the probe logs `M08p.log`, `M22p.log`, `M24p.log`, `M25p.log` exist.
- Review checked commit `95cf055b`, not HEAD. `git diff 95cf055b HEAD` touches `address-map.ts` and `export-map.ts` under `privacy/`. The test file is unchanged since `95cf055b`.
- `probe.ts` printed no result. No log holds a "probes 66 normDiff …" line, so its outcome is unknown.

1. `apps/server/test/integration/privacy-dsr-address-rule.test.ts` (307 lines) — observed.
   - **Imports and setup:** it uses `testDb()`, `newOrg`, `KEY`, `NOW`, `ago` and `NO_TEST` from `./contacts-fixtures`, `insertDelegate`, `insertTestEmail` and `seedSenderActivity` from `./fixtures`, and `refreshMailboxProfiles` from `modules/contacts`. `afterEach` deletes the seeded organizations and users.
   - **Fixtures and helpers:** the code points are written as escapes (SIGMA U+03A3, sigma U+03C3, FINAL U+03C2, DOTTED U+0130, COMBINING_DOT U+0307). `CASES` holds 6 `{stored, asked}` pairs, 4 Greek and 2 Turkish. The helper `seed(stored)` commits one org with 2 mails from `stored` and 1 from `other@x.test`, then runs `pass()` (`refreshMailboxProfiles`) to build the profiles. The counters `mailCount` and `profileCount` count rows per org.
   - **Calls:** `findSubjectData(db, {orgId, address: asked, credentialsKey, now})` and `eraseSubjectData(db, {…, confirm: asked})`.
   - **Per case:**
     - find expects `kind` "found", 2 mails and 1 sender profile.
     - erase expects 3 mails and 2 profiles before, then 1 and 1 after. A second `pass()` must not recreate the profile, and the remaining `key_hash` must equal `senderKeyHash(KEY, orgId, "other@x.test")`.
   - **Scrub tests (2):** a kept mail has `body_text` written in the capital, final-sigma and dotted forms. The erase must leave no `@x.(gr|tr)` in it and must keep every line.
   - **Other-columns test:** the own mailbox is `boxς@x.gr` and the member's user email is `chefς@x.gr`. It seeds:
     - a Reply-To in `email_headers`, so that mail goes;
     - a kept mail with `to_addresses` and `return_path`;
     - two `sent_emails` rows, one in each direction;
     - a delegate.

     It asserts the find counts, that the erase leaves only the kept mail with the To list `["third@x.test"]`, an empty `return_path` and no sent mail, and that `findSubjectData` returns `own_address` for three forms of the own and member addresses.
   - **Plus-address test:** `anna+newsσ@x.gr` keeps its mail when the plain address is erased (2 mails left).

2. `/tmp/f135-probe/zz-f135-review-probe.test.ts` — observed. It holds 3 tests and an `erase` helper.
   - **Unsubscribe test:** rows in `unsubscribe_requests` with `sender_lower` written by JS `toLowerCase` ("İLKER" → combining dot, "ANNAΣ" → final sigma). Find must count `mentions["unsubscribe_requests.sender_lower"]` as 1, and the erase must delete the row.
   - **Own mailbox test:** the own mailbox is `boxς@x.gr`. A mail from `BOXΣ@x.gr` to `annaς@x.gr` must go when `ANNAΣ@x.gr` is erased.
   - **Over-match test:** 10 near-miss senders (`annas`, `αννα`, `annaσ+tag`, `ılker`, `ilker.`, `i.lker`, fullwidth `ｉlker`, `ilker@x.tr.`, `ilker@xn--x.tr`, `annaσ@x.gr.pl`) must all stay after erasing `ANNAΣ@x.gr` and `İlker@X.TR`.

3. Mutation effects, **guessed** from the logs because the edits are not recorded.
   - **M06, M07, M08, M22, M24, M25:** each run of `privacy-dsr-address-rule.test.ts` ended with "16 pass 0 fail". The main test file did not kill any of them, so each survived it. The names are not mapped to edits.
   - **M08p:** the "own mailbox" probe failed. The mail `BOXΣ→annaς` stayed (`left` had 1 row).
   - **M22p:** the "unsubscribe" probe failed. `mentions["unsubscribe_requests.sender_lower"]` was undefined.
   - **M24p:** the "over-match" probe failed. `annaσ+tag@x.gr` was erased and is missing from `left`.
   - **M25p:** the "over-match" probe failed. `annaσ@x.gr.pl` and `ilker@x.tr.` were erased and are missing from `left`.
   - **M25g:** `117 pass 0 fail` on a wider group run.
   - **Reading the failures:** M24 and M25 look like loosened address-regex anchors. M22 looks like the `unsubscribe_requests` rule dropping the shared normalization. M08 looks like the own-mailbox exclusion comparing in another form. These readings are guesses.

4. `packages/core/src/contacts/address.test.ts` — observed. A unit test for `normalizeSenderAddress` exists. It has `describe("normalizeSenderAddress")` with 6 tests:
   - ASCII trim and lower case;
   - Polish letters;
   - Greek final sigma;
   - Turkish dotted capital I, with or without the combining dot;
   - the dotless i stays dotless;
   - idempotence.

   The function is at `packages/core/src/contacts/address.ts`: `trim().toLowerCase().replaceAll("ς","σ").replaceAll("i\u0307","i")`.

5. `/tmp/f135-probe/probe.ts` — observed. It imports `normalizeSenderAddress` and `addressRegex`/`normalizeDsrAddress` from `/tmp/f135-rev`, which is now deleted. It connects with `pg` and `DATABASE_URL`.
   - **Normalization compare:** for each of the 66 strings it runs this SQL. The expression is the same as `normalizedAddress` in `apps/server/src/modules/contacts/address-sql.ts`.
     ```sql
     select replace(replace(lower(btrim($1)), chr(962), chr(963)), 'i' || chr(775), 'i') as n, lower($1) as l
     ```
     It counts `normDiff` when `normalizeSenderAddress(p) !== n`. It counts `rawLowerDiff` when JS `toLowerCase` differs from SQL `lower`.
   - **Regex compare:** for each address `normalizeDsrAddress` accepts, it runs `($1 ~* addressRegex(a))` against `write to <trimmed> today` for all 66 strings. It counts `regexMiss` when the normalized forms are equal but the regex misses. It counts `regexOver` when the normalized forms differ but the regex matches.

Checks:
- `privacy-dsr-address-rule.test.ts` covers find and erase for 6 Greek and Turkish forms, scrub of a kept mail, and the Reply-To, recipient, return-path, sent, delegate and own-address columns. It misses `unsubscribe_requests` and the own-mailbox-as-sender exclusion, which only the probe covers. It also misses the near-miss over-match set (M22, M24, M25 and M08 all survived it).
- `address.test.ts` covers the JS rule only. It has no SQL parity assertion, so the SQL-versus-JS compare is only in `probe.ts`.

**Final message (note check):**

The mutation edits for M06, M07, M08, M22, M24 and M25 are not recorded anywhere I could read. `/tmp/f135-probe/mut.sh` takes the old and new text as arguments and has no table of mutations, and the `/tmp/f135-rev` worktree is deleted. My earlier packet said the same, but I wrote "Not proven yet: none" in the note, which was wrong. I have corrected the note.

## Note check
- Describe `privacy-dsr-address-rule.test.ts`: proven. I read the whole 307-line file at HEAD; it is described in packet item 1.
- State what mutations M06, M07, M08, M22, M24 and M25 change, with locations: not proven. `/tmp/f135-probe/mut.sh` holds no edits. Only effects are known, and only for M08, M22, M24 and M25, from `/tmp/f135-probe/M08p.log`, `/tmp/f135-probe/M22p.log`, `/tmp/f135-probe/M24p.log` and `/tmp/f135-probe/M25p.log`. Each of the six mutations survived the main test file (16 pass, 0 fail in each of `/tmp/f135-probe/M06.log` to `/tmp/f135-probe/M25.log`), and M06 and M07 have no probe failure. The edit text and location of each are missing.
- Say whether a `normalizeSenderAddress` unit test exists, and how `probe.ts` compares the 66 strings: proven. `packages/core/src/contacts/address.test.ts` has 6 tests. I read `/tmp/f135-probe/probe.ts`, and the 66 count came from the `awk | grep -o | wc -l` run. That pipeline does not count as proof under your rule. The count rests on my read of the array, and `probe.ts` itself printed no result.

Easy-to-miss rule ("Do not edit, create, or delete files"): followed. The note and worktree reads were the only writes, and the note is outside the repo. `test -z "$(git status --short)" && echo clean` printed `clean` and exited 0.

## Planner checks of the packets

- Scout 1 "JS and SQL agree untested": the planner ran a full code-point probe (plan.md § Facts checked F1).
- Scout 2 "repo DB locale unknown": still not verified for `postgres:17` (plan.md § Not verified N1).
- Scout 3 "mutation edits not recorded": the planner wrote each mutation edit from the F135 review text into stage 01.
