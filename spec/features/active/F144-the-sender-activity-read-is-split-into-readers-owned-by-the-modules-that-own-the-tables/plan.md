# F144 plan — the sender activity read is split into readers of the owner modules

> **Status 2026-11-20 — planned.** Plan base: c1947f3b. Six stages, none built.

## Input

Task (coordinator, 2026-11-20): "give each stage a runnable Proof and tests that fail when the guard is removed. Decide yourself where the owner has no rule."

Finding (`spec/quality/2026-11-20-pass-2.md` § 4, Fix): "Split the function into named readers (…) and put each in the module that owns the table, behind its `index.ts`; `contacts` composes them."

### Design decisions

- **D1 Equivalence first.** Stage 01 adds a characterization test at `HEAD`, before any move: the whole `readSenderActivity` output (`toEqual` on literal arrays) for the full pass, an address scope and a domain scope, and the exact statement count of each. The counter counts executed statements (`transformResult`), so an embedded builder counts once (review B1). Later stages keep it unchanged. Rejected: the existing `toMatchObject` tests.
- **D2 Table owners.** `mail`: `emails`, `email_flags`, `email_headers`, `sent_emails`, `mailboxes`. `triage`: `triage_results`, `triage_feedback`. `delegation`: `delegates`, `delegations`. A reader names only tables of its own module. Rejected: the F100 style (a triage reader selects `FROM emails`): the hidden dependency stays.
- **D3 The window is a mail query part.** Mail exports `senderWindow(db, ctx, options: SenderWindowOptions): SenderWindow`, a typed Kysely select over `emails` with the columns `id`, `address`, `received_at`, `message_id_header`, `in_reply_to`. Mail and triage readers embed it as the CTE `win` of their one statement. Rejected: triage reads by email ids listed in memory (statements grow with the mail count); a named exception in contacts.
- **D4 Set-based stays.** Each reader is one statement for the whole mailbox. The total count stays the `HEAD` count (D1 test). The suspicious count moves from the incoming-mail statement to the triage newest-result reader: its rows per address and category carry `suspicious`; contacts sums them per address.
- **D5 Typed Kysely.** Builders for tables, joins, filters and groups, so a renamed column fails the typecheck. `sql` only for expressions with no builder (`percentile_cont`, the In-Reply-To regexp, the Auto-Submitted test), with typed refs where Kysely offers them. A statement Kysely cannot build keeps a `sql` template in the owner module, a Zod row parse and a comment with the reason. Rejected: move the templates unchanged.
- **D14 Typed address columns.** `normalizedAddress(column: string)` (F142) takes a string. Each reader passes it a constant typed as a Kysely column reference of its table, so a rename of `from_address_lower`, `to_addresses` or `delegates.email` fails the typecheck (review N7).
- **D6 Address form.** Every reader returns `address` in the rule form: SQL `normalizedAddress` (`apps/server/src/platform/db`) and TS `normalizeAddress` (`@ea/core`), both written by F142 stage 01. Plain addresses stay in memory: no reader logs a row, an address or a count with an address.
- **D7 Contacts interface unchanged.** `readSenderActivity(db, ctx, mailboxId, options)`, `SenderActivity`, `ReadActivityOptions`, `ActivityScope`, `PROFILE_DAYS` keep their names and shapes. `ActivityScope` becomes an alias of mail `SenderScope`. Contacts keeps the merge, the own and test sender exclusion, `MIN_DELAY_SAMPLES`, `relationOf`, the domain post-filter, the sort, and `MAX_DELAY_HOURS` (from the `sender_profiles` CHECK; passed as `maxHours`).
- **D8 Layer edge.** `layers.json` gets the same-layer edge contacts → triage ("The profile pass reads the newest triage result and feedback counts per sender"). Triage imports no contacts code, so no cycle. Rejected: a hook filled in a composition root (more plumbing for a plain read).
- **D9 Scope.** The window and the Sent counts take `only` with today's SQL prefilter. Under a scope, contacts skips the delay and delegation readers, as today.
- **D10 Files.** Mail: `repo/sender-activity.ts` (window, incoming counts, own addresses), `repo/sender-replies.ts` (Sent counts, replied), `repo/sender-delays.ts`. Triage: `repo/sender-activity.ts`. Delegation: `activity-repo.ts` (another ticket splits `repo.ts`). Exports through each `index.ts`.
- **D11 Window rule unchanged.** Today's window (`now − 90 days` to `now`, both ends in; `mailKindFilter("real", testMail)`; `org_id` and mailbox on every table) and today's edge rules stay: the replied and user-delay reads have no upper bound on `sent_at`; `own_sent` of the their-delay read has no Auto-Submitted filter (review N4).
- **D12 Scan.** A unit test reads `contacts/activity.ts` and fails on any `sql` use (`` sql` ``, `` sql<T>` ``, `sql.raw(`), `selectFrom(`, `.execute(` or a value import from `kysely`.
- **D13 Docs.** `docs/capabilities/sender-context.md` lists the readers. `docs/code-patterns.md` § Data access gets one rule: rows of another module's tables come from a reader of that module; a set-based read across modules passes the owner's typed query part (`senderWindow`). The F100 readers predate it.

