# F142 scouts

Two scouts, run 2026-11-20 at base 535e6f76. Each packet is copied whole from the job log. A packet is a lead, not a fact: plan.md § Facts checked says what the planner read again.

## Scout 1 · job 2026-11-20-f142-scout-1-decf4d74

Question: every place in apps/server/src and packages/core/src that lower-cases, trims or otherwise normalizes an email address before a compare, a set lookup, a hash or a DB write; the rule, JS or SQL, and what it is compared against.

Packet: every place in `apps/server/src` and `packages/core/src` that normalizes an email address before a compare, set lookup, hash or DB write
Base: 535e6f76
Verified: `rg -n "toLowerCase\(\)|\.trim\(\)|\blower\(|btrim" …` over the non-test files, plus `rg` for the helper names -> `modules/loops/analyze-rules.ts:37:export const lowerAll = (addresses: readonly string[]): string[] => addresses.map((address) => address.toLowerCase());`

Unknowns:
- The list may be incomplete. I filtered the first `rg` by address-like words and cut it at 150 lines. I excluded `prompts/`, `texts/`, `i18n/` and tests. I read `modules/loops`, `delegation`, `actions`, `mail`, `tenancy` and `config` in full.
- I did not list `modules/contacts/activity.ts` lines 101 and 140 in the groups below. They use a bare `btrim`, not the full rule.
- I did not trace what `sendRecipients` and `splitAddress` return, so I do not know whether their callers lower-case further.
- The `lab` module, `sim/`, `scripts/` arg parsers and `testmail` use the same inline folds. I list them as one group only.
- `emails.from_address_lower` is `lower(from_address)` (`db/migrations/20261115120001_suspicious_urgency_sender.sql:27`). It is a third rule: lower-case only, with no trim, sigma or dotted-I fold.
- The note file `.limen/jobs/…/note.md` is outside the worktree. `git status --short` in the worktree is empty.

1. **Already use the one rule (observed).**
   - JS `normalizeSenderAddress`: `composition.ts:110`; `contacts/{wait.ts:33, lines.ts:53,62, suggest.ts:188,287, profiles.ts:53, privacy.ts:120,138,169, activity.ts:136,253,443}`; `privacy/address-map.ts:340`.
   - SQL `normalizedAddress`: `contacts/activity.ts:138-142,222,230,328,339,364,432,440`; `privacy/erase.ts:83`; `privacy/dsr-match.ts:86,93,105,113`.
   - `triage/rules.ts:58` (`normalizeForMatch`) uses it only for non-ASCII text. For ASCII it uses `trim().toLowerCase()`.
   - `contacts/privacy.ts:174-179` is a hybrid. It reads `from_address_lower` and `lower(a)`, `lower(pattern)`, `lower(email)` in SQL, then JS folds the result at `:169` with `normalizeSenderAddress`. SQL `lower` runs first, so the fold sees an already lower-cased value.
