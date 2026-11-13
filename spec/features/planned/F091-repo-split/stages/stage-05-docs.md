# F091 stage 05 — The checklist and the docs

Part of [`../plan.md`](../plan.md). Decisions: D5, D9, D10, D16, D17, D20. Needs stages 01, 02, 03 and 04 landed (the text names their files) and F086 stage 05 and F088 stage 07 landed (§ "Size and shape" and § "Notices are facts" exist). Docs only, no code. Two steps.

Precondition: `grep -n "## Size and shape\|## Notices are facts" docs/code-patterns.md` prints two lines, and `ls apps/server/src/modules/actions/repo/claims.ts apps/server/src/modules/mail/repo/targets.ts apps/server/src/modules/actions/completeness.test.ts packages/core/src/triage/draft-kinds.test.ts` lists four files. If not, stop and report what is missing.

## Step 1 — `docs/code-patterns.md`

**Goal.** The rule for splitting a big file, and the checklist "add an action type or a draft kind", each place with what fails when it is missed.

**Files.** `docs/code-patterns.md`.

**Interfaces.** Four edits. Write the text below as given (you may fix line wrap; keep the words). Check each path with `ls` before you write it; a path that does not exist is a question in the final message.

1. § "Layout and borders", the line "- Module files: `index.ts` (public API), `service.ts`, `repo.ts` (DB), …": replace `` `repo.ts` (DB) `` with `` `repo.ts` (DB; past about 400 lines a `repo/` folder, one file per aggregate, behind `repo/index.ts`: `actions/repo/`, `mail/repo/`) ``.
2. § "Data access": in the two exception lines that name `` (`mail/repo.ts` `` and `` (`mail/repo.ts`, S6a) ``, write `mail/repo/targets.ts` in place of `mail/repo.ts`.
3. § "Size and shape", add as the last bullet:

```markdown
- Split a file by moves, not rewrites. A repository becomes `repo/<aggregate>.ts` plus `repo/index.ts`, which re-exports by name every export of the old file and nothing else; importers keep `./repo` (it resolves to `repo/index.ts`), so no import path changes. A helper that two files need stays in the file of its topic with an internal export; `repo/shared.ts` holds only what has no topic (`DbOrTrx`, `actionTypeSchema`). Keep `git log --follow` for every new file with the history merge of `spec/features/*/F091-repo-split/tools.md` (`history-copies.sh`: one rename commit per new file, one merge, then the trim commit), and prove the move with its `same-bodies.ts` and `exports-of.ts`. Never rebase or squash such a branch; merge `master` into it. After its land, fix a failed push with `git pull --no-rebase`, not `git pull --rebase` (a rebase replays the copy commits and conflicts).
- A typed record keyed by the enum is the default for a per-kind choice. Where each case is a few lines inside a larger function (`decidePolicy`, `payloadOf`, `phrase`), an exhaustive `switch` with no `default` is allowed: typecheck fails on a missing case, as with a record. A `default` branch or an `if` chain that falls through to one kind is not.
```

4. A new section directly after § "Size and shape":

````markdown
## Add an action type or a draft kind

The types are `actionTypes` in `packages/core/src/triage/planners.ts`; the kinds are `draftKinds` in `packages/core/src/triage/payloads.ts`. Start there; typecheck and two tests then point to most other places. Two tests hold the lists together: `apps/server/src/modules/actions/completeness.test.ts` and `packages/core/src/triage/draft-kinds.test.ts`.

A new action type, in this order:

| # | Place | What fails when it is missed |
| --- | --- | --- |
| 1 | `actionTypes` and a `PlannedAction` member (`core/triage/planners.ts`); the planner that emits it | typecheck in the places below; `completeness.test.ts` case 1 |
| 2 | `decidePolicy` (`core/triage/policy.ts`); a tool switch in `config` if the user can turn it off | typecheck (`never` case) |
| 3 | The payload: a schema in `core/triage/payloads.ts` if it carries data; `payloadOf` (`triage/service.ts`) | typecheck (no `default` in `payloadOf`) |
| 4 | A migration that adds the type to `actions_type_check`, then `bun run db:types` | `actions-transitions.test.ts` (the CHECK list equals `actionTypes`) |
| 5 | `actions/transitions.ts`: an `ACTION_ENTRIES` row for `createPlanned`, its `ACTION_EDGES`, `WRITER_GUARDS` and `LATENT_EDGES` | `completeness.test.ts` cases 3 and 4; `transitions.test.ts`; `actions-transitions.test.ts` |
| 6 | An entry in `APPLY_HANDLERS` (`actions/apply.ts`) with its `needs`; the handler in its own file that imports `./apply-shared`, not `./apply` | typecheck (`Record<ActionType, ApplyHandler>`); `completeness.test.ts` cases 2 and 6 |
| 7 | `TYPE_RANK` (`actions/repo/claims.ts`); a claim filter if the type has its own scope | typecheck (`Record<ActionType, number>`) |
| 8 | Its line in the digest, the notices and the web activity: `phrase` in `core/digest/would-do.ts`, or `NO_PHRASE` in `completeness.test.ts` with the reason | typecheck (exhaustive `switch`); `completeness.test.ts` case 5 |
| 9 | A notice for the type, if it has one: § "Notices are facts", checklist "Add a notice kind" | that checklist's test |
| 10 | `docs/architecture.md` §4.6 (status flow) and `docs/modules.md` §3.5 | review only |

A type that sends mail needs `needs.sender` and an approval record (ADR 0003): the system never sends without one. `completeness.test.ts` case 7 fails until the owner's decision is written into it.

A new draft kind, in this order:

| # | Place | What fails when it is missed |
| --- | --- | --- |
| 1 | `draftKinds` and a `draftPayloadSchema` member (`core/triage/payloads.ts`) | `draft-kinds.test.ts` case 1; the send schema, `sendKindSchema` (`actions/repo/reads.ts`) and the notice views follow the list |
| 2 | `DRAFT_TEMPLATES` (`core/outgoing/templates.ts`) | typecheck; `draft-kinds.test.ts` case 3 |
| 3 | The planner or the job that creates it (`core/triage/planners.ts`, `delegation/chaser.ts`) | its own tests |
| 4 | The lines that branch on `kind` and fall through to a default: `core/outgoing/message.ts` (quote, `In-Reply-To`), `core/outgoing/sender.ts` (sender label), `core/digest/approvals.ts` (card title), `core/digest/would-do.ts` (`draftPhrase`), `actions/approvals.ts`, `actions/expiry.ts`, `delegation/service.ts`, `channels/notices/` | no test: read each hit of `grep -rnE '(kind\|\.kind) (===\|!==) "(delegation\|clarification\|reminder)"\|"reminder" in' packages/core/src apps/server/src --include=*.ts` |
| 5 | A prompt or model change for it | `bun run eval` and its go/no-go table |
````

**Decisions.** D5 (the checklist), D16, D17, D22 (no rebase after the land), D23 (exhaustive `switch` allowed). D20: the files over 400 lines that stay (`actions/send.ts`, `mail/sync.ts`, `actions/transitions.ts`) are not named in the rule text.

**Test.** Markdown only.

1. `grep -n "## Add an action type or a draft kind" docs/code-patterns.md` prints one line.
2. `grep -c "mail/repo\.ts" docs/code-patterns.md` prints `0`.
3. Each path in the two tables exists: `ls packages/core/src/triage/planners.ts packages/core/src/triage/policy.ts packages/core/src/triage/payloads.ts apps/server/src/modules/triage/service.ts apps/server/src/modules/actions/transitions.ts apps/server/src/modules/actions/apply.ts apps/server/src/modules/actions/apply-shared.ts apps/server/src/modules/actions/repo/claims.ts apps/server/src/modules/actions/repo/reads.ts packages/core/src/digest/would-do.ts apps/server/src/modules/actions/completeness.test.ts packages/core/src/triage/draft-kinds.test.ts packages/core/src/outgoing/templates.ts packages/core/src/outgoing/message.ts packages/core/src/outgoing/sender.ts packages/core/src/digest/approvals.ts apps/server/src/modules/delegation/chaser.ts apps/server/src/modules/delegation/service.ts apps/server/src/modules/mail/repo/targets.ts` lists every file with no error; `ls -d apps/server/src/modules/channels/notices` too.

**Check.** `bunx prettier --write docs/code-patterns.md` then `bunx prettier --check docs/code-patterns.md` passes.

**Done when.** Tests 1–3 hold.

**Out of scope.** Converting the per-kind `if` lines into records. A split of `send.ts`, `sync.ts`, `transitions.ts`.

## Step 2 — `docs/modules.md` and the styleguide

**Goal.** The module map names the new files; the short form tells every worker where the checklist is.

**Files.** `docs/modules.md`, `.agents/limen/styleguide.md`.

**Interfaces.**

`docs/modules.md`:

- §3 intro line "Each module folder: `index.ts` (public API), `service.ts`, `repo.ts` (DB), …": write `` `repo.ts` (DB; or a `repo/` folder, `docs/code-patterns.md` § Size and shape) ``.
- §3.2 `mail`, the table row `` `repo.ts` ``: the first cell becomes `` `repo/` ``; the second cell starts with "One file per aggregate behind `repo/index.ts`: `mailboxes.ts` (row, status, summary), `folders.ts` (synced folders, cursors, `forceRescan`), `credentials.ts`, `emails.ts` (`MailKind`, row writes and reads), `copies.ts` (copy identity, `listFolderUids`, `listRecentlyMoved`), `targets.ts` (cross-organization lists), `claims.ts` (triage claim and queue), `lookup.ts` (thread, Message-ID), `retention.ts`. " and keeps the rest of the old text after it.
- §3.5 `actions`, the S3 table row `` `repo.ts` ``: the first cell becomes `` `repo/` ``; the second cell starts with "One file per aggregate behind `repo/index.ts`: `planned.ts`, `reads.ts`, `filters.ts`, `claims.ts`, `lifecycle.ts` (`markApplying`, `finishAction`, `releaseAction`), `expiry.ts`, `undo.ts`, `sends.ts`, `drafts.ts`, `notify.ts`, `approvals.ts` (approval expiry, `countApprovals`), `retention.ts`. " and keeps the rest.
- §3.5, the S3 row `` `apply.ts` ``: add at the end "Dispatch through `APPLY_HANDLERS` (one entry per type with its `needs`; the committer reads the needs too); shared types in `apply-shared.ts`."
- §3.5, the S4 bullet that starts "- `repo.ts` adds the claims for drafts and sends": replace `` `repo.ts` adds `` with `` `repo.ts` (now `repo/`) added ``.
- §3.5, the S4 bullet "- `apply.ts` and `committer.ts` dispatch `create_draft` and `send` to these files; …": add at the end "Since the handler table, a new type is one `APPLY_HANDLERS` entry (`docs/code-patterns.md` § Add an action type or a draft kind)."

`.agents/limen/styleguide.md` § Prefer, add one bullet at the end:

- "A new action type or draft kind follows `docs/code-patterns.md` § Add an action type or a draft kind; `actions/completeness.test.ts` and `core/triage/draft-kinds.test.ts` fail on most missed places. A file split moves code with the F091 scripts (history merge, `same-bodies.ts`); never rebase that branch."

**Decisions.** D9, D10, D13.

**Test.**

1. `grep -c "repo/index.ts" docs/modules.md` prints at least `2`.
2. `grep -n "APPLY_HANDLERS" docs/modules.md` prints at least one line.
3. `grep -n "Add an action type or a draft kind" .agents/limen/styleguide.md` prints one line; `wc -l < .agents/limen/styleguide.md` is under `1000`.

**Check.** `bunx prettier --write docs/modules.md .agents/limen/styleguide.md` then `bunx prettier --check docs/modules.md .agents/limen/styleguide.md` passes.

**Done when.** Tests 1–3 hold.

**Out of scope.** `docs/diagrams/architecture-2026-11.*` (a dated snapshot). `docs/architecture.md` (no file name of these folders in it). Other sections of `modules.md`.

## Stage done when

- Steps 1 and 2 are done, with their checks. One commit by explicit paths.
- The Proof of `plan.md` (stage 05 form, `<files>` = `docs/code-patterns.md docs/modules.md .agents/limen/styleguide.md`) prints `PROOF_OK`, run after the last commit with nothing after it.
