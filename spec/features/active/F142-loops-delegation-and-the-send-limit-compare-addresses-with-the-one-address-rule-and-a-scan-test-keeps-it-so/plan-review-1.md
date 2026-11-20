FAIL 5fec30de4e6be30f6fa924bc62936b0ee0261f3f

The plan's design claims hold: D2, D3 and D4 hold, and D7 holds with one residual that the plan does not name. Two stage tests say they fail when the guard is removed, but they pass on today's code. The plan's own rule makes the worker see each guard test fail, so a Sonnet worker must guess new values. One decision is also missing. Storing the rule form (D5) changes the real address that reminders and follow-ups go to.

HEAD is `5fec30de` (the candidate), and the tree is clean. Base `535e6f76` differs from it only in the F142 folder.

## Blocking

**B1 · 03-T1 does not fail on the old code (proven by a bun run).** `stages/stage-03-loop-close.md` 03-T1 says "With the old helper → `null`". The old helper is `packages/core/src/loops/replies.ts:122`, `lower = trim().toLowerCase()`. JS lowers `ΝΊΚΟΣ@example.gr` to `νίκος@example.gr`, with a final `ς`. That equals the From `νίκος@example.gr`, so `recipients.includes(from)` at `replies.ts:147-148` is true.
- I ran the exact 03-T1 input against `replyMatch` at HEAD with bun. The result was `subject`.
- The `plan.md` § Rules line "remove it, run its test, see the test fail" cannot hold for this test.
- Fix: put PG-form or rule-form text on one side. Two inputs that work: To `νίκος@example.gr` with From `νίκοσ@example.gr`, or To `İlker@Example.com` with From `ilker@example.com`. The old helper gives `null` for both, because `İ` lowers to `i` plus U+0307.

**B2 · 02-T6 does not fail when the reply compare is reverted.** `stages/stage-02-delegation.md` 02-T6 stores the delegate as `νίκος@example.gr` and sends the From `ΝΊΚΟΣ@example.gr`. It says the revert to `lower(g.email) = fromAddress.toLowerCase()` gives no row.
- That revert is the current code at `apps/server/src/modules/delegation/repo.ts:337`. `lower('νίκος…')` is `νίκος…`, and JS `'ΝΊΚΟΣ@example.gr'.toLowerCase()` is `νίκος@example.gr`, so the row matches.
- Proof: a bun probe confirmed the JS side. The DB side is `lower()` of all-lowercase text; I did not run it on a DB.
- The case that 02-T6 must cover is a regression that stage 02 step 1 creates. After D5, new rows hold `νίκοσ@example.gr`. If step 2 is missed, a reply from `ΝΊΚΟΣ@…` (JS `νίκος`) stops matching. Make 02-T6 use a row added through `addDelegate("ΝΊΚΟΣ@example.gr")`, so it is stored as `νίκοσ`, and the From `ΝΊΚΟΣ@example.gr`. The revert then gives no row.

**B3 · Missing decision: D5 makes a compare key the address that sends go to (path proven, delivery harm plausible).** D5 stores `delegates.email` and `open_loops.counterpart` in rule form. Both are used as send recipients:
- `apps/server/src/modules/delegation/chaser.ts:104` sends delegation reminders with `to: [row.delegate_email]`.
- `apps/server/src/modules/loops/follow-up-draft.ts:59-61` sends a `delegated` loop follow-up to `[loop.counterpart]`.

Effect: a delegate the user types as `νίκος@example.gr` gets reminders at `νίκοσ@example.gr`. Today the stored and sent form is `νίκος`. The user also sees `νίκοσ` in the delegate list. A receiving server that compares local parts exactly will bounce the mail. No D or edge case covers "a stored compare form is used as a recipient".
- Ticket acceptance bullet 3 ("stores `ilker@example.com`") and 02-T2 write this behaviour into tests.
- Proposed default: keep the stored value deliverable. Store it lower case only, as today, and fold by the rule on every read: D8 and D6 already fold both sides.
- If the owner wants the rule form stored, record it as a user-visible decision. Add a test that names the address a reminder is sent to.

## Unverified

- I did not run `normalizedAddress` and `lower()` on a database. The DB behaviour for `ς` and `İ` stays the plan's own "Not verified" item, with 02-T2 and 03-T2 as its proof.
- I ran no lint, typecheck or test lane. This is a plan review, and no code changed.

