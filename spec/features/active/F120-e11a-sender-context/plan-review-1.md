# F120 · Plan review 1

Job `2026-11-18-f120-plan-review-1402479d`, claude-opus-5-5, thinking high, at 396aa39f. The reviewer's final verdict, copied whole from the job log. Fixes: `plan.md` § Cold review.

FAIL 396aa39ffc3b2da5abdfb32313ab5e780a4d8862

HEAD is `396aa39ffc3b2da5abdfb32313ab5e780a4d8862`, the same as the candidate. This review read the plan, the sources and the code only. It ran no test suite: the plan changes no code. Word counts (`wc -w`): `plan.md` has 1,498 words and the largest stage (03) has 695. Both are inside the § Plan size limits.

## BLOCKING

**B1. A domain blocklist suggestion can block known people. Stage 01 lets this bug through.** Proven by the text.
- `stages/stage-01-core-rules.md:34` adds a domain candidate when "≥ 2 distinct addresses of the domain meet the address rule". The "never" checks run per address only (`:32`). `plan.md:68` (D10) adds no check at the domain level.
- The source rule says "Never when `known`, `delegate`, VIP, whitelisted" (`E11-discovery-notes.md:80`). The risk table names exactly this bug: "A wrong blocklist suggestion hides a real person's mail" (`:165`).
- Event that no rule covers: two newsletter or noreply senders on `@client.pl` each get 2 corrections to spam. The user writes to `jan@client.pl`, a known contact, or `jan@client.pl` is a delegate or VIP. Then `@client.pl` is suggested as a blocklist, and one tap sends the known contact to spam.
- The own domain of the organization is not excluded either. Only mailbox addresses and aliases are own (`stage-03:11`), so `@ourcompany.pl` can be suggested.
- The same gap applies to a domain whitelist when another address of the domain has suspicious mail. A domain whitelist makes every sender on the domain "known" (`docs/capabilities/triage.md:88`), and a known sender gets only `auth_fail` and `risky_attachment` checks.
- Test 7 (`stage-01:45`) has no counter-case.
- Fix: no domain candidate when any address of the domain is known, delegate, VIP, whitelisted, has `answered90 > 0` or `userMailsTo90 > 0`, or has suspicious mail. No domain candidate for a domain of an own mailbox. Add tests for both.

## MAJOR

**M1. Bulk detection breaks after 30 days of header retention (stage 03).** Proven by the docs.
- `clearCapturedHeaders` sets `email_headers.list_id` and `list_unsubscribe` to null after `data_retention_days`, which is 30 by default (`docs/capabilities/retention.md:17`; `db/migrations/20261103000002_tenancy.sql:6`).
- `stage-03:12` marks a mail as bulk from these headers but counts `received` over 90 days. `relationOf` needs more than half of the mail to be bulk (`sender-history.ts:48`).
- Example: a weekly newsletter has about 13 mails in 90 days, but only about 4 still carry the headers. It becomes `new` or `known`, not `bulk`. Then the VIP "never bulk" guard (`stage-01:30`) fails, and the sender line shows the wrong relation.
- Test 7 (`stage-03:29`) seeds only fresh mail, so it passes.
- Fix: decide the denominator, for example only mail whose headers are not yet cleared (`texts_cleared_at IS NULL`). Add a test with mail 31–89 days old.

**M2. A DSR erase can race with the hourly refresh, and no rule covers it (stages 03 and 04).** Plausible, by reasoning.
- D8 locks only one refresh run against another (`plan.md:66`).
- Sequence: the refresh reads its aggregate, then the erase commits, then the refresh upserts the person's row. From then on the next pass only zeroes the row (D6, `plan.md:64`), so a row with the hash and the first and last seen dates stays for up to 12 months.
- Test 5 (`stage-04:29`) runs the steps in sequence only.
- Fix: the erase takes the per-mailbox advisory lock with a blocking call, or it runs a delete after the refresh. Add a race test on two connections, as `code-patterns.md` asks for "exactly one" rules.