### Edge cases (plan-task § 4)

- **States, crash, two runs:** none; the read writes nothing.
- **Two tenants:** each reader gets a test with a second organization holding the same addresses and mail (rule form below).
- **Time:** fixed `NOW`; window edges as today. **Private data:** no address in a log line or an error text.

## Facts checked (2026-11-20, base c1947f3b)

- Callers: `contacts/refresh.ts` (full pass) and `contacts/suggest.ts` (`only`); nine `sql` statements, three list reads (review N10).
- `layers.json`: contacts and triage share layer 3 with no edge; triage imports nothing from `../contacts` (`rg`).
- No exported reader gives per-sender aggregates (scout 2); no check detects a cross-module table read (scout 3).
- F142 stage 01 moves `normalizedAddress` to `platform/db` and renames the core rule to `normalizeAddress` (F142 plan D3).
- Kysely 0.29.8 has `innerJoinLateral` and `CTEBuilder.materialized()` (review N13).

## Not verified

- Query plans keep their shape: no `EXPLAIN` in tests. Stage 04 compares the compiled delay SQL with today's text.

## Done when

- The stage 01 test passes unchanged; the Proof passes; the scan test passes; `contacts/activity.ts` has under 400 lines.

## Rules for every stage

- A gap in a decision or a deviation is a question in your final message, not a choice.
- Never edit the stage 01 characterization test after stage 01. If it fails, your reader is wrong.
- Format only the files of your stage. No migration, no `bun.lock` change, no `.env` read.
- For each guard test (an `org_id` filter, the mailbox filter, the window edge), remove the guard, run the test, see it fail, restore it. Name each in your result.
- Tenant test form: call the reader with org A's `ctx` and org B's mailbox id; expect `[]`. (Mailbox ids are unique, so a test with org A's own mailbox cannot fail when an `org_id` filter goes.)
- Fixtures: `NOW` and `ago` of `contacts-fixtures.ts`, explicit dates.
- Test addresses use `example.com`; never print or log an address.
- Last step: `git merge --no-edit master`, then the Proof, then a commit (`.agents/limen/reminders.md`).

## Proof

```
mkdir -p /tmp/f144-sNN && bun run lint > /tmp/f144-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f144-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f144-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f144-sNN/int.log 2>&1 && echo PROOF_OK
```

## User checkpoints and steps

None.

## Review

Stage 04 `[risky]` (delay SQL): `claude-opus-5-5` before the land. Stages 02 and 05 (new tenant filters, layer edge): `claude-sonnet-5-5`. Stages 01, 03 and 06 land on the worker's proof.

## Stages

| Stage | What | Needs / parallel |
| --- | --- | --- |
| [01](stages/stage-01-characterization.md) | Characterization test of today's read | nothing; may run now |
| [02](stages/stage-02-mail-window.md) | Mail window, incoming counts, own addresses | 01 test; F142 stage 01 |
| [03](stages/stage-03-mail-sent.md) | Mail Sent counts, replied mails | 02 `senderWindow`, `senderScopeCondition` |
| [04](stages/stage-04-reply-delays.md) `[risky]` | Mail reply-delay readers | 02 `senderWindow` |
| [05](stages/stage-05-triage.md) | Triage result and feedback readers, layer edge | 02 `senderWindow` |
| [06](stages/stage-06-delegation-and-scan.md) | Delegation reader, scan test, docs | 03, 04, 05 |

Parallel groups: {01} → {02} → {03, 04, 05} → {06}.

## How to run (coordinator)

Move the ticket to `active/`, commit, spawn 01 now. Spawn 02 when 01 and F142 stage 01 have landed; 03, 04 and 05 together after 02; 06 after all three.

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F144" \
  'Implement F144 stage NN. Read ticket.md, plan.md and stages/stage-NN-<slug>.md in spec/features/active/F144-…/; build every step. Final proof: the Proof of plan.md with NN, after the last commit. List as proven only what a saved log shows.'
```

`limen land <job> --yes --keep-open` on 01 to 05; 06 closes the ticket. Drop the job DB after each land.

## Decisions taken

All `[minor]`; detail and undo in `questions.md`. 1. D8 layer edge, not a hook. 2. `contacts/privacy.ts` and the suggestion-command mailbox reads stay out. 3. The F100 metric readers stay.

## Planning progress

- Scouts: 3 (packets in `scouts.md`).
- [written] ticket.md, plan.md, stages 01–06.
- Words (`wc -w`): plan 1,498; stages 698, 695, 490, 657, 626, 560.

## Cold review

One round, `claude-opus-5-5` at `high` (a `[risky]` stage), job `2026-11-20-f144-plan-review-52f09b73`, FAIL, 2 blocking, 13 notes: `plan-review-1.md`. All fixed: B1 (D1), B2 (stage 02 test 10), N1 (rules), N2–N4 (stage 04, D11), N5 (stage 02), N6 (D12), N7 (D14), N8 (rules), N9 (stage 01), N10 (facts), N12 (stage 03 split into 03 and 04). N11 needs an edit of the F143 ticket: final message.
