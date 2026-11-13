# F091 · Repository split and table-driven apply: plan

> **Status 2026-11-13 — planned.** Five stages written. Builds after F086, F088 and F090 are in `spec/features/done/`. Ticket: [ticket.md](ticket.md). Split scripts: [tools.md](tools.md). Open defaults: [questions.md](questions.md).

## Planning progress

- [written] stage 01 · [written] stage 02 · [written] stage 03 · [written] stage 04 · [written] stage 05
- [written] tools.md (scripts and maps, probed)
- [ ] cold review (`plan-review-1.md`)

## Input

Source: the architecture review (`docs/product/stage-2/06-architecture-review.md` §3.3, §3.8) and the foundation plan (`docs/product/stage-2/07-foundation-plan.md` §1 row 7, §2: "lane B `F088 → F091`"; "E4-A, E5b and E6a start after F091."). The owner answered the product questions before this planning job; the job does not reopen them.

### Owner words, word for word

- Review §3.3: "Rule for the styleguide: a source file stays under about 400 lines and one aggregate; a module that needs more gets a subfolder with its own barrel." "Size: 3 stages, mechanical, no behaviour change; do it before E4-A and E5b touch these files."
- Review §3.8: "a table-driven dispatch in `apply.ts` (`Record<ActionType, Handler>`), a completeness test (every `actionTypes` member has a handler, a transitions entry, a CHECK member, a renderer), and a written checklist "add an action type" in `docs/code-patterns.md`."
- Ticket acceptance: "`git log --follow` keeps the history of the moved functions (moves, not rewrites)." "Every import of `../actions` and `../mail` from other modules is unchanged; `bun run typecheck`, `bun run test:unit` and `bun run test:int` pass with no test edited except import paths."

### Design decisions of the ticket author (2026-11-13, kept word for word)

- **D1 Move, do not rewrite.** Each function moves whole with `git mv`-friendly diffs (create the new file from a slice of the old one), so blame survives. Shared private helpers (`DbOrTrx`, `sendBase`, `toSendRow`) go to `repo/shared.ts`. `repo/index.ts` re-exports everything the module index exported, so `actions/index.ts` changes one import path.
- **D2 Aggregates.** `actions/repo/`: `claims.ts`, `sends.ts`, `drafts.ts`, `undo.ts`, `notify.ts`, `expiry.ts`, `reads.ts`, `retention.ts`, `shared.ts`. `mail/repo/`: `mailboxes.ts`, `folders.ts`, `credentials.ts`, `emails.ts`, `claims.ts`, `targets.ts`, `lookup.ts`, `retention.ts`, `shared.ts`. The plan-task session adjusts the names from the list above; the rule is one aggregate per file and under 400 lines.
- **D3 Handler table.** `apply.ts`: `const handlers: Record<ActionType, ApplyHandler> = { move: applyMove, flag: applyFlag, mark_read: applyFlag, save_summary: applySummary, create_draft: applyDraft, send: applySend }`; `applyAction` resolves the provider and sender needs from a `needs` field of the handler (`{ provider: boolean, sender: boolean }`) and calls it. `drafts.ts` and `send.ts` import shared helpers from `apply-shared.ts`, not from `apply.ts`, which ends the two cycles.
- **D4 Completeness test.** Unit: `actionTypes` = keys of `handlers` = the types in `ACTION_ENTRIES` = the union of `PlannedAction["type"]`; draft kinds of `draftPayloadSchema` = keys of `renderTemplate` branches (make `renderTemplate` a record too). Integration: `actionTypes` = the `actions_type_check` list from `pg_constraint`.
- **D5 Checklist.** `docs/code-patterns.md` § "Add an action type or a draft kind": the nine places of the facts list, in order, each with the test that fails when it is missed.

### Decisions of this planning job (2026-11-13)

Each refines D1–D5 after a fact check. "Default" marks a choice the owner may still change; it is in [questions.md](questions.md).