**M3. The rollback claim about `due_source` is wrong for the current code (stage 13, stage 12).** Proven by reading the code.
- `stage-13:34` says the old loops code "reads the column as text". It does not: `toLoopRow` parses `z.enum(["stated", "default"])` (`apps/server/src/modules/loops/repo.ts:83`), and `packages/core/src/web/loops.ts:51` uses the same enum. So the old release throws on any `contact` row.
- `stage-13:34` hands the check to "the worker of stage 12", but `stage-12:14` has no such task.
- Fix: make rollback step 0 run the `UPDATE … SET due_source = 'default'` every time, and delete the check that was handed to stage 12.

**M4. Writing to a look-alike domain makes it trusted, and the larger list raises false positives (stage 10).** Proven by reading the code; the user effect is plausible.
- `isLookalike` returns false for a domain that is in the known list (`packages/core/src/triage/suspicious.ts:278`). D9 adds every domain of every user Sent mail (`plan.md:67`). One reply to `jan@kontrahemt.pl` silences `lookalike_domain` for that phishing domain for 90 days.
- Up to 500 more known domains also raise false positives. The suspicious readers ignore the flag and block drafts (`triage.md:92`: "a draft block holds with the flag off"). So `sender_context`, which Q3 turns on without the owner (`questions.md:14`), changes draft blocking.
- The sim already misses the false-positive target (4.8% against 2%, `triage.md:94`).
- No decision or test covers either effect. Fix: leave out domains whose incoming mail was flagged, or require ≥ N user mails. Add a test for "reply to a look-alike". Write the draft-block effect into Q3.

**M5. Suggestions and the wait rely on Sent data that may be missing, and no decision covers this (stages 01, 05, 09).** Plausible.
- The blocklist "never wrote to them" guard (`userMailsTo90 = 0`, `stage-01:32`), the `known` relation and D5 reply samples all come from `sent_emails`.
- Sent sync is a per-mailbox switch, and the pilot's `sent_sync` waits for the owner's word (`spec/build.md:54`). The first pass stores only 30 days (`retention.md:32`). With Sync off or new, "never wrote" is true by default, so a contact that the user writes to can get a blocklist suggestion.
- Fix: decide what happens with Sent sync off or with less than 90 days of Sent history. For example: no blocklist suggestion, and no contact wait.

**M6. Flag combinations have no rule (stages 05, 06, 09).**
- The job and the suggestion generator run only with `sender_context` on (`stage-03:18`, `stage-05:9`). Routes gate only on `sender_suggestions` (`stage-06:9`), and `contactWaitFor` gates only on `contact_wait` (`stage-09:9`).
- With `sender_context` off and the other flags on, the card shows open rows that are never withdrawn. The loop wait then comes from profiles that can be up to 12 months stale.
- Fix: decide that the two later flags count as off unless `sender_context` is on, or record that stale data is accepted. Add a test.

**M7. No decision covers negative or zero reply delays (stage 03, D5).** Plausible.
- `sent_at` comes from the client's Date header (`apps/server/src/modules/mail/sent-rules.ts:92`). Clock skew can make a delay negative.
- `senderHistorySchema` needs medians ≥ 0 (`sender-history.ts:29-31`). If the worker parses with the schema or adds a `>= 0` CHECK, the pass fails for that mailbox every hour.
- Fix: clamp or drop delays ≤ 0. Add a test.

**M8. `readProfiles` takes one mailbox, but the Activity page spans all mailboxes (stage 08 and the interfaces).** Proven by reading the code.
- `activityQuerySchema.mailboxId` is optional (`packages/core/src/web/activity.ts:49`), so one page holds mail of several mailboxes.
- `readProfiles(db, ctx, mailboxId, addresses)` (`interfaces.md:197`) cannot serve "One `readProfiles` call per page" (`stage-08:10`) or test 5, "one profile query" (`stage-08:19`).
- Fix: decide on a reader for several mailboxes, for example pairs of `(mailboxId, address)`, or one call per mailbox with the test changed to match.

**M9. Two rules conflict on audit content.**
- `plan.md:103` says: "No address, hash … or count of one sender in … an audit field".
- `stage-04:22` and test 4 (`:28`) need per-person counts and `address_hash` in the erase audit. This is the existing DSR pattern (`docs/capabilities/account-data.md:47`).
- A worker must stop and ask. Fix: write the DSR exception into the rule.

