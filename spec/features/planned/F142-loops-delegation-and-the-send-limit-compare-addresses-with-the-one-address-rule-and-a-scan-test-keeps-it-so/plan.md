# F142 plan — one address rule in loops, delegation and the send limit

> **Status 2026-11-20 — planned.** Plan base: 535e6f76. Five stages, none built.

## Input

Task (coordinator, 2026-11-20): "Keep stages small (one worker each, 1 to 3 hours), name risky ones [risky], say which stages can run in parallel, give each stage a runnable Proof and tests that fail when the guard is removed. Decide yourself where the owner has no rule."

Finding (`spec/quality/2026-11-20-pass-2.md` § 2, Fix): "Rename the core function to `normalizeAddress` (keep the old name exported for one release) … Add one lint rule or one scan test that bans `.toLowerCase()` on a value named `address`, `email` or `sender` in `modules/loops` and `modules/delegation`."

No owner rule covers this ticket; the decisions are defaults (§ Decisions taken).

### Design decisions

- **D1 One name.** `normalizeAddress` in `packages/core/src/contacts/address.ts` is the one export of the rule. `normalizeSenderAddress` and `normalizeSenderPattern` are deleted; every caller moves. Rejected: keep the old name for one release (the finding): one workspace, no outside caller, typecheck finds each old use.
- **D2 ASCII fast path inside the rule.** The fast path of the sender rule match (printable ASCII skips the two folds) moves into `normalizeAddress`. The output does not change: a printable ASCII string has no `ς` and no U+0307 after lower case. Rejected: a second spelling in `triage/rules.ts`.
- **D3 SQL home.** `contacts/address-sql.ts` (`normalizedAddress`, `divergentCodePoints`) moves with `git mv` to `apps/server/src/platform/db/address-sql.ts`, exported by `platform/db/index.ts`. `contacts/index.ts` stops its re-export. Reason: `layers.json` has contacts → delegation, so delegation → contacts is a cycle. Rejected: a new edge (cycle); a copy of the SQL (a second form).
- **D4 No data migration.** No column, index or CHECK changes. Old rows of `delegates.email`, `sender_rules.pattern` and `open_loops` keep their old form. Every read folds both sides by the rule. The rule output is lower case, so the CHECKs `email = lower(email)` and `pattern = lower(pattern)` still hold for new writes. Rejected: an UPDATE migration (the one migration slot, unique-key collisions, the rule frozen in SQL).
- **D5 Writes.** Every address that delegation or loops store in a folded form today (`delegates.email`, `open_loops.counterpart`) is stored in the rule form from now on. Arrays that are stored raw today stay raw.
- **D6 Delegate duplicate.** `addDelegate` returns `exists` when any delegate row of the organization, in any status, has `normalizedAddress(email)` equal to the new form. The unique index stays the guard for two adds of the identical form at once. Rejected: the unique index only (misses an old row with `ς` against a new `σ`).
- **D7 Reply read keeps its index.** The read of mails from a loop recipient compares the indexed `emails.from_address_lower` (generated `lower(from_address)`) with `= ANY(forms)`. The forms come from the new pure helper `addressLowerForms(address: string): string[]` in `packages/core/src/contacts/address.ts`: the rule form, plus each variant with `ς` in place of `σ` at the first four `σ` positions (at most 16 strings). The query is a superset; `replyMatch` in core decides with `normalizeAddress`. Residual: a From with padding or a literal combining dot is found only by the thread read (a near-spoof form; accepted). Rejected: `normalizedAddress(from_address_lower) IN …` (drops the index; up to 500 loops per run); a new generated column (migration, rule frozen in SQL).
- **D8 Other SQL compares.** Filters that use no index (own-address exclusion, test senders, alias group, `open_loops.counterpart IN`, delegate email) use `normalizedAddress(column)` against values from `normalizeAddress`.
- **D9 Scan test.** One file, `apps/server/src/address-rule-scan.test.ts`, in the unit lane. Scanned: every non-test `.ts` file under `apps/server/src/modules/loops/`, `apps/server/src/modules/delegation/`, `packages/core/src/loops/`, plus `packages/core/src/send-limits.ts` and `packages/core/src/triage/rules.ts` (skip `*.test.ts`, `*.test-helper.ts`). Banned: a call of `.toLowerCase()` or `.toLocaleLowerCase()`, and a string or template literal with `/\blower\s*\(/i`. Exception: a comment `// not an address: <reason>` on the same line or the line before, with a reason of at least two words. Rejected: a ban only on values named `address`, `email` or `sender` (the finding): it misses `row.to[0]?.toLowerCase()` and `lowerAll`.
- **D10 Capability pages.** Stage 01 edits the send limit and sender rule lines (`docs/capabilities/drafts-and-send.md`, `triage.md`) if they state the compare; stage 02 `delegation.md`; stage 03 `open-loops.md`; stage 05 adds the loop creation line to `open-loops.md` and one rule line to `docs/code-patterns.md` § Data access.

### Edge cases (answers)