## The four claims

**D2 holds.** Printable ASCII (0x20–0x7e) has no `ς` and no U+0307 after `toLowerCase()`. Space is the only trim character in that range. So the fast path gives the same output as `normalizeSenderAddress` (`packages/core/src/contacts/address.ts:19-21`, fast path origin `packages/core/src/triage/rules.ts:55-58`). One cost to note: `caseFormTable` (`address.ts:31-34`) calls the rule for every code point, so the fast-path regex now runs about 1.1 M times there. This is a minor cost only.

**D3 holds.** `apps/server/src/modules/layers.json` has the same-layer edge `contacts → delegation`. `eslint.config.js:37-45` and `layers.test.ts:40-41` refuse a cycle, so `delegation → contacts` cannot be added. Platform already imports `@ea/core` (for example `apps/server/src/platform/config-mail.ts`). The `platform imports no module` zone (`eslint.config.js:84-86`) allows the moved file once it imports `./schema` locally.

**D4 holds, with no regression.** Rule output is JS lower case, minus U+0307 after `i`, with `ς→σ`. `σ` is a fixed point of PG `lower()`. So every rule form passes `email = lower(email)` (`db/migrations/20261108000001_delegation.sql:6`) and `pattern = lower(pattern)` (`20261104000001_triage.sql:9`) whenever today's plain JS lowercase passes. On a DB with divergent code points, the insert fails today too. The privacy rule check (`apps/server/src/modules/privacy/rule-check.ts:44`) runs only in DSR and erase. It does not guard delegate or rule writes, although `plan.md` § Not verified suggests it does. This is a wording fix only.

**D7 holds, with one more residual.** `emails.from_address_lower` is `lower(from_address)` (`20261115120001_suspicious_urgency_sender.sql`, `emails_mailbox_sender_idx`). PG `lower()` turns Σ into σ and keeps a typed ς, so the σ→ς variants cover the realistic forms.
- Not named: a From with five or more `σ` and a typed `ς` after the fourth `σ` is missed. Typed `ς` sits at word-final positions, so variants at word-final `σ` positions (before a non-letter or the end) would beat "the first four".
- Not named: a DB with divergent code points makes the superset fail without a sign. This is the same risk as the Not verified item.

## Notes

- **N1 · Ticket acceptance bullet 2 passes on today's code (proven, bun run of `checkSendLimits`).** "A send to `ΝΊΚΟΣ@…` and five recent sends to `νίκος@…` hold the sixth" is already `held/recipient_day` at HEAD, because JS lowers both to `νίκος`. 01-T1, with a new send to `νίκοσ`, does discriminate: it gives `ok` at HEAD. Align the ticket bullet with 01-T1.
- **N2 · Ticket acceptance bullet 4 also passes today (plausible: JS side proven, DB side by `lower()` identity).** A loop to `ΝΊΚΟΣ@…` and a reply from `νίκος@…` match in both the SQL read (`reply-read.ts:38,89`) and `replyMatch`. The real bug is a reply from `ΝΊΚΟΣ@…`: `from_address_lower` is `νίκοσ`, but the JS recipient is `νίκος`. 03-T3 covers that path, but the ticket bullet does not. Restate the bullet as the From `ΝΊΚΟΣ@example.gr`.
- **N3 · Gap: sender-rule duplicates are not covered, although D6 covers delegate duplicates (plausible).** The unique key `sender_rules_key (org_id, mailbox_id, pattern, kind)` (`20261104000001_triage.sql:15`) and `addSenderRule` (`apps/server/src/modules/config/rules.ts:35-45`) take `exists` from the index only. An old row `νίκος@…` plus a new add of `ΝΊΚΟΣ@…` (now `νίκοσ`) gives two rules for one person. If the user removes one, the other still blocks or whitelists. Decide: add a pre-check as in D6, or accept the risk and say so.
- **N4 · Transient master window between stages 02 and 04 (plausible).** After stage 02, a new delegate is stored as `νίκοσ`. Until stage 04 lands, `loops/analyze.ts:87` and `analyze-write.ts:47-49` compare it with the JS lower of the Sent To (`νίκος`). A hand-forward then makes a `waiting` loop, not a `delegated` one. They run in parallel, so the window is short. Either land 02 and 04 together, or accept the window in `plan.md` § How to run.
- **N5 · Two scanned folds that no stage names; stage 05 step 2 will catch them.**
  - `packages/core/src/triage/rules.ts:41-42` (`normalize` in `isNoreplyAddress`) is an address fold in a file that stage 01 owns. Stage 01 has no sweep step.
  - `packages/core/src/loops/replies.ts:34` (`normalizeSubject`) is a text fold in a file that stage 03 owns. Stage 03 lists only the header folds for the marker, and the stage 04 sweep excludes `replies.ts`.