**M10. The pass-time limit contradicts itself (plan.md vs stage 03 vs stage 13).**
- `plan.md:87` says stage 03 measures 30k mails "with a seeded test and a time limit". `stage-03:36` measures 5,000 mails "no assert".
- The first time limit is then 60 s per mailbox on the VPS (`stage-13:25`). Nothing before production limits the hourly full recompute (D1), which is its main scale risk.
- Fix: pick one size and one limit.

## NOTE

- **N1. `usualReplyDays` has no upper bound** (`interfaces.md:167`), but the column has `CHECK BETWEEN 1 AND 60` (`stage-02:10`). A median above about 60 days fails the loop insert inside the analysis transaction. Clamp it or widen the CHECK. Plausible.
- **N2. D5 matches reply ids with equality** (`plan.md:63`). The current loops reply match uses substring search on `in_reply_to` (`apps/server/src/modules/loops/reply-read.ts:82`). Equality loses replies whose `In-Reply-To` lists several ids. Plausible. Decide one rule.
- **N3. A whitelist suggestion can come for a blocklisted sender** (`stage-01:31` does not check `isBlocklisted`). On Accept the whitelist silently overrides the blocklist, because "blocklisted (and not whitelisted)" (`triage.md:11`). Decide this, or show it in the reason line.
- **N4. `SuggestionInput` keeps moved-back and corrected-away in two fields** (`interfaces.md:169`). The rule adds them together (`stage-01:31`), while stage 03 describes one combined count (`stage-03:10`). One mail can count twice. State that the two fields count disjoint mails.
- **N5. Suggestions can flicker and fill the cap.** A VIP row can be withdrawn hourly when the ratio drops (`stage-05:10`), and withdrawn rows count toward the cap of 3 (`stage-05:12`). An open address row also stays open next to a newer domain row for the same domain. No test covers either case.
- **N6. A change of `CREDENTIALS_KEY` hides old rows from the DSR erase.** The old-key rows (dates only) stay unmatchable for up to 12 months (D3, `plan.md:61`). Accepted in Q9, but `stage-12:10` should state the DSR effect.
- **N7. The comparison baseline differs from PD-107 and is not written down as a deviation.** PD-107 says "only if it beats the E3b hint" (`E11-contacts-and-context.md:99`), but stage 11 compares against v2 and v3[list] (`stage-11:26`). This is probably stricter, but record it.
- **N8. The sender line leaves out the source's "last mail".** §2.7 asks for "relation class, counts, last mail" (`E11-discovery-notes.md:86`), but `SenderLine` (`interfaces.md:172`) has no last-mail field and no recorded reason.
- **N9. Stage 10 points to a record that does not exist.** `stage-10:31` says the sim false-positive check is "recorded as not verified in plan.md", but `plan.md:85-88` does not list it.
- **N10. The word counts are not where the planner rule wants them.** `plan.md:151` points to § Cold review, which says "Not run yet" (`:155`) and holds no counts.
- **N11. The counterpart differs from the current code.** `stage-09:10` says the counterpart is "the first To". The current loops code uses `to[0] ?? cc[0]` (`analyze-write.ts:49`), so a Cc-only loop differs. Use the stored `counterpart`.
- **N12. Stage size.** Stage 03 is the largest job: a new module, set-based SQL with about 15 counts, the lock, the job, the fixture, 12 integration tests and a time report. Stage 09 spans server, core brief, web schema, panel and e2e. Both are inside the word limit, but they are the stages most likely to need a second job.

## Checks run

- `git rev-parse HEAD` returned `396aa39f…`, which matches the candidate.
- `wc -w`: `plan.md` 1,498 words; the largest stage file 695.
- Confirmed against the code:
  - "Facts checked" items 2, 4, 5, 6 and 7: `sender-history.ts`, `eval-extras.ts:28`, `crypto.ts:90`, `rules.ts:30-70`, the `open_loops` CHECK, `analyze-write.ts:63`, and `retention.md:19-20`.
  - The layer edges in `layers.json`.
  - The job name and cron format in `main.ts`.
  - The `org:flag`, `job:run` and `org:dsr` scripts.
  - The `defaultDue` rule: working days, 17:00.
  - `isOneEditApart` passes stage 10 test 1.
- No unit, integration or e2e suite was run.
