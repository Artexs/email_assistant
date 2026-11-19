# F136 plan — parallel Playwright suites with no shared lock

> **Status 2026-11-19 — planned.** Plan base: b3ad2e07. Six stages, none built.

## Input

Owner task (2026-11-19, word for word): "Decide: ports from env with a per-job default derived in limen-prepare.sh, or a free port found at start; per-job e2e DB in limen-prepare.sh; per-run mail addresses on the shared GreenMail. The last stage removes the lock rule from CLAUDE.md, the styleguide, docs/code-patterns.md and the Proof lines of the F121 stages that are still open (name them; the coordinator applies edits outside the folder). The plan touches no test file that F125 cuts (F125 is read-only until its G1)." Also: "no new package (no bun.lock change)".

Ticket decisions stand: `workers: 1` stays; no CI sharding; unit and integration suites are F124's.

### Design decisions

- **D1 Ports come from env, one resolver per suite.** Keys `E2E_PORT`, `E2E_TELEGRAM_PORT` (panel suite, `apps/web/e2e/env.ts`) and `DOCS_TEST_PORT` (docs suite, `apps/docs/e2e/site.ts`). Unset or empty → 8081, 8092, 8093. A value that is not an integer 1024–65535, or `E2E_PORT` equal to `E2E_TELEGRAM_PORT`, throws before any server starts; the message names the key. Process env wins over `.env`. Rejected: a free port found at run start (the server binds only after `db:migrate`, a race of seconds; each Playwright worker evaluates the config again; a fixed port per job is easier to debug).
- **D2 Each job gets a port block from `limen-prepare.sh`.** Slot `s` gives `E2E_PORT = 20000 + 10·s`, `E2E_TELEGRAM_PORT = +1`, `DOCS_TEST_PORT = +2`, with `s` in 0–999. Start at `parseInt(hash, 16) mod 1000` (`hash` = hex end of the job id), probe linearly, wrap at 999. A slot is taken when another worktree's `.env` (from `git worktree list --porcelain` at the main checkout) names its `E2E_PORT`, or when a bind test on 127.0.0.1 fails for one of its three ports. The range is below the ephemeral range. Prepare holds `flock /tmp/email-assistant-e2e-ports.lock` only while it picks and writes the block (not a test lock).
- **D3 Each port module loads the repo `.env` itself at import.** Import hoisting runs `env.ts` and `site.ts` before the config body, and the Node runner loads no `.env`. Set keys win (F2).
- **D4 Each job gets its own e2e DB from prepare.** Prepare runs `db:worktree <name>-e2e` (DB `email_assistant_<date>_<hash>_e2e`, which `seedTargetOk` accepts) and writes `E2E_DATABASE_URL` and `E2E_MIGRATOR_DATABASE_URL`. It strips any of the eight keys (`DATABASE_URL`, `MIGRATOR_DATABASE_URL`, both `E2E_*_DATABASE_URL`, the three ports, `E2E_MAIL_TAG`) from the copy of the main `.env`. Today a job copies the main `E2E_*` keys if they exist, so every job's `test:int` (`e2e-seed.test.ts`) wipes one shared e2e DB; D4 removes that too (N1).
- **D5 `db:worktree <name> --drop` also drops `<name>-e2e`.** The drop step stays one command. An unmarked sibling refuses the whole drop; a missing one is fine. Rejected: a second drop command (forgotten drops leak DBs).
- **D6 Per-job mail tag.** `E2E_MAIL_TAG` (prepare writes the job hash; empty → today's addresses, so the main checkout and CI do not change). One function turns a base address into the run address: `e2e-mobile@e2e.test` → `e2e-mobile-<tag>@e2e.test`. Every GreenMail-backed address goes through it: `mailboxAddress` in `apps/web/e2e/helpers.ts` and every address that `seedAssistMailbox` gets. Addresses that never reach GreenMail (`del-phone@x.test`, user logins) stay as they are. `anna@example.com` (the send sink, `E2E_SEND_TEST_ADDRESS`) stays shared: no spec reads it. Reason: GreenMail runs with auth disabled, so two runs would share the Drafts and INBOX of one account, where the committer appends drafts (scout 1, item 5). Rejected: shared addresses (probably harmless, but unproven; a later spec that reads IMAP would flake only under parallel load).
- **D7 Names that other code reads stay.** `E2E_PORT`, `E2E_BASE_URL`, `E2E_TELEGRAM_PORT`, `E2E_TELEGRAM_URL`, `DOCS_TEST_PORT` and `DOCS_LOCAL_ORIGIN` stay exported and now mean "the port of this run". `docs-shots.config.ts` and F121's `demo.config.ts` get job ports with no edit. `servers.ts` keeps the literal `--port ${E2E_TELEGRAM_PORT}` (`apps/docs/scripts/shot-run.test.ts` asserts it).
- **D8 Test files.** No `*.spec.ts` changes. The only existing test file that changes is `apps/docs/scripts/browser-check.test.ts`: two assertions that would fail in a job worktree (F5); same case count. New cases go into new files. F125 names no cuts before its G1 (Q1).
- **D9 No memory cap.** One docs run peaks at about 2.2 GB RSS (F3). Stage 05 measures the panel run; stage 06 writes the figure into `CLAUDE.md`. Limen's start gate (memory ≥ 20 % free) is the only limit. Default, owner to confirm (Q2).
- **D10 Jobs prepared before stage 04 lands** use the default ports and fail fast on a busy port. `CLAUDE.md` tells such a job to append the output of `bun apps/server/src/scripts/e2e-job-env.ts` and to make its e2e DB as the `env.ts` message says. Until stage 04 lands, every Playwright run in stages 01–04 keeps the lock.
- **D11 Prepare fails hard** when the e2e DB or the port block fails (Q4). Rejected: a warning; a half-prepared job would collide on default ports.
- **D12 The lock stays for one named resource:** `demo:record` (F121 stage 10) uses the shared `DEMO_DATABASE_URL` of the main `.env`. `CLAUDE.md`, `.agents` and `docs` lose the lock entirely.

## Facts checked (2026-11-19)

- F1 Playwright 1.65.0 on Node; `reuseExistingServer: false` in both configs; nothing listens on 20000–29999 (`ss -ltn`); ephemeral range 32768–60999.
- F2 `process.loadEnvFile` keeps a set value (probe, Node 26 and Bun 1.4.4).
- F3 Two `docs:test` runs at once on ports 18093 and 18193 (through `DOCS_TEST_URL`): 98 passed each, 2.1 min, peak RSS sum of the run's process tree 2.2 GB (shared pages counted twice), static server 59 MB.
- F4 No spec holds a literal GreenMail address (`grep` over `apps/web/e2e/tests` and `docs-shots`).
- F5 `bun test` loads `.env`; `browser-check.test.ts` asserts port 8093 and the config URL.
- F6 Lock text under the ticket's grep: `CLAUDE.md`, the styleguide, `docs/code-patterns.md` § Docs site.

## Not verified

- N1 Whether the main `.env` holds `E2E_*` keys (no `.env` reads in planning). D4 is right either way.
- N2 Peak memory of a panel run, and three panel runs plus agents on this PC: stage 05 measures it.
- N3 Another shared resource: stage 05's rounds show it; such a failure is a gap to report, not to patch.

## Done when

The ticket's six Acceptance lines. Stage 05 proves lines 1–3. Stage 06 proves line 6. Lines 4–5 are coordinator records R1 and R2.

## Rules for every stage

- Format only the stage's files. No new package, no `bun.lock` change, no migration.
- Never print `.env` lines or DB URLs. Port numbers, DB names and the tag may appear in output.
- Until stage 04 lands, run `test:e2e`, `docs:test` and `docs:shots` only under `flock /tmp/email-assistant-shared-tests.lock`.
- Before the new prepare, a stage that runs `test:e2e` makes its own e2e DB as the `env.ts` message says (`f136_sNN_e2e`).
- Edit no `*.spec.ts`, and no existing test file except the one in D8.
- A gap or a deviation is a question in the final message, not a choice.

## Proof

`mkdir -p /tmp/f136-sNN && bun run lint > /tmp/f136-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f136-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f136-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f136-sNN/int.log 2>&1 && <stage links> && echo PROOF_OK`. 

## Coordinator records and steps

- R1 After stage 06 lands: in the main checkout with no new keys, `bun run web:build && bun run test:e2e`, then `bun run docs:build && bun run docs:test`. Both pass on 8081/8092/8093.
- R2 The first `master` CI run after the land is green.
- C1 Apply the edits outside this folder that stage 06's final message lists (F121 stage files, `spec/build.md`, F124 `plan.md`, `shot-run.test.ts` comment after F125 G1).

## Review

Stage 04 `[risky]` gets an Opus review before the land: every later job runs this prepare. The other stages land on their proof.

## Stages

Files in `stages/`. Order: {01, 02} → 03 (after 01; next to 02) → 04 → 05 → 06.

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

Start each stage when its Needs line holds. Land with `--yes --keep-open`, except stage 06. Drop each job DB after the land (after stage 03, the command also drops `-e2e`). Spawn stage 05 after stage 04 lands.

## Planning progress

- Scouts: 3 (all returned; `scouts.md`).
- All files written. `wc -w`: plan 1,478; stages 621, 557, 690, 616, 618, 694.

## Cold review

Pending.

## Log

- 2026-11-19 planned (job `2026-11-19-f136-plan-ef6344ef`).