- **D6 No import path changes anywhere.** With `moduleResolution: "Bundler"` (`tsconfig.base.json:5`), `./repo` resolves to `./repo/index.ts` once `repo.ts` is gone. So `actions/index.ts`, `mail/index.ts`, the 25 files in `actions/` and `mail/` that import `./repo` (the two `index.ts` and two tests included), the 49 integration test files and the 2 e2e seed scripts that import `…/mail/repo` or `…/actions/repo` all stay as they are (probe P2: whole-server `tsc` passes with zero edits outside the two `repo/` folders). D1's "changes one import path" becomes "changes none". Rejected: rewriting importers to `./repo/index` (noise, no gain).
- **D7 History by a copy merge (default).** `git log --follow` follows one rename per file. A split into N files keeps `--follow` for every file only when each new file is, in some parent commit, a pure rename of the old file. `tools.md` § `history-copies.sh` makes N side commits (each renames `repo.ts` to one new file, a full copy), one merge commit with all N copies, and the branch fast-forwards to it; the next normal commit trims each copy to its part. Probe P3: every new file's `git log --follow` reaches the first commit of the old file (actions: `cca481b`; mail: `b786f27`), also after the branch is merged into another line as `limen land` does (`git merge --no-edit`, `limen/src/project/git.ts:257`). Rejected: one commit with `git mv` to one file (only that one file keeps `--follow`); a merge commit that already holds the trimmed files (probe: `--follow` reached the old history for 1 file of 3). Cost: the merge commit does not build (N copies, no `index.ts`); it is never alone at the tip, because the worker commits the trim right after it; `git bisect` must `skip` it. Each new file's log also lists the N copy commits.
- **D8 The split is generated, not typed by hand.** `tools.md` § `split-repo.ts` moves each top-level statement whole, with its comments, into the file that the map names, and rebuilds the imports. § `same-bodies.ts` proves that every declaration kept its text; § `exports-of.ts` proves that `repo/index.ts` exports the same names as the old file. Probe P2 ran all three on both files. A worker never edits a moved body; Prettier and `eslint --fix` change only import lines and line wraps.
- **D9 `actions/repo/` files (adjusts D2).** One aggregate each; line counts measured after Prettier (P2): `planned.ts` (135: `createPlanned`, `setDelegationId`, `isOwnActionId`, the planned-row types), `reads.ts` (143: the read queries of the digest, the activity and the web: `listActionsForEmail(s)`, `listSummaries`, `listDraftTasks`, `countActionsSince`), `filters.ts` (30: the claim filter types and their SQL, used by `claims.ts` and `approvals.ts`), `claims.ts` (281: `claimActions`, `countClaimable`, `countHeldSends`, the claim window), `lifecycle.ts` (165: the status changes of one claimed row: `markApplying`, `finishAction`, `releaseAction(s)`, `updateProviderResult`), `expiry.ts` (94: `expireStaleReady`, `countReadyOriginals`, `expireReadyOriginals`), `undo.ts` (117), `sends.ts` (270: the send row, its read helpers and its status setters), `drafts.ts` (85), `notify.ts` (200: the notice queries), `approvals.ts` (135: the approval-expiry queries and `countApprovals`), `retention.ts` (102), `shared.ts` (8), `index.ts` (52). Changed from D2: `claims` minus its lifecycle half (else 446 lines), `filters` (two files use it), `planned` and `approvals` (own aggregates; `reads` would be 278 lines of two topics). The names `undo.ts`, `expiry.ts` and `approvals.ts` also exist one folder up (the services); the folder tells them apart.
- **D10 `mail/repo/` files (adjusts D2).** `mailboxes.ts` (209: the mailbox row, status, summary, `markSynced`, `setFolderMapEntry`, `mailboxHasUidplus`), `folders.ts` (257: the synced folders and their cursors, `forceRescan`), `credentials.ts` (47), `emails.ts` (197: `MailKind`, `mailKindFilter`, the email row writes and reads), `copies.ts` (110: `findCopies`, `listFolderUids`, `listRecentlyMoved`, the only file that imports `../sync-rules`), `targets.ts` (45), `claims.ts` (175: `claimEmails`, `releaseEmail`, `finishEmail`, `countWaiting`, `requeueTooOld`), `lookup.ts` (73), `retention.ts` (100), `shared.ts` (5), `index.ts` (55). Changed from D2: `copies` (own aggregate: the copy identity rules of ADR 0014).
- **D11 `repo/index.ts` lists names, not `export *`.** It re-exports every name the old file exported (actions: 64, mail: 66), so the siblings and the tests keep their imports, and it re-exports nothing else. A helper that another new file needs gets an internal `export` in its own file (`sendBase`, `toSendRow` in `sends.ts`; `sendFilterExpr` in `filters.ts`; `mailboxStatusSchema` in `mailboxes.ts`); `index.ts` does not list it. `shared.ts` holds only what has no aggregate (`DbOrTrx`, `actionTypeSchema`). Rejected: `export *` (it would publish the internal exports).
- **D12 The one text change outside the folders in stages 01–02.** `actions/transitions.ts` names two helpers by file in `PAIR_RULES[].enforcedBy`: `"claimableWhere (repo.ts)"` and `"sendWaits (repo.ts)"` become `(repo/claims.ts)`. No test reads these strings (grep). `ActionWriter` names are function names and do not change.
- **D13 One handler record drives `applyAction` and the committer (adjusts D3).** `APPLY_HANDLERS: Readonly<Record<ActionType, ApplyHandler>>` in `apply.ts`. `ApplyNeeds` has four fields, not two: `provider` (IMAP), `sender` (SMTP, only for a row in `approved`), `facts` (owner and organization texts), `sortFolders` (the `sort` folder paths for a move). Reason: `committer.ts` decides these four from `action.type` in four places today (`isMailboxChanging` at line 117, the `move` check at 334, `withSender` at 351, `needsFacts` at 358); a new type would need edits there too. Each derived value is equal to today's for every type (table in stage 03). Rejected: `needs` read only by `applyAction` (D3 as written): it leaves four if-chains in the committer.
- **D14 `apply-shared.ts` holds the shared types and one `inTransaction`.** `ApplyOutcome`, `ResolvableFolderKey`, `FolderResolver`, `ApplyDeps`, `ApplyNeeds`, `ApplyHandler`, `needsImap` and `inTransaction` (today three equal copies in `apply.ts:73`, `drafts.ts:31`, `send.ts:60`). `apply.ts` re-exports the four types that `actions/index.ts` exports from it, so `index.ts` does not change. Probe P4: `apply.ts` drops from 414 to about 375 lines; `madge --circular` shows no cycle with `apply.ts`.
- **D15 The CHECK comparison exists; no new integration file.** `apps/server/test/integration/actions-transitions.test.ts:68–79` already compares `actionTypes` with `actions_type_check` and `ACTION_STATUSES` with `actions_status_check` from `pg_constraint`. The ticket line holds today. The new unit test names it in its header comment. Rejected: `actions-schema.test.ts` (plan input, stage 3): a second copy of the same check.
- **D16 One list of draft kinds (default).** `draftKinds = ["delegation", "clarification", "reminder"] as const` and `DraftKind` in `packages/core/src/triage/payloads.ts`. The literal lists become `z.enum(draftKinds)` or `draftKinds`: `sendPayloadSchema.kind`, `actions/repo/reads.ts` `sendKindSchema`, `would-do.ts` `ActionView.kind`, and after F088 `packages/core/src/notices/views.ts` `draftKind` and `channels/notices/send-result.ts` `SEND_KINDS`. `draftPayloadSchema` keeps its three `z.literal` members (a discriminated union needs them); a test compares them with `draftKinds`. `renderTemplate` reads `DRAFT_TEMPLATES: Record<DraftKind, …>` (D4). Test files keep their own lists (acceptance: no test edited). `triage/eval.ts` keeps its local `DraftKind` (another set: `none`, no `reminder`).
- **D17 The renderer of an action type is `describeAction`.** The digest, the notices and the web activity (`reports/activity.ts:126,130`) get the text of an action from `describeAction`/`describeActions` in `packages/core/src/digest/would-do.ts`; its `phrase` is an exhaustive `switch` (typecheck fails on a missing type). `apps/web/src/lib/activity-text.ts` has no text per action type (checked; the review listed it). The test asks each type for its `logged` phrase; only `save_summary` has none, and the test names it.
- **D18 `payloadOf` becomes exhaustive.** `triage/service.ts:109` ends with `default: return {}`; a new type would store an empty payload in silence. Explicit `case "mark_read": case "flag": return {};` and no `default`: typecheck fails on a missing type (probe: TS2366). Same result for every type today.
- **D19 Five stages, not four.** Stage 04 (draft kinds) is its own job: stages 03 and 04 together are about 400 changed lines. `07-foundation-plan.md` §1 row 7 says 4; the edit is in the final message of this planning job.
- **D20 Files over 400 lines that stay.** `actions/send.ts` (516), `mail/sync.ts` (609), `actions/transitions.ts` (632, data) are out of scope. Stage 05 does not split them; the final message proposes a follow-up ticket.
- **D21 The plan assumes F086 is landed.** F086 stage 01 moves `ExpireFilter` to core; stage 02 removes the `delegation/repo` import and adds `PayloadKeepRule` to `actions/repo.ts`. `tools.md` `actions-map.json` already has that shape. `split-repo.ts` stops on any other difference (a name added by another landed ticket); stage 01 gives the rule.

