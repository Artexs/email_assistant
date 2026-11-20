# F142 plan — one address rule in loops, delegation and the send limit

> **Status 2026-11-20 — planned.** Plan base: 535e6f76. Five stages, none built.

## Input

Task (coordinator, 2026-11-20): "give each stage a runnable Proof and tests that fail when the guard is removed. Decide yourself where the owner has no rule."

Finding (`spec/quality/2026-11-20-pass-2.md` § 2, Fix): "Rename the core function to `normalizeAddress` (keep the old name exported for one release) … Add one lint rule or one scan test that bans `.toLowerCase()` on a value named `address`, `email` or `sender` in `modules/loops` and `modules/delegation`."

### Design decisions

- **D1 One name.** `normalizeAddress` in `packages/core/src/contacts/address.ts` is the one export of the rule (the compare key). Next to it, `storedAddressForm(address)` (trim, JS lower case: today's write form) is the one export for a value that is stored or sent (D5). `normalizeSenderAddress` and `normalizeSenderPattern` are deleted; every caller moves. Rejected: keep the old name for one release (the finding): one workspace, no outside caller, typecheck finds each old use.
- **D2 ASCII fast path inside the rule.** The sender rule fast path (printable ASCII skips the two folds) moves into `normalizeAddress`; the output does not change. Rejected: a second spelling in `triage/rules.ts`.
- **D3 SQL home.** `contacts/address-sql.ts` (`normalizedAddress`, `divergentCodePoints`) moves with `git mv` to `apps/server/src/platform/db/address-sql.ts`, exported by `platform/db/index.ts`. `contacts/index.ts` stops its re-export. Reason: `layers.json` has contacts → delegation, so delegation → contacts is a cycle. Rejected: a new edge (cycle); a copy of the SQL (a second form).
- **D4 No data migration.** No column, index or CHECK changes. Stored values keep today's form (D5); compares fold both sides. Rejected: an UPDATE migration (migration slot, unique collisions, rule frozen in SQL).
- **D5 The rule form is a compare key only.** It is never stored, shown or sent. `delegates.email` and `open_loops.counterpart` are send recipients (§ Facts checked); the rule turns `νίκος` into `νίκοσ`, another mailbox for a strict server. So writes that fold today (`delegates.email`, `open_loops.counterpart`, `sender_rules.pattern`) use `storedAddressForm`; raw arrays stay raw. The CHECKs `email = lower(email)` and `pattern = lower(pattern)` hold as today. Rejected: store the rule form (review B3: a bounce risk).
- **D6 Duplicates.** `addDelegate` returns `exists` when any delegate row of the organization, in any status, has `normalizedAddress(email)` equal to `normalizeAddress` of the new address. The sender rule add does the same per mailbox and kind (`exists`). The unique indexes stay the guard for two adds of the identical form at once. Rejected: the unique index only (`İlker@…` is stored `i̇lker@…`, then `ilker@…` is a second row for one person).
- **D7 Reply read keeps its index.** The read of mails from a loop recipient compares the indexed `emails.from_address_lower` (generated `lower(from_address)`) with `= ANY(forms)`. The forms come from the new pure helper `addressLowerForms(address: string): string[]` in `packages/core/src/contacts/address.ts`: the rule form, plus each variant with `ς` in place of a word-final `σ` (a `σ` before a non-letter or at the end), over the first four such positions (at most 16 strings). A superset; `replyMatch` decides. Residual: a From with padding, a literal combining dot, or a typed `ς` after the fourth word-final `σ` is found only by the thread read (accepted). Rejected: `normalizedAddress(from_address_lower) IN …` (no index; up to 500 loops per run); a new generated column (migration).
- **D8 Other SQL compares** (no index in use: own-address exclusion, test senders, alias group, counterpart, delegate email) use `normalizedAddress(column)` against `normalizeAddress` values.
- **D9 Scan test.** One file, `apps/server/src/address-rule-scan.test.ts`, in the unit lane. Scanned: every non-test `.ts` file under `apps/server/src/modules/loops/`, `apps/server/src/modules/delegation/`, `packages/core/src/loops/`, plus `packages/core/src/send-limits.ts` and `packages/core/src/triage/rules.ts` (skip `*.test.ts`, `*.test-helper.ts`). Banned: a call of `.toLowerCase()` or `.toLocaleLowerCase()`; a string or template literal with `/\b(lower|upper)\s*\(/i` or `/\bilike\b/i`; a string literal that is exactly `lower` or `upper` (`eb.fn("lower", …)`). Exception: a comment `// not an address: <reason>` on the same line or the line before, with a reason of at least two words. Rejected: a ban only on values named `address`, `email` or `sender` (the finding): it misses `row.to[0]?.toLowerCase()`.
- **D10 Capability pages.** 01: `drafts-and-send.md`, `triage.md` (if they state the compare); 02: `delegation.md`; 03: `open-loops.md`; 05: the loop creation line in `open-loops.md` and one rule line in `docs/code-patterns.md` § Data access.

### Edge cases (answers)

- **Old row, new read:** a loop to `νίκος@example.gr` is closed by a reply from `ΝΊΚΟΣ@example.gr` (the database lowers it to `νίκοσ`): both sides fold to `νίκοσ@example.gr`. Test 03-T3.
- **Pins and guards:** a *guard* test fails without its guard or on the base code; a *pin* holds today's behaviour.
- **Two tenants:** every changed query keeps its `org_id` filter (02-T6, 03-T6).
- **Crash, repeat, two runs:** only compares change (D6 race).

## Facts checked (2026-11-20, base 535e6f76)

- Constraints: migrations `20261108000001_delegation.sql` (delegates CHECK, unique), `20261104000001_triage.sql` (pattern CHECK, unique), `20261115120001_suspicious_urgency_sender.sql` (`from_address_lower`, index), `20261115160001_open_loops.sql` (no address index).
- Layers: `apps/server/src/modules/layers.json`.
- Send targets: `delegation/chaser.ts` (`row.delegate_email`), `loops/follow-up-draft.ts` (`recipientsOf`).
- ASCII fast path origin: `notes/2026-11-19-f120-s05-suggestions.md` N3.

## Not verified

- Postgres `lower()` keeps `ς`, lowers `Σ` to `σ` and `İ` to `i` in the database locale. `address.ts` states it; the privacy rule check (`privacy/rule-check.ts`) tests it only before a data request or erase. Tests 02-T2, 03-T2 and 03-T3 run it on the job DB.

## Done when

1. `rg -n "normalizeSenderAddress|normalizeSenderPattern" apps packages tools` finds nothing.
2. The send limit counts `ΝΊΚΟΣ@example.gr`, `νίκος@example.gr` and `νίκοσ@example.gr` as one recipient (01-T1).
3. Every *guard* test of stages 01–04 fails on the base code or without its guard, and passes at the end.
4. No stored or sent address is in the rule form (01-T7, 02-T1, 04-T3).
5. `bun test apps/server/src/address-rule-scan.test.ts` passes on the real files and flags its bad samples (05-T1 … 05-T7).

## Rules for every stage

- A gap in a decision or a deviation is a question in your final message, not a choice.
- Format only the files of your stage. No repo-wide formatter.
- No migration, no `bun.lock` change, no `.env` read.
- For each *guard* test, remove its guard, run it, see it fail, restore it. Name the guard and the failing test in your result.
- Test addresses use `example.com` / `example.gr`; never log or print an address.
- Last step: `git merge --no-edit master`, then the Proof, then a commit (`.agents/limen/reminders.md`).

## Proof

```
mkdir -p /tmp/f142-sNN && bun run lint > /tmp/f142-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f142-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f142-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f142-sNN/int.log 2>&1 && echo PROOF_OK
```

## User checkpoints and steps

None (no migration, deploy, real system or spend).

## Review

Stage 03 `[risky]`: review on `claude-opus-5-5` before the land. Stage 02: review on `claude-sonnet-5-5`. 01, 04, 05 land on the worker's proof.

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
  'Implement F142 stage NN. Read ticket.md, plan.md and stages/stage-NN-<slug>.md in spec/features/active/F142-…/; build every step. Final proof: the Proof of plan.md with NN, after the last commit. List as proven only what a saved log shows.'
```

`limen land <job> --yes --keep-open` on 01 to 04; 05 closes the ticket. Drop the job DB after each land.

## Decisions taken

1. D1: no alias for the old names (rule-exception against the quality-pass text; undo: re-export the old name).
2. D4, D5: no data migration; stored and sent addresses keep today's form, the rule form is a compare key only (irreversible-safe; undo: none needed).
3. D6: a delegate or a sender rule whose address differs from an existing one only by `ς`/`σ`, the dotted I or padding is refused as `exists` (user-visible; undo: drop the pre-check).
4. D7: a reply outside the thread from a padded or combining-dot From does not close a loop (user-visible; undo: switch the read to `normalizedAddress` and accept a window scan).
5. Other private folds (reply drafts, outgoing sender, triage payloads, mail sync, login) stay out of scope; a follow-up ticket is proposed (scope).

## Planning progress

- [written] ticket.md, plan.md, scouts.md (2 scouts), stages 01–05.

## Cold review

`claude-opus-5-5` (stage 03 is `[risky]`). `plan-review-1.md`: 3 blocking, 7 notes, all fixed: B1, B2 and N7 (test values; tests marked guard or pin), B3 (D5, `storedAddressForm`), N1, N2 (ticket bullets), N3 (D6 sender rules), N4 (gone with B3), N5 (sweeps, subject marker), N6 (scan bans), D7 word-final positions, rule-check wording.
