# F150 stage 01 — stale statements and string codes

Needs: nothing. May run next to 02 and 03.
Part of [`../plan.md`](../plan.md).

## Step 1 — the repository states its real layout

- **Goal:** no guide line, task file or script claims a state that is gone.
- **Decisions:** D7, D8, D9.
- **Do:**
  - Rewrite the layout line of `CLAUDE.md` (the "Now: Astro starter …" line) from `docs/architecture.md`. Keep the line short. Name no LLM provider list.
  - Update the "old S6 files in `tasks/`" line of `CLAUDE.md` so it names only the files that stay (`s6-pre-sale`, `s6b`, `s6f`).
  - Delete `tasks/planned/s6c-account-data.md` and `tasks/planned/s6e-papers-cost.md`. Update the history banner of `tasks/README.md` to name the files that stay.
  - Delete `scripts/one-off/migrate-tasks.ts` and the folder. Remove any config entry that names it (knip, tsconfig, `package.json`); leave history records under `spec/`.
- **Test:** none (text and file removal). Check: `bun run typecheck` and `bun run lint` pass after the delete (they run in `check:job`).
- **Done when:** `ls tasks/planned` prints only `s6f-hosted-production.md`; `test ! -e scripts/one-off` holds.
- **Out of scope:** the links to the deleted files inside `tasks/active/s6-pre-sale.md` and `docs/product/stage-2/epics/E10-discovery-notes.md` (D7: records).

## Step 2 — string and JSON values hold no ticket code

- **Goal:** every non-test source string and JSON value outside `apps/docs` is free of `STRING_CODE` hits (plan D2: F-number without slug, `PD-` number, "stage(s) N", "review (round) N").
- **Decisions:** D2, D3, D4, P2.
- **Places at the plan base** (re-find at `HEAD`: other tickets move code):
  - `apps/server/src/modules/layers.json`: the reason of the `replies → actions` pair. Write what the edge does, no stage range.
  - `apps/server/src/platform/config-llm.ts`: the removed-key message names F141. Keep the message meaning ("removed: every role uses the tiers of `LLM_PROVIDER`; delete this line"). Update the test that asserts the text.
  - `apps/server/src/platform/outside-services.ts`: two `exempt` reasons name F141 P4 and F118. Write the rule in words (the config refusal; the own Web Push identity).
  - `apps/server/src/modules/replies/drafter-eval-report.ts`: two report lines name PD-083. Name the bar in words (for example "drafter bar"). Do not edit committed reports under `evals/results/`. Update a test that asserts the line.
  - `tools/mail-oauth-spike/rows-*.ts`: the test mail text "Test mail of the F117 spike" becomes a text with no code (for example "Test mail of the mail OAuth spike").
- **Find more:** a new hit that landed after the plan base gets the same treatment. Use a one-off local search; do not commit a search script (stage 04 owns the scan).
- **Test:** each test that asserts a changed string changes with it and passes with `bun test <file>`.
- **Done when:** the changed tests pass; `check:job` passes.
- **Out of scope:** `apps/docs/src/flagged-text.ts` (stage 02), `docs/modules.md` (stage 03), letter codes such as `S1` or `P1` in strings (D2: data ids), test files (D3).

## Proof

`bun run check:job`; copy its last line into the final message.
