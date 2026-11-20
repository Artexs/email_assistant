# F136 plan — parallel Playwright suites with no shared lock

> **Status 2026-11-19 — planned.** Plan base: b3ad2e07. Six stages, none built.

## Input

Owner task (2026-11-19, word for word): "Decide: ports from env with a per-job default derived in limen-prepare.sh, or a free port found at start; per-job e2e DB in limen-prepare.sh; per-run mail addresses on the shared GreenMail. The last stage removes the lock rule from CLAUDE.md, the styleguide, docs/code-patterns.md and the Proof lines of the F121 stages that are still open (name them; the coordinator applies edits outside the folder). The plan touches no test file that F125 cuts (F125 is read-only until its G1)." Also: "no new package (no bun.lock change)".

Ticket decisions stand: `workers: 1` stays; no CI sharding; unit and integration suites are F124's.

### Design decisions

- **D1 Ports come from env.** Keys `E2E_PORT`, `E2E_TELEGRAM_PORT` (panel suite) and `DOCS_TEST_PORT` (docs suite). Unset or empty → 8081, 8092, 8093. A value that is not an integer 1024–65535, or two equal panel ports, throws before any server starts, and the message names the key. Process env wins over `.env`. Rejected: a free port found at start (the server binds after `db:migrate`, a race of seconds; workers re-evaluate the config).
- **D2 Prepare gives each job a port block.** Slot `s` (0–999) gives `20000 + 10·s`, `+1`, `+2`. Start at `parseInt(hash, 16) mod 1000`, probe linearly, wrap at 999. A slot is taken when another worktree's `.env` names its `E2E_PORT`, or when a bind test on 127.0.0.1 fails. Prepare holds `flock /tmp/email-assistant-e2e-ports.lock` only for the pick and the write. That lock is not a test lock.
- **D3 The port modules load the repo `.env` at import.** `env.ts` and `site.ts` do it, because import hoisting runs them before the config body and the Node runner loads no `.env`. Set keys win (F2). A config computes its origin **per evaluation** through a function (`docsLocalOrigin(env)`), not through a module constant (review B1).
- **D4 Each job gets its own e2e DB from prepare** (`db:worktree <name>-e2e`, which `seedTargetOk` accepts). Prepare writes `E2E_DATABASE_URL` and `E2E_MIGRATOR_DATABASE_URL`. It strips eight keys from the copy of the main `.env`: both pairs of DB URLs, the three ports and `E2E_MAIL_TAG`. Effect (review N1): the integration suite "e2e seed of the plan states", which every job skips today, now runs in every job. A new script `db:migrate:e2e` migrates the job e2e DB after a migration (stage 04). `test:e2e` migrates it anyway.
- **D5 `db:worktree <name> --drop` also drops `<name>-e2e`.** An unmarked sibling refuses the whole drop. A missing sibling prints nothing, so existing stdout assertions hold (review B2). Rejected: a second drop command (forgotten drops leak DBs).
- **D6 Per-job mail tag.** `E2E_MAIL_TAG` holds the job hash. When it is empty, the addresses stay as today (main checkout, CI). One function maps `e2e-mobile@e2e.test` to `e2e-mobile-<tag>@e2e.test`. `mailboxAddress` and every address that `seedAssistMailbox` gets go through it. When a tag is set, `seedAssistMailbox` refuses an untagged address, so a later seed edit cannot slip past (review N6). Three addresses stay shared:
  - `anna@example.com`, the send sink that no spec reads.
  - `e2e-paused-box@x.test`, a paused mailbox that is never synced. `plan.spec.ts` asserts it literally (review N5).
  - Addresses that never reach GreenMail.
  Reason: GreenMail has auth disabled, so runs would share Drafts, where the committer appends. Rejected: shared addresses (unproven safe).
- **D7 Names that other code reads stay exported.** `E2E_PORT`, `E2E_BASE_URL`, `E2E_TELEGRAM_PORT`, `E2E_TELEGRAM_URL`, `DOCS_TEST_PORT` and `DOCS_LOCAL_ORIGIN` now mean "this run". `docs-shots.config.ts` and F121's `demo.config.ts` need no edit. `servers.ts` keeps `--port ${E2E_TELEGRAM_PORT}` (`shot-run.test.ts` asserts it).
- **D8 Test files.** No `*.spec.ts` change. One existing test file changes: `apps/docs/scripts/browser-check.test.ts`, two assertions, the same case count. New cases go into new files (Q1).
- **D9 No memory cap.** A docs run peaks at about 2.2 GB (F3). Stage 05 measures the panel run, and `CLAUDE.md` states the figure. Limen's memory gate acts only at job start; it does not bound a run (review N11). Q2.
- **D10 A job prepared before stage 04** runs `bash scripts/limen-prepare.sh` again in its worktree. `LIMEN_JOB_ID` is set there, and the script is idempotent (review N4). The `env.ts` missing-key message says so.
- **D11 Prepare fails hard** when the e2e DB or the port block fails (Q4). A job name with no hex tail is not a failure: the CLI hashes the name (review N9).
- **D12 One panel-suite run at a time per worktree** (`test:e2e`, `docs:shots`, `demo:record` share the ports, the DB and `test-results`; review N7). `demo:record` keeps the shared lock for the shared demo DB of the main `.env`.