- **N6 · Scan gaps (plausible hardening, not a finding against acceptance).** D9 does not flag `eb.fn("lower", …)` (a `"lower"` literal without `(`), `"ilike"` / `ILIKE`, or `upper(`. Stage 04 itself proposes `ilike` for the message-id match (`analysis-repo.ts:86`). An address `ilike` later would pass the scan.
- **N7 · Non-discriminating tests (no claim made; listed so the worker does not count them as guards).** 03-T4, 03-T5, 03-T7 and 04-T6 already pass at HEAD: the old code trims and lowers in those paths (`replies.ts:96,122`, `loops/delegate.ts:76-78`, `match.ts:83`).
- **Stage size.** No stage is too big. `plan.md` has 1,495 words (cap 1,500). The stages have 586, 470, 604, 566 and 543 words. `ticket.md` has 501 words, against a budget of about 300 to 500.

## Checks run

- `git rev-parse HEAD && git status --short && wc -w <plan.md> <stages/stage-0*.md>` → HEAD `5fec30de…`, a clean tree, and the word counts above.
- bun probe of JS `toLowerCase()` on the test addresses → `ΝΊΚΟΣ`, ` ΝΊΚΟΣ ` and `νίκος` all give `νίκος` (U+03C2). `İlker` gives `i` + U+0307.
- bun run of `replyMatch` at HEAD with the 03-T1 input → `subject`.
- bun run of `checkSendLimits` at HEAD: the ticket bullet 2 input → `held/recipient_day`, and the 01-T1 input → `ok`.
- Code reads at HEAD: `contacts/address.ts`, `contacts/address-sql.ts`, `layers.json`, `eslint.config.js:37-86`, `privacy/rule-check.ts`, `delegation/service.ts`, `delegation/repo.ts:320-345`, `delegation/chaser.ts:104`, `loops/reply-read.ts`, `loops/match.ts`, `loops/analyze-write.ts`, `loops/analyze-rules.ts`, `loops/due-rows.ts`, `loops/follow-up-draft.ts:56-61`, `core/loops/replies.ts`, `core/loops/extractor.ts`, `core/triage/rules.ts`, `core/send-limits.ts`, `config/rules.ts`, `config/repo.ts:191-206`, and the four migrations.
- I put the probe files in `tmp-review/` inside the worktree and removed them; the tree is clean.

## Note check

- HEAD equals the candidate 5fec30de: proven. `git rev-parse HEAD && git status --short && wc -w spec/features/planned/F142-…/plan.md spec/features/planned/F142-…/stages/stage-0*.md`
- Claims D2, D3, D4, D7 checked with file:line: not proven. The evidence is the code reads and the bun probes in this message. The probes ran in bash calls that hold heredocs (line breaks), and no saved log exists.
- Pre-mortem answered (gaps, conflicts, worker-guess steps, unsourced facts, stage size): not proven. The findings are in this message, but no file or qualifying command backs them. The B1 and N1 bun runs were heredoc calls.
- Stage word counts within 700 and plan.md within 1,500: proven. `git rev-parse HEAD && git status --short && wc -w spec/features/planned/F142-…/plan.md spec/features/planned/F142-…/stages/stage-0*.md` (1495; 586, 470, 604, 566, 543).
- Easy-to-miss rule ("Missing code detail … is not a finding"): followed. Each finding names a test value, a decision, an edge case or an interface; none asks only for line numbers, edit text or file lists. No file or command records this; the evidence is this message.
- Project reminder (merge master, then typecheck, lint and unit lane, then a commit, for a job that commits product code): followed. It does not apply, because this is a review job and committed nothing; `git status --short` was empty.