A gap or a deviation that a worker finds is a question in its final message, not a choice. The coordinator decides from this "Input" or asks the owner.

## Facts checked (2026-11-13, at commit `37e7239`)

- Probes ran in `.probe-f091/` in this worktree on a clone of `37e7239` with `bun install --frozen-lockfile` (deleted before the commit; the scripts are in `tools.md`).
- **P1 sizes.** `actions/repo.ts` 1776 lines, 92 top-level declarations, 64 exports (51 values, 13 types). `mail/repo.ts` 1251 lines, 77 declarations, 66 exports (56 values, 10 types). Source: TypeScript compiler walk (`exports-of.ts`, `same-bodies.ts`).
- **P2 the split.** `split-repo.ts` with the two maps, then `eslint --fix` and `prettier --write` on the new files: `tsc --noEmit -p apps/server/tsconfig.json` passes (7 s), `bun run lint` passes, `bun run test:unit` 1877 pass / 0 fail, `same-bodies.ts` prints `SAME_BODIES 92` and `SAME_BODIES 77`, `exports-of.ts` lists are equal. Largest new file: `actions/repo/claims.ts` 281 lines. The post-F086 actions map (without `ExpireFilter`, with `PayloadKeepRule`) ran on a hand-made post-F086 copy without an error.
- **P3 history.** `history-copies.sh` then the trim commit: `git log --oneline --follow` prints 42 lines for each actions file (28 old commits + 13 copies + trim) and 51 for each mail file; after a `git merge --no-edit` of the branch into another line, the counts stay. A merge commit with trimmed files (variant B2): 1 of 3 files reached the old history. `git blame` attributes moved lines to their old commits.
- **P4 handler table.** A prototype of stage 03 in the clone: `tsc` passes; the 4-case completeness test passes in 0.2 s (importing `apply.ts` in a unit test opens no DB); `bunx madge@8.0.0 --circular` lists no cycle with `actions/apply.ts`. Narrowing on `handler.needs.provider` does not work in TypeScript (nested discriminant, TS2554); the type guard `needsImap` does.
- **P5 draft kinds.** `draftPayloadSchema.options.map((o) => o.shape.kind.value)` gives `["delegation", "clarification", "reminder"]` (zod 4.1). The record form of `renderTemplate` passes `templates.test.ts` unchanged; core `tsc` passes.
- madge before the split: in-module cycles `actions/apply ↔ drafts`, `actions/apply ↔ send`, `mail/repo ↔ sync-rules`, plus the cross-module ones through `config/service.ts` that F086 stage 01 removes. After the split the mail cycle reads `mail/repo/index.ts > mail/repo/copies.ts > mail/sync-rules.ts` (same edge, type-only on one side); it stays (out of scope).
- Per-type branches today: `apply.ts:389–410` (if-chain), `committer.ts:117–121, 334, 351, 358`, `triage/service.ts:109` (`default`), `would-do.ts:59` (exhaustive switch), `policy.ts:26` (exhaustive with `never`), `actions/repo.ts:324` `TYPE_RANK` (`Record<ActionType, number>`), `transitions.ts` (data). Per-kind branches: `templates.ts:17,23` (if-chain, `reminder` is the fall-through), `approvals.ts:84–85`, `would-do.ts:51–52`, `message.ts:58,89,94–95`, `sender.ts:47`, `actions/approvals.ts:155,257`, `actions/expiry.ts:77`, `delegation/service.ts:293`, `channels/notices.ts:481,517`.
- `apps/web/src/lib/activity-text.ts` has no per-type text; `activityActionSchema.type` is `z.string()` and the phrase comes from the server (`reports/activity.ts:126,130`).
- `limen land` runs `git merge --no-edit <branch>` (`/home/artek/Documents/repos/limen/src/project/git.ts:257`): branch commits, merges included, stay in `master`.
- Pre-commit hook: `.husky/pre-commit` runs `bunx lint-staged` (`eslint --fix`, `prettier --write` on staged `.ts`). `history-copies.sh` uses plumbing (`commit-tree`), so no hook runs on the copy commits.
- Docs that name the files: `docs/code-patterns.md:12` (module files), `:29`, `:34` (`mail/repo.ts`); `docs/modules.md:155`, `:201` (§3.2 row), `:262`, `:279` (§3.5); `.agents/limen/styleguide.md:12`. `docs/diagrams/architecture-2026-11.*` are a dated review snapshot and stay.
- F086 stage 05 writes § "Size and shape" (the 400-line rule and "registries over if-chains") into `docs/code-patterns.md` and the styleguide; F088 stage 07 writes § "Notices are facts" with the checklist "Add a notice kind". Stage 05 here adds to them and does not repeat them.