- **Old row, new read:** a loop stored before the deploy with `νίκος@example.gr` (old fold kept `ς`) is closed by a reply from `ΝΊΚΟΣ@example.gr`: both sides fold to `νίκοσ@example.gr`. Test 03-T3.
- **Two tenants:** every changed query keeps its `org_id` filter (tests 02-T5, 03-T6).
- **Crash, repeat, two runs:** no new side effect; only compares change. D6 names the one race.

## Facts checked (2026-11-20, base 535e6f76)

- Constraints: `delegates.email` CHECK and unique `(org_id, email)` (`20261108000001_delegation.sql`); `sender_rules.pattern` CHECK (`20261104000001_triage.sql`); `emails.from_address_lower` generated and indexed (`20261115120001_suspicious_urgency_sender.sql`); `open_loops` has no index or CHECK on an address (`20261115160001_open_loops.sql`).
- Layers: `apps/server/src/modules/layers.json` (contacts → delegation edge; delegation, loops, contacts in one layer).
- ASCII fast path origin: `notes/2026-11-19-f120-s05-suggestions.md` N3.
- Send limits fold only in memory from `actions.payload` recipients (scout 2 § 4; `send-limits.ts` read).

## Not verified

- Postgres `lower()` keeps `ς` and lowers `İ` to `i` in the database locale. `address.ts` states it and the privacy rule check refuses a different database. Stage 02 test 02-T2 and stage 03 test 03-T2 run it on the job DB.

## Done when

1. `rg -n "normalizeSenderAddress|normalizeSenderPattern" apps packages tools` finds nothing.
2. The send limit counts `ΝΊΚΟΣ@example.gr`, `νίκος@example.gr` and ` νίκοσ@example.gr ` as one recipient (01-T1).
3. Delegate add, duplicate and reply find use the rule (02-T1 … 02-T5).
4. Loop close and loop creation use the rule (03-T1 … 03-T6, 04-T1 … 04-T5).
5. `bun test apps/server/src/address-rule-scan.test.ts` passes on the real files.
6. The same scan fails on its built-in bad samples (05-T1 … 05-T5).

## Rules for every stage

- A gap in a decision or a deviation is a question in your final message, not a choice.
- Format only the files of your stage. No repo-wide formatter.
- No migration, no `bun.lock` change, no `.env` read.
- For each guard your stage adds, remove it, run its test, see the test fail, restore it. Name the guard and the failing test in your result.
- Test addresses use `example.com` / `example.gr`; never log or print an address.
- Last step: `git merge --no-edit master`, then the Proof, then a commit (`.agents/limen/reminders.md`).

## Proof

```
mkdir -p /tmp/f142-sNN && bun run lint > /tmp/f142-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f142-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f142-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f142-sNN/int.log 2>&1 && echo PROOF_OK
```

Run it after the last commit, with nothing after it.

## User checkpoints and steps

None. No migration, no deploy, no real system, no spend.

## Review

Stage 03 `[risky]` (loop close decides what the user is chased for): review job on `claude-opus-5-5` before the land. Stage 02 (delegate list, reply of a delegate): review on `claude-sonnet-5-5`. Stages 01, 04 and 05 land on the worker's proof.

## Stages

| Stage | What | Needs |
|---|---|---|
| [01](stages/stage-01-one-name-one-sql-home.md) | One name, SQL form in platform, send limit, sender patterns | none |
| [02](stages/stage-02-delegation.md) | Delegation uses the rule | 01: `normalizeAddress`, `platform/db` `normalizedAddress`; next to 03, 04 |
| [03](stages/stage-03-loop-close.md) `[risky]` | Loop close and reply read | 01: same, plus `addressLowerForms`; next to 02, 04 |
| [04](stages/stage-04-loop-creation.md) | Loop creation, delegate button, chaser rows | 01: same as 02; next to 02, 03 |
| [05](stages/stage-05-scan-test.md) | Scan test, docs | no unmarked fold in the scanned files (01–04) |

## How to run (coordinator)

Move the ticket to `active/`, commit, spawn 01; after its land, 02, 03 and 04 together; then 05.

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F142" \
  'Implement F142 stage NN. Read spec/features/active/F142-…/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof of plan.md with NN. In the final message, list as proven only what a saved log shows.'
```

`limen land <job> --yes --keep-open` on 01 to 04; 05 closes the ticket. Drop the job DB after each land.

## Decisions taken

1. D1: no alias for the old names (rule-exception against the quality-pass fix text; undo: add `export const normalizeSenderAddress = normalizeAddress`).
2. D4: no data migration; old rows keep the old fold (scope; undo: a later migration that rewrites the three columns).
3. D6: a delegate whose address differs only by `ς`/`σ` or the dotted I from an existing one is refused as `exists` (user-visible; undo: drop the pre-check).
4. D7: a reply from a padded or combining-dot From outside the thread does not close a loop (user-visible; undo: switch the read to `normalizedAddress` and accept a full window scan).
5. Other private folds (reply drafts, outgoing sender, triage payloads, mail sync, login) stay out of scope; proposal for a follow-up ticket (scope).

## Planning progress

- [written] ticket.md, plan.md, scouts.md (2 scouts), stages 01–05.

## Cold review

Pending.