2. **Loops: `.toLowerCase()` with no trim (observed).**
   - `loops/match.ts:70`: mailbox addresses in `ownAddressSets`. They are compared in JS against reply From values lowered in `reply-read.ts`.
   - `loops/analyze.ts:84`: `ownAddresses` of the mailbox env. `loops/analyze.ts:87`: delegate emails. They are compared in JS in `analyze-write.ts:47-48` against `row.to` lowered by `.toLowerCase()`.
   - `loops/analyze-write.ts:47`: `row.to`, `:51` and `:77`: `row.cc[0]` or `row.to[0]`. These become the loop `counterpart` (a DB write). `core/loops/extractor.ts:92,94` compares them with `ownAddresses` using the same rule.
   - `loops/analyze-rules.ts:37`: the `lowerAll` helper. Callers at `:81` (SQL `promisesTo` argument, compared against stored values) and `:99,103` (a JS Set lookup, recipients against a loop's `to_addresses` and `cc_addresses`).
   - `loops/analysis-repo.ts:83`: test-mail `senders`, compared in SQL against `lower(s.from_address)` at `:88`. This is lower-case only on both sides.
3. **Loops: `.trim().toLowerCase()` (observed).**
   - `loops/match.ts:83`: `to_addresses`, `cc_addresses` and `counterpart`. They are compared in a JS Set against the `aliases` from `match.ts:52-59`. Those aliases come from SQL `lower(from_address)` plus `.trim()`. The rule is therefore SQL `lower` and JS `trim` together.
   - `loops/reply-read.ts:38,41`: loop recipients and own addresses. `loops/delegate.ts:76,78`: the sender against mailbox addresses (a JS compare).
   - `core/loops/replies.ts:96,122,132,133`: the `lower` helper, used in JS against the own addresses.
4. **Delegation (observed).**
   - `delegation/service.ts:66`: `trim().toLowerCase()` on the input email. It is validated, written to `delegates.email`, and compared at `:71`.
   - `delegation/service.ts:71`: `mailbox.address.toLowerCase()`, no trim, JS compare.
   - `delegation/repo.ts:337`: SQL `lower(g.email) = fromAddress.toLowerCase()`.
   - `scripts/delegates-args.ts:23`: `z.string().trim().toLowerCase()`, then written through the service.
5. **Other private copies (observed).**
   - `core/send-limits.ts:32`: `normalizeAddress = trim().toLowerCase()`. It builds Sets at `:78,80` of sent recipients against input `to`.
   - `core/triage/rules.ts:14`: `normalizeSenderPattern = trim().toLowerCase()`. Callers: `core/web/rules.ts:11`, `scripts/rules.ts:59`, `modules/config/rules.ts:35`.
   - `modules/config/repo.ts:201` does `trim().toLowerCase()` again on write. It is compared in `triage/suspicious-context.ts:63`, which has its own `lower` helper, and in `triage/eval-suspicious.ts:79,139`.
   - JS compares on the send path:
     - `actions/send-prepare.ts:65,71`: `.toLowerCase()`.
     - `actions/drafts.ts:84,85`: `.toLowerCase()`.
     - `actions/scope.ts:32,40`: `.toLowerCase()`.
     - `core/replies/recipients.ts:43`: the `key` helper, `trim().toLowerCase()`.
     - `core/replies/copy-key.ts:20` and `core/replies/eligibility.ts:96,97`: `trim().toLowerCase()`.
     - `core/outgoing/sender.ts:16,17`: `trim().toLowerCase()`.
     - `core/triage/payloads.ts:145,152,180,183,198`: `toLowerCase()` and one `trim().toLowerCase()`.
   - SQL compare in `actions/repo/filters.ts:28,32,35`: `lower(r) <> ALL(addresses.toLowerCase())`.
   - Mail sync compares in JS: `mail/sync-rules.ts:16,206` and `mail/sent-rules.ts:50,77` (`trim().toLowerCase()`), and `mail/test-address.ts:3,9`.
   - Tool helpers: `mail/tools.ts:432,433`.
   - `triage/extras-reader.ts:101,126`: `from_address.trim().toLowerCase()`. It is compared with `from_address_lower` at `:57` and passed to the profile reader, which folds again with `normalizeSenderAddress` (`contacts/profiles.ts:53`).
   - `triage/newsletter-unsubscribe.ts:152`: `trim().toLowerCase()` of the sender. It is written to the `sender_lower` column and used at `:56,95`.
   - SQL `lower(from_address)` and `lower(emails.from_address) in (rule.senders)`: `mail/repo/emails.ts:14`, `mail/repo/history.ts:78` (`lower(mailboxes.address)` against `from_address_lower`), `loops/due-rows.ts:34` (`lower(l.counterpart)`).
   - Not looked at line by line: the same inline folds in `core/web/mailboxes.ts:100`, `core/testmail/*`, `core/sim/*`, `modules/mail/fake/*`, `lab/` and the `scripts/` arg parsers. `platform/http.ts:88` is an IP address, not an email.
   - Login and SSO emails: `tenancy/{sso-resolve.ts:43, members.ts:48, service.ts:48}`, `platform/auth.ts:220,281`, `platform/auth-sso-required.ts:73,90`, `core/web/password.ts:14`. These are `toLowerCase` or `trim().toLowerCase()`. They go to `findUserByEmail`, and `tenancy/repo/users.ts:23,32` uses a `lower(email)` index.

Checks: the existing `privacy/rule-check.ts` and the `normalizedAddress` tests cover agreement between the JS and SQL forms of the one rule. They do not cover any of the inline folds listed above. No scan test for inline `.toLowerCase()` on addresses was found.

## Scout 2 · job 2026-11-20-f142-scout-2-2987e788

Question: which stored values hold an address in a normalized form, so that a change of the rule changes how existing rows match; does a rule change need a data migration?

Packet: Which stored email-address values are normalized, and does a change of the rule need a data migration?
Base: 535e6f76
Verified: `grep -rniE "lower\(|citext" db/migrations` -> `20261103100001_mail.sql:21:CREATE UNIQUE INDEX mailboxes_org_address_key ON mailboxes (org_id, lower(address));`
Unknowns:
- Who writes `unsubscribe_requests.sender_lower` and `sender_suggestions.pattern`, and with which rule. I did not trace the writers.
- Where `open_loops.counterpart` is stored with a rule. At HEAD, `analyze-write.ts:52` writes `delegate?.address ?? first`, and `first` is lowercased at lines 47–51. I did not confirm that `delegate.address` is lowercased.
- `sender_rules.pattern` may hold a domain or `*` pattern. I did not read the write path beyond `config/repo.ts:201`.
- I did not open `listRecentSends` (`actions/repo/sends.ts:410`). It reads `actions.payload` as JSON, and I did not check which rule the payload recipients carry.
- The note at `.limen/jobs/2026-11-20-f142-scout-2-2987e788/note.md` still lists three items as not proven. I did not update it.

1. **DB-enforced lowercase only (a rule change needs a data migration):**
   - `users.email` has a unique index on `lower(email)` (`20261103000002_tenancy.sql:18`) and a CHECK `email = lower(email)` (`20261110000001_web_panel.sql:7`). Observed.
   - `mailboxes (org_id, lower(address))` has a unique index (`20261103100001_mail.sql:21`). The write at `mail/repo/mailboxes.ts:74` stores `input.address` as given. Observed.
   - `delegates.email` has CHECK `email = lower(email)` plus a format check (`20261108000001_delegation.sql:6`). `delegation/service.ts:66` writes `trim().toLowerCase()`. Observed.
   - `sender_rules.pattern` has CHECK `pattern = lower(pattern)` (`20261104000001_triage.sql:9`). `config/repo.ts:201` writes `trim().toLowerCase()`. Observed.
   - `unsubscribe_requests.sender_lower` has a CHECK on `lower()` and a unique key on `(mailbox_id, sender_lower)` (`20261117140001_unsubscribe_data.sql:20`). Observed.
   - `sender_suggestions.pattern` has a CHECK on `lower()` (`20261118120001_sender_context.sql:74`). Observed.
   - A stricter rule (trim, Greek final sigma, combining dot) does not fit these constraints. A data migration is needed to rewrite existing rows, and the unique indexes must absorb merged duplicates. Guessed.

2. **Generated column, which changes only with a DDL change:** `emails.from_address_lower` is `GENERATED ALWAYS AS (lower(from_address)) STORED` (`20261115120001_suspicious_urgency_sender.sql:27`). It is read with `=`, `in` or `not in` in `loops/reply-read.ts:62-89` and in `contacts/activity.ts:222-230`. A new rule needs a new migration that drops and recreates the column. Compare against it either by switching to the rule or by keeping `lower` on both sides. Observed.

3. **Already on the one rule, code only:** `contacts/address-sql.ts:16` `normalizedAddress()` is the SQL form of `normalizeSenderAddress` (`packages/core/src/contacts/address.ts:19`). Its comment says "No index or stored column holds this text, so a change of the rule needs no migration." The core triage rules (`packages/core/src/triage/rules.ts:1`) and `contacts/activity.ts:136,253` use `normalizeSenderAddress` for sender, patterns, own addresses and delegates. Observed.

4. **Divergent rules (the F142 targets), all code-only, with no stored normalized column:**
   - `loops/analyze-rules.ts:68` reads `open_loops.counterpart` with `lower(counterpart)` against `lowerAll(...)`, which is a plain `toLowerCase` (`analyze-rules.ts:37`). `counterpart` has no CHECK or index (`20261115160001_open_loops.sql:26`). Observed.
   - `delegation/repo.ts:337` reads `delegates.email` with `lower(g.email)` against `fromAddress.toLowerCase()`. Observed.
   - `delegation/service.ts:71` compares mailbox addresses with `toLowerCase`. Observed.
   - `loops/delegate.ts:76-78`, `loops/match.ts:70-83`, `loops/reply-read.ts:38-41` and `loops/analyze.ts:84-87` use `trim().toLowerCase()` or `toLowerCase()` for own and delegate addresses. Observed.
   - `packages/core/src/send-limits.ts:32` defines a private `normalizeAddress = trim().toLowerCase()` and applies it to both stored payload recipients and the new send (lines 76-80). Nothing is stored in normalized form here, because the counters are computed from `actions.payload` in memory. Switching to the one rule is code only. Observed.

5. **Stored recipient arrays are raw, with no normalized form:** `to_addresses` and `cc_addresses` in `emails`, the sent-mail table and `open_loops` (`20261103100001_mail.sql:57`, `20261115090001_sent_mail.sql:16`, `20261115160001_open_loops.sql:24`) have no constraint or index on `lower`. `analyze-write.ts:47-77` lowercases them on read. Observed.

Checks: `bun run graph:modules` and `bun run lint` were not run; `grep` over `db/migrations` covers every `lower()` constraint and index, but misses writers outside the files named above and any non-SQL-visible rule in JSON `actions.payload`.