## Not verified

- `bun run test:int` on the split (the planning job has no DB). Stages 01 and 02 prove it with the stage proof.
- The exact shape of `actions/repo.ts`, `mail/repo.ts`, `channels/notices/` and `packages/core/src/notices/views.ts` after F086, F088 and F090 land. `split-repo.ts` stops on a name difference (stages 01, 02); stage 04 finds the F088 lists with a grep.
- The Bun of `.bun-version` (1.3.14) for the scripts in `tools.md`. The probes ran on Bun 1.4.4; the scripts use only `node:fs`, `node:path`, `node:module` and the `typescript` package. A worker runs them with the local `bun`.

## Done when

1. `apps/server/src/modules/actions/repo.ts` and `mail/repo.ts` do not exist; no file under `actions/repo/` or `mail/repo/` has 400 lines or more. Shown by: stage 01 and 02 check (`wc -l`).
2. Moves, not rewrites: `same-bodies.ts` prints `SAME_BODIES <n>` for both folders; `git log --follow` of each new file (not `index.ts`) lists `cca481b` (actions) or `b786f27` (mail). Shown by: stage 01 and 02 check.
3. No importer changed: `git diff --stat <base>..HEAD -- apps/server/test apps/server/src/scripts apps/server/src/modules/*/index.ts` is empty after stages 01–02; lint, typecheck, `test:unit:ci`, `test:int:ci` pass. Shown by: the proof logs of stages 01 and 02.
4. `applyAction` and the committer read `APPLY_HANDLERS: Readonly<Record<ActionType, ApplyHandler>>`; `actions/completeness.test.ts` fails for a type without a handler, a `createPlanned` entry, an edge or a phrase, and on a planner union that differs from `actionTypes`; `actions-transitions.test.ts:68–79` compares the CHECK list. Shown by: stage 03 tests and its mutation checks.
5. `draftKinds` is the only non-test literal list of draft kinds; `packages/core/src/triage/draft-kinds.test.ts` fails for a kind without a payload member or a template. Shown by: stage 04 grep and tests.
6. `docs/code-patterns.md` has the checklist "Add an action type or a draft kind" and the split rule; `docs/modules.md` §3.2 and §3.5 name the new files. Shown by: stage 05 greps.

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, the ticket, this file and your stage file first. Build only your stage.
- No behaviour change. No SQL, no status write, no log text, no audit row changes. In stages 01 and 02 no moved body changes at all (`same-bodies.ts`).
- Never edit a test except as your stage file says (only new test files are written). Never edit an import path in a test (D6: none needs it).
- Never rebase the branch of stage 01 or 02 (`git rebase` drops the history merge and replays the copy commits, which conflict). If `master` moved and the stage must catch up, run `git merge master` (a merge keeps the history merge). Never squash.
- Format only the files of your stage: `bunx eslint --fix <files>` then `bunx prettier --write <files>`. Never `bun run format`, `bun run lint:fix` or `prettier --write .` (an S2 builder ran the repo-wide formatter).
- No temporary file inside the worktree: `bun run lint` lints every `.ts` file. Scripts and logs go to `/tmp/f091-sNN/`.
- Comments in new or changed lines state the rule in one sentence and may name an ADR or a ticket folder path. No bare codes (`D13`, `F091`, `S4`) in new comments. Moved comments keep their text (stages 01–02).
- Template literals for strings with variables; `const` / `let` only.
- No migration, no `bun.lock` change, no new dependency. `bunx madge@8.0.0` runs from the `bunx` cache; check `git status --short bun.lock` after it. Commit by explicit path (`git add <paths>`), never `git add -A`.
- After a stage, `bun run graph:modules` must leave `git status --short docs/diagrams` empty (no module edge changes in this ticket).
- `bun run test:int:ci` runs in your own DB (the prepare script makes it); no lock. Do not run `bun run test:e2e`.
- No secret, `.env` value, mail text or address in a log line, a test name or a commit message. Never read or print `.env`.
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or another ticket.
- Before each commit: `git diff --staged`; look for bugs, debug code and changes outside the stage.
- A gap or a deviation is a question in your final message, not a choice.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows. `NN` = the stage number.

