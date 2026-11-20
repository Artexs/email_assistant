# F143 stage 02 — delegation, audit and push repositories by aggregate

Needs: nothing. Reads `SIZE_EXCEPTIONS` of stage 01 only if it exists at `HEAD`. May run next to every other stage; not next to an open F142 stage 02 (the one-address-rule change of `delegation/repo.ts`).
Part of [`../plan.md`](../plan.md).

## Goal

Three repository files become `repo/` folders by aggregate, with the F091 tools (D5), the same exports behind `repo/index.ts` (D7), and no importer edit.

## Step 1 — delegation (809 lines)

- `apps/server/src/modules/delegation/repo.ts` → `delegation/repo/delegates.ts` (the `delegates` table and its reads) and `delegation/repo/delegations.ts` (the `delegations` table). A third file only if one of them is still over 400 lines: split `delegations` by reads and writes (`delegations-read.ts`), not by a helper file. `repo/shared.ts` only for code with no topic (`docs/code-patterns.md` § Size and shape).
- If `SIZE_EXCEPTIONS` exists, delete the `delegation/repo.ts` entry (D4).

## Step 2 — audit (559 lines)

- `modules/audit/repo.ts` → `audit/repo/events.ts` (the `auditEvents` catalogue and the `AuditEvent` and `AuditData` types), `audit/repo/audit.ts` (the `audit_log` writes, reads, counts and lists), `audit/repo/llm-calls.ts` (`LlmCallRecord`, `HISTORY_CHECK_KEY`, `recordLlmCall` and the `llm_calls` sums and counts).
- `audit/metrics-repo.ts` and `llm-pause.ts` stay as they are.

## Step 3 — push subscriptions (405 lines)

- `modules/channels/push/repo.ts` → `push/repo/subscriptions.ts` (lock, upsert, remove, `endpointHash`, `PushDeviceElsewhereError`, `MAX_DEVICES_PER_USER`, the `pushDedupKey` re-export) and `push/repo/devices.ts` (live devices, push-only members, device views, device secret, the success and error marks).

## Method (each step)

1. Copy the four F091 scripts from `spec/features/done/2026-11/F091-repo-split/tools.md` to `/tmp/f143-s02/`. Write the map for the step. Dry run `split-repo.ts` into `/tmp`; fix the map until it passes.
2. `history-copies.sh`, then the real split, `eslint --fix` and `prettier --write` on the new files only, then the trim commit right after the history merge.
3. Edit by hand only an import line that `bun run typecheck` names.
4. One history merge per file, three steps, three trim commits. If `master` changed a file of a step before your land: D6 (redo from the new `master`).

## Test

No new test: behaviour does not change. The guard is the size rule of stage 01 and these move proofs, saved per step in `/tmp/f143-s02/<module>/`:

1. `same-bodies.ts` prints `SAME_BODIES <n>` and exits 0.
2. `exports-of.ts` of the old file at the base equals that of `repo/index.ts`: `diff` prints nothing (`EXPORTS_SAME`).
3. Each new file: `git log --follow --format=%h` reaches the first commit of the old file.
4. The old file is gone; `wc -l` of each new file ≤ 400.
5. `git diff --name-only <base> HEAD -- apps/server/test` and the importers of each module print nothing.
6. Mutation check (once, for delegation): change one constant in a copy, `same-bodies.ts` exits 1 naming it; revert. Write it in the final message.

## Docs

Update a path to `delegation/repo.ts`, `audit/repo.ts` or `push/repo.ts` in `docs/modules.md` or `docs/capabilities/` to the new file.

## Done when

- The three folders exist, every check above passed, and the logs are named in the final message.
- Proof: `mkdir -p /tmp/f143-s02 && bun run lint > /tmp/f143-s02/lint.log 2>&1 && bun run typecheck > /tmp/f143-s02/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f143-s02/unit.log 2>&1 && bun run test:int:ci > /tmp/f143-s02/int.log 2>&1 && echo PROOF_OK`

## Out of scope

`delegation/service.ts` (475 lines, warning only). Any query change, including the address rule of F142.
