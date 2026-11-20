# F144 plan — the sender activity read is split into readers of the owner modules

> **Status 2026-11-20 — planned.** Plan base: c1947f3b. Five stages, none built.

## Input

Task (coordinator, 2026-11-20): "Keep stages small (one worker each, 1 to 3 hours), name risky ones [risky], say which stages can run in parallel, give each stage a runnable Proof and tests that fail when the guard is removed. Decide yourself where the owner has no rule."

Finding (`spec/quality/2026-11-20-pass-2.md` § 4, Fix): "Split the function into named readers (…) and put each in the module that owns the table, behind its `index.ts`; `contacts` composes them."

### Design decisions

- **D1 Equivalence first.** Stage 01 adds a characterization test at `HEAD`, before any move: the whole `readSenderActivity` output (`toEqual` on literal arrays) for the full pass, an address scope and a domain scope, and the exact statement count of each. Every later stage keeps it unchanged. Reason: the existing tests use `toMatchObject` on chosen fields, so a dropped field passes. Rejected: trust the existing tests.
- **D2 Table owners.** `mail`: `emails`, `email_flags`, `email_headers`, `sent_emails`, `mailboxes`. `triage`: `triage_results`, `triage_feedback`. `delegation`: `delegates`, `delegations`. A reader names only tables of its own module. Rejected: the F100 metric style (a triage reader selects `FROM emails` itself), which keeps the hidden column dependency.
- **D3 The window is a mail query part.** Mail exports `senderWindow(db, ctx, options: SenderWindowOptions): SenderWindow`, a typed Kysely select over `emails` with the columns `id`, `address`, `received_at`, `message_id_header`, `in_reply_to`. A triage reader embeds it as the CTE `win` of its one statement. Rejected: read triage by email ids listed in memory (statements grow with the mail count, chunks of 500); one statement kept in contacts as a named exception (keeps the problem).
- **D4 Set-based stays.** Each reader is one statement for the whole mailbox. The total count stays the `HEAD` count (D1 test). The suspicious count moves from the incoming-mail statement to the triage newest-result reader: its rows per address and category carry `suspicious`; contacts sums them per address.
- **D5 Typed Kysely.** Builders for tables, joins, filters and groups, so a renamed column fails the typecheck. `sql` only for expressions with no builder (`percentile_cont … WITHIN GROUP`, the regexp of In-Reply-To, the Auto-Submitted test), with column references through typed refs where Kysely offers them. A statement that Kysely cannot build keeps a `sql` template inside the owner module, parses its rows with a Zod schema, and a comment names the reason. Rejected: move the templates unchanged (the type gap stays).
- **D6 Address form.** Every reader returns `address` in the rule form: SQL `normalizedAddress` (`apps/server/src/platform/db`) and TS `normalizeAddress` (`@ea/core`), both written by F142 stage 01. Plain addresses stay in memory: no reader logs a row, an address or a count with an address.
- **D7 Contacts interface unchanged.** `readSenderActivity(db, ctx, mailboxId, options)`, `SenderActivity`, `ReadActivityOptions`, `ActivityScope`, `PROFILE_DAYS` keep their names and shapes. `ActivityScope` becomes an alias of mail `SenderScope`. These stay in contacts: the merge, the exclusion of own and test senders, `MIN_DELAY_SAMPLES`, `relationOf`, the registrable-domain post-filter, the sort. `MAX_DELAY_HOURS` stays in contacts (it comes from the `sender_profiles` CHECK) and goes to the delay readers as the option `maxHours`.
- **D8 Layer edge.** `layers.json` gets the same-layer edge contacts → triage ("The profile pass reads the newest triage result and feedback counts per sender"). Triage imports no contacts code (checked), so there is no cycle. Rejected: a hook filled in a composition root (two callers, `refresh.ts` and `suggest.ts`; more plumbing for a plain read).
- **D9 Scope.** `SenderWindowOptions.only` and the Sent counts take the scope and keep today's SQL prefilter (address equality; domain `LIKE` with escaping). Under a scope, contacts skips the two delay readers and the delegation reader, as today.
- **D10 Files.** Mail: `repo/sender-activity.ts` (window, incoming counts, own addresses) and `repo/sender-replies.ts` (Sent counts, replied, delays). Triage: `repo/sender-activity.ts`. Delegation: `activity-repo.ts` (not `repo.ts`, which another ticket splits). All through each `index.ts`.
- **D11 Window rule unchanged.** `received_at` from `now − 90 days` to `now`, both ends included; `from_address_lower` not null and not empty; `mailKindFilter("real", testMail)`; `org_id` and mailbox on every table of every statement.
- **D12 Scan.** A unit test reads `contacts/activity.ts` and fails on `` sql` ``, `selectFrom(` or `.execute(`.
- **D13 Docs.** `docs/capabilities/sender-context.md` lists the readers and modules. `docs/code-patterns.md` § Data access gets one rule: a module that needs rows of another module's tables calls a reader of that module; a set-based read across modules passes the owner's typed query part (`senderWindow`). The F100 metric readers predate the rule and stay.

### Edge cases (plan-task § 4)

- **States, crash, two runs:** none; the read changes no row and runs in the refresh transaction.
- **Two tenants:** each reader gets a test with a second organization holding the same addresses and mail; only the first organization's counts return.
- **Time:** fixed `NOW` in every test; window edges as today.
- **Private data:** no address in a log line or an error text.

## Facts checked (2026-11-20, base c1947f3b)

- Callers: `contacts/refresh.ts` (full pass, in a transaction) and `contacts/suggest.ts` (`only`). Ten statements plus four list reads (scout 1; read in `activity.ts`).
- `layers.json`: contacts and triage share layer 3; no contacts → triage edge; triage imports nothing from `../contacts` (`rg` over `modules/triage`).
- No exported reader returns per-sender aggregates today (scout 2). No lint or test detects a cross-module table read (scout 3).
- F142 stage 01 moves `normalizedAddress` to `platform/db` and renames the core rule to `normalizeAddress` (F142 plan D3).

## Not verified

- Kysely 0.29 has `crossJoinLateral` (or `innerJoinLateral … onTrue`) and `.materialized()` on CTEs: stage 03 checks in `node_modules/kysely`; else D5 fallback.
- Query plans stay the same shape: no `EXPLAIN` in tests. Stage 03 compares the generated SQL of the delay readers with today's text by eye and keeps `MATERIALIZED`.

## Done when

- The stage 01 characterization test passes unchanged at the end.
- `bun run lint`, `typecheck`, `test:unit:ci`, `test:int:ci` pass.
- The scan test passes, and `contacts/activity.ts` is under 400 lines.

## Rules for every stage

- A gap in a decision or a deviation is a question in your final message, not a choice.
- Never edit the stage 01 characterization test after stage 01. If it fails, your reader is wrong.
- Format only the files of your stage. No migration, no `bun.lock` change, no `.env` read.
- For each guard test (an `org_id` filter, the mailbox filter, the window edge), remove the guard, run the test, see it fail, restore it. Name each in your result.
- Test addresses use `example.com`; never print or log an address.
- Last step: `git merge --no-edit master`, then the Proof, then a commit (`.agents/limen/reminders.md`).

## Proof

```
mkdir -p /tmp/f144-sNN && bun run lint > /tmp/f144-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f144-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f144-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f144-sNN/int.log 2>&1 && echo PROOF_OK
```

## User checkpoints and steps

None. No owner step, no VPS, no real spend.

## Review

Stage 03 `[risky]` (delay SQL rewrite): `claude-opus-5-5` before the land. Stages 02 and 04 (tenant filters of new readers): `claude-sonnet-5-5`. Stages 01 and 05 land on the worker's proof.

## Stages

| Stage | What | Needs / parallel |
| --- | --- | --- |
| [01](stages/stage-01-characterization.md) | Characterization test of today's read | nothing; may run now |
| [02](stages/stage-02-mail-window.md) | Mail window, incoming counts, own addresses | 01 test; F142 stage 01 |
| [03](stages/stage-03-mail-sent.md) `[risky]` | Mail Sent counts, replied, reply delays | 02 `senderWindow`; next to 04 |
| [04](stages/stage-04-triage.md) | Triage result and feedback readers, layer edge | 02 `senderWindow`; next to 03 |
| [05](stages/stage-05-delegation-and-scan.md) | Delegation reader, scan test, docs | 03 and 04 readers |

Parallel groups: {01} → {02} → {03, 04} → {05}.

## How to run (coordinator)

Move the ticket to `active/`, commit, spawn 01 now (it needs nothing). Spawn 02 when 01 and F142 stage 01 have landed; 03 and 04 together after 02; 05 after both.

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F144" \
  'Implement F144 stage NN. Read ticket.md, plan.md and stages/stage-NN-<slug>.md in spec/features/active/F144-…/; build every step. Final proof: the Proof of plan.md with NN, after the last commit. List as proven only what a saved log shows.'
```

`limen land <job> --yes --keep-open` on 01 to 04; 05 closes the ticket. Drop the job DB after each land.

## Decisions taken

1. D8: a same-layer edge contacts → triage, not a hook (design; `[minor]`).
2. Scope: the data request address list in `contacts/privacy.ts` and the mailbox reads of the suggestion commands stay out (scope; `[minor]`; undo: a follow-up ticket).
3. D13: the F100 metric readers that select `FROM emails` stay as they are (scope; `[minor]`).

## Planning progress

- Scouts: 3 (packets in `scouts.md`).
- [written] ticket.md, plan.md, stages 01–05.
- Words: plan ~1,500; stages 651, 663, 696, 624, 526.

## Cold review

Pending.