Stages 01–04:

```
mkdir -p /tmp/f091-sNN && bun run lint > /tmp/f091-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f091-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f091-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f091-sNN/int.log 2>&1 && echo PROOF_OK
```

Stage 05 (docs only; `<files>` = the files the stage changed):

```
mkdir -p /tmp/f091-s05 && bunx prettier --check <files> > /tmp/f091-s05/prettier.log 2>&1 && bun run lint > /tmp/f091-s05/lint.log 2>&1 && bun run test:unit:ci > /tmp/f091-s05/unit.log 2>&1 && echo PROOF_OK
```

While it works, a worker runs only the tests of the code it changed; the full chain runs once, as the proof. The `:ci` scripts run the Bun of `.bun-version` (`CLAUDE.md`).

## Owner checkpoints

- None. No migration, no real system, no send, no deploy; the behaviour does not change.

## Owner steps

- None. The owner may confirm or change the defaults in [questions.md](questions.md) before stage 01 (D7) and stage 04 (D16).

## Review

- A review job before the land for stage 01 (the largest move; the history merge), stage 02 (same for `mail`) and stage 03 (the committer decides from the table which connections it opens; an SMTP sender must open only for an `approved` send). Model: the board's reviewer (`spec/build.md` § TRACK: `claude-sonnet-5-5`, high). The reviewer may run `bun run test:int:ci` and the `tools.md` scripts at the candidate commit.
- Stages 04 and 05 land on the worker's proof.