## Facts checked (2026-11-19)

- F1 Playwright 1.65.0 on Node; `reuseExistingServer: false`; 20000–29999 is free and below the ephemeral range.
- F2 `process.loadEnvFile` keeps a value that is already set (probe on Node 26 and Bun 1.4.4).
- F3 Two `docs:test` runs at once, on 18093 and 18193 (through `DOCS_TEST_URL`): 98 passed each, in 2.1 min. Peak RSS was 2.2 GB per run (the sum over the process tree).
- F4 The only literal GreenMail address in a spec is `e2e-paused-box@x.test` (`plan.spec.ts`; corrected by review N5).
- F5 `bun test` loads `.env`. Bun caches `site.ts` across cache-busted config imports (reproduced by review B1).
- F6 The main `.env` has no `E2E_*` key (the review counted key names only).

## Not verified

- N2 Peak memory of a panel run: stage 05 measures it.
- N3 Another shared resource: stage 05 shows it. Such a failure is a gap to report, not a thing to patch.

## Done when

The ticket's six Acceptance lines. Stage 05 proves lines 1–3. Stage 06 proves line 6. Records R1 and R2 cover lines 4–5.

## Rules for every stage

- Format only the stage's files. No new package, no `bun.lock` change, no migration.
- Never print `.env` lines or DB URLs.
- Until stage 04 lands, Playwright runs use the lock. The exception is a run that has job ports, its own e2e DB and a mail tag (stage 04 test 7).
- Before the new prepare, a stage that runs `test:e2e` makes its own e2e DB, named `f136_sNN_e2e`.
- Edit no `*.spec.ts`, and no existing test file except the one in D8.
- A gap or a deviation is a question in the final message.

## Proof

`mkdir -p /tmp/f136-sNN && bun run lint > /tmp/f136-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f136-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f136-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f136-sNN/int.log 2>&1 && <stage links> && echo PROOF_OK`

## Coordinator records and steps

- C0 Before R1: make the main e2e DB and add its two `E2E_*DATABASE_URL` keys to the main `.env`, as the `env.ts` message says (review B3).
- R1 After stage 06, run in the main checkout with no port or tag keys: `bun run web:build && bun run test:e2e`, then `bun run docs:build && bun run docs:test`. Both pass on 8081, 8092 and 8093.
- R2 The first `master` CI run after the land is green.
- C1 Apply the list in stage 06's `coordinator-edits.md`.
- C2 Drop the hand-made DBs of stages 01–02: `bun run db:worktree f136_s01_e2e --drop`, and the same for `s02` (review N8).

## Review

Stage 04 `[risky]` gets an Opus review before the land. The other stages land on their proof.

## Stages

Order: {01, 02} → 03 (after 01; may run next to 02) → 04 → 05 → 06.

- [ ] 01 Ports from env, both suites.
- [ ] 02 Mail tag for GreenMail addresses.
- [ ] 03 Port block picker; DB drop of the sibling.
- [ ] 04 `[risky]` Prepare writes the job e2e env.
- [ ] 05 Parallel proof, three rounds.
- [ ] 06 The lock leaves the rules.

## How to run (coordinator)

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F136" [--timeout 150m for stage 05] \
  'Implement F136 stage NN. Read ticket.md, plan.md and stages/stage-NN-<slug>.md in spec/features/active/F136-…/. Final proof: plan.md Proof plus the stage links.'
```

Land each stage with `--yes --keep-open`, except stage 06. Drop each job DB after its land. Spawn stage 05 after stage 04 lands.

## Planning progress

Scouts: 3, all returned (`scouts.md`). All files written.

## Cold review

Reviewer: `claude-opus-5-5`, because stage 04 is `[risky]` (every job runs prepare). Verdict: FAIL, with 3 blocking findings and 11 notes (`plan-review-1.md`). All are fixed:

B1 → D3, stage 01 test 9. B2 → D5. B3 → C0. N1 → D4, stage 04. N2 → stage 04 test 6. N3 → lock rule. N4 → D10. N5 → D6, F4. N6 → D6, stage 02. N7 → D12. N8 → C2. N9 → D11, stage 03. N10 → stage 05 (one run of the script, logs grepped). N11 → D9.

## Log

- 2026-11-19: planned (job `2026-11-19-f136-plan-ef6344ef`) and fixed after review 1.
