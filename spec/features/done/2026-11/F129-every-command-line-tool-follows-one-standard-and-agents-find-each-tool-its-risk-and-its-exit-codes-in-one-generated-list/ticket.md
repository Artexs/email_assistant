---
opened: 2026-11-15
landed: 2026-11-20
---

# F129 · Every command-line tool follows one standard, and agents find each tool, its risk and its exit codes in one generated list

## Outcome

Agents check their changes with the repository's command-line tools (`job:run`, `fake-tg`, `mailbox:seed`, `sim`, …). After this ticket every tool follows one written standard (`docs/cli.md`): flags, `--help`, one exit-code table, short output with ids and counts only, and a risk class that says whether an agent may run it without asking. `bun run cli:list` prints every tool from the tools' own descriptions, so the list cannot go stale. Overlapping tools are merged or removed first, and a test fails when a tool breaks the standard.

## Scope

- Design input with facts, the draft standard, the inventory and 12 edge cases: [`notes/2026-11-15-cli-standard.md`](../../../../notes/2026-11-15-cli-standard.md). The planner checks each fact at its base.
- Inventory stage first (note § 4.10): keep, merge or remove each overlap candidate (`gemini:test`, `mailbox:probe-*`, `testmail:*` and the `testmail` module, `triage:cost` vs M7), and move the 12 helper files to `scripts/lib/`.
- `docs/cli.md`; `platform/cli.ts` grows `runCli` (help, exit codes, uncaught error, `--json` writer); a description per tool; `cli:list`.
- Every tool in `apps/server/src/scripts/` and `tools/fake-telegram` converted, by area, with every caller of a changed exit code (CI, `scripts/limen-prepare.sh`, Playwright setup, runbooks, `docs/capabilities/`).
- The standard test and the lint rule; the allow-list of old tools shrinks per stage and is gone at the end.

## Out of scope

- The CLI output helper and the log-line conversion: F103 stages 02–04 do them.
- Per-job ports for `test:e2e`: a separate ticket.
- `scripts/one-off/` and the shell scripts in `scripts/`.
- New operator features: a tool changes shape, not behaviour, except the merges of the inventory stage.

## Acceptance

- `bun run cli:list` prints one row per `package.json` tool command with its summary, risk and needs; `--json` gives the same as one JSON value.
- `bun run <tool> --help` exits 0 for every tool with no env and no DB; an unknown flag exits 2.
- The standard test has no allow-list left and passes in `bun run test:unit:ci`.
- `bun run lint` passes, and `process.exit` or `process.stdout.write` in a script outside `platform/cli.ts` fails it.
- The inventory stage report lists each candidate with its decision and reason; removed commands are gone from `package.json` and from every doc.
- `bun run test:int:ci` and `bun run test:e2e` pass; `plan.md` § Done when holds the full list.

## Slices

Seventeen worker stages (00–16), one job each; groups and Needs in `plan.md` § Stages and § How to run. The eleven conversion stages (05–15) run next to each other. No migration, no `bun.lock` change.

## Sequenced

- Plan after: none.
- Build after: F136 (parallel Playwright: it owns `e2e-job-env.ts`, `db-worktree.ts`, `scripts/limen-prepare.sh`) and F141 (one LLM provider: it edits `llm-check.ts`, `eval-args.ts`, `eval-config.ts`) in `done/`. F103 (log lines and the CLI output helper) is in `done/`.
- Gate: —

## Notes

Owner decisions 2026-11-15 (note § 8): convert all tools now, in stages; agents run `read`, `dev` and `write` tools freely on the dev or job DB, `cost` tools only when the task names them, `outside` and `danger` tools only with the owner's OK; the same tools and rules work on the VPS through `$C run --rm cli`.