## Stages

| #   | Stage | Size | Mark |
| --- | --- | --- | --- |
| 01  | [Split `actions/repo.ts`](stages/stage-01-actions-repo-split.md) — history merge, generated `actions/repo/*.ts`, two comments in `transitions.ts` | ~1800 moved lines, generated; ~5 hand-edited | |
| 02  | [Split `mail/repo.ts`](stages/stage-02-mail-repo-split.md) — the same for `mail` | ~1250 moved lines, generated | |
| 03  | [Handler table and the action-type completeness test](stages/stage-03-handler-table.md) — `apply-shared.ts`, `APPLY_HANDLERS`, committer needs, `completeness.test.ts` | ~290 lines | |
| 04  | [One list of draft kinds](stages/stage-04-draft-kinds.md) — `draftKinds`, `DRAFT_TEMPLATES`, exhaustive `payloadOf`, `draft-kinds.test.ts` | ~130 lines | |
| 05  | [Checklist and docs](stages/stage-05-docs.md) — `docs/code-patterns.md`, `docs/modules.md` §3.2 §3.5, styleguide | ~90 lines | |

No stage is `[risky]`: no logic changes; stages 01–03 get a review job for their size and for the committer path.

Order: 01 and 02 may run at the same time (different folders, no shared file). 03 after 01 lands. 04 after 03 lands (it edits `actions/repo/reads.ts` of 01 and names the test of 03). 05 after 04 lands.

## How to run (coordinator)

1. Before the first spawn: F086, F088 and F090 are in `spec/features/done/` (ticket § Sequenced). No other job in build edits a file under `apps/server/src/modules/actions/`, `apps/server/src/modules/mail/`, `triage/service.ts`, `channels/notices/` or `packages/core/src/{triage,outgoing,digest,notices}/`. Move the ticket: `git mv spec/features/planned/F091-repo-split spec/features/active/`, commit (the worktrees see only committed files).
2. Spawn one stage (`NN` = two digits, `<slug>` from the stage list):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F091-sNN <slug> · F091" \
     "Implement F091 stage NN. Read spec/features/active/F091-repo-split/ticket.md, plan.md, tools.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f091-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

3. When the job finishes: read its final message and `/tmp/f091-sNN/*.log`. For stages 01, 02 and 03, spawn the review job and wait for it; a finding → `limen continue <job-id> "<fix>"` with the same engine flags, then review again (at most 2 rounds, then the owner decides):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --review --detached --branch <B> --label "review s<NN> · F091" \
     "Review F091 stage NN on <B> against spec/features/active/F091-repo-split/plan.md, tools.md and stages/stage-NN-<slug>.md. Rerun the stage's Check commands (the tools.md scripts from /tmp). Check that no moved body changed, that no test or importer changed, and every decision the stage cites; for stage 03, that the committer opens IMAP, SMTP, the facts and the sort folders for exactly the same batches as before. Quote file and line for each finding."
   ```

4. Land: `limen land <job-id> --yes --keep-open` (stage 05: without `--keep-open`; it closes the ticket). Never ask a stage 01 or 02 job to rebase (plan.md § Rules); if its branch must catch up, tell it to `git merge master`. After the land of stage 01 and of stage 02, check on `master`: `git log --oneline --follow -- apps/server/src/modules/actions/repo/claims.ts | grep -c cca481b` (stage 02: `mail/repo/claims.ts`, `b786f27`) prints `1`.
5. Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`.
6. Land stage N before you spawn the next stage, except 01 and 02, which may run at the same time.
7. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass. A check with no proof at all → `limen continue`.

## Cold review

Not run yet.

## Log

- 2026-11-13: plan written by a planner job (Opus 5.5) from the author's input; probes P1–P5 on a clone of `37e7239`.
