# Handoff: plan the "explicit state machines" refactor
> Created 2026-11-11 14:59 from pi / Claude Sonnet 5.5. Repo: `/home/artek/Documents/repos/email_assistant` (branch `master`, last commit `f2696ed tasks: S5c plan — settings and rules, 12 stages, cold-reviewed`). Session: `/home/artek/.pi/agent/sessions/--home-artek-Documents-repos-email_assistant--/2026-11-11T11-31-38-073Z_01a1ca60-b5d8-7764-a313-4393c9953eb2.jsonl`.

## Start here (for the new agent)
1. Read this file. Then read every file under "Files and links", in that order.
2. Check the claims under "Current state" and "Key data" against the code and `git status`. Write down each difference. The inventory was made by reading code only; nothing was run.
3. Reply to the user in max 4 lines: the goal in your own words, the differences you found, your first step.
4. Then do the first step: write the implementation plan as `spec/features/done/2026-11/F067-state-machine-transitions/plan.md` (template in `tasks/README.md`). **Do not change application code.** Your output is the plan only. The user approves the stages before any build.
If this file does not answer a question, search the session file for the topic word. Do not guess.

## Goal of the next agent
Write a file-level implementation plan for a refactor: make the implicit state machines of the app explicit, starting with `actions.status`. The refactor must not change behavior.
Done when: `spec/features/done/2026-11/F067-state-machine-transitions/plan.md` exists in the README template, has stages (each 1 `[risky]` step or 2–4 normal steps, about 300 changed lines or less), each step has Goal / Files / Interfaces / Decisions / Test / Check / Done when / Out of scope, the open questions below are answered by the user or listed as decisions with a recommendation, and the status line says `planned`. Commit it to `master` (task file = small change, `Git mode: master` for the plan; the build itself uses `Git mode: worktree`, say so in the file).

## Background
The user asked "find all of the implicit state machines in my app". I found 15 (inventory in the note below). None has a transition table in code. Each lives in a `status` column, CHECK constraints and `UPDATE … WHERE status IN (…)` guards in `repo.ts` files. `docs/architecture.md` §4.6 "Status flows" describes some as ASCII; that is the only written map, and nothing checks code against it.
The user then asked whether this matters. My answer (the user accepted it by asking for this handoff): it is not urgent, no concrete bug was found, and it is a future-risk reduction. Do the `actions` machine first. The rest only when those modules change. Do not refactor everything.
Hard limits:
- No behavior change. `actions` sends mail to real people (exactly-once for drafts, at-most-once for send). Mark the risky steps `[risky]` per `tasks/README.md`.
- No DB migration if you can avoid it. Only one task at a time may add a migration or change `bun.lock` (`tasks/README.md` § Git mode).
- Repository functions take a `TenantContext` and filter by `org_id` (`docs/code-patterns.md`). Keep that.

## The user's words
> "find all of the implicit state machines in my app" — the original request.
> "czy to wazne aby to naprawic / zmienic? na czym polegaly by tutaj nastepne kroki?" — asked about importance and next steps.
> "prepare a handoff for new agent that will prepare an implementation plan for it, for this refactor. With all the suggested things you think should be there." — the goal of this handoff. "All the suggested things" = the 4 steps and the extras below.
The user writes Polish; chat replies to them are in simple Polish when they write Polish. Files stay English (STE per `~/.pi/agent/AGENTS.md`).

## Current state
- DONE: the inventory of 15 machines, ranked: `notes/2026-11-11-implicit-state-machines.md` (untracked in git; commit it with the plan or before).
- DONE: my recommendation (4 steps, `actions` first), below under "Decisions".
- NOT STARTED: the plan file, any `transitions.ts`, any test. No code changed. No task file exists yet.
- The working tree has other untracked files (`notes/2026-11-10-limen-adoption.md`, `notes/decision-docs/`, `spec/features/active/F071-limen-transition/plan.md`) that belong to other work. Stage only your own files by explicit path.

## Decisions (and why)
- **Scope: `actions` first** — most states (10), most guards (about 12 functions in a 1600-line `actions/repo.ts`), sends mail. Other machines (emails location flags, mailboxes.status, delegations) are later tasks. Put them in the plan as "Not in this task" or as separate `tasks/planned/` ideas.
- **Steps the user was told (all of them go into the plan):**
  1. Confirm which transitions really happen (from tests, `docs/architecture.md` §4 and §4.6, and the code), not only from my note.
  2. One `transitions.ts` per machine: a const map "from state → allowed next states".
  3. A test that compares the map with the real guards. When someone adds a transition and forgets the map, the test fails.
  4. Later, optional: make the state-changing functions use the map. This step is a separate, later stage. It changes code, not only tests. Say so in the plan.
  Steps 1–3 add a safety net and do not change runtime behavior.
- **Small extra the user was told:** `emails.status = 'done'` has no writer in code, but `docs/architecture.md` §4.6 says `triaged → done (done = all its actions have an end status)`. It is a design-vs-code gap. Put it in the plan as a question to the user. Do not delete the state.
- Rejected: refactor all 15 machines at once — big cost, no known bug.

## Dead ends and traps
- Do not trust my first note blindly. I corrected two things after reading `docs/architecture.md`:
  - Idempotent actions (move, flag, mark_read, save_summary) go `ready → applied` directly with no `applying` state. Only `create_draft` and `send` use `applying` (callers of `markApplying`: `drafts.ts:150`, `send.ts:380`). The guard of `markApplying` also admits non-send types, but no caller uses it for them [not verified by a test].
  - `done` for emails is a design item, not obviously dead.
- Guards are not in one place. A map built only from `repo.ts` misses the edges in `expiry.ts` (`expireSend`, reasons `timeout`, `draft_missing`, `not_notified`, `held_timeout`, `policy_changed`, `delegation_closed`), `send.ts` (crash recovery: a stale `applying` send ends as `failed/outcome_unknown`), `undo.ts`, and the delegation hooks (`actions/hooks.ts`).
- "Send again" is NOT a transition on the same row. `insertSendAgain` (`actions/repo.ts:~1395`) inserts a new `approved` send with key `<id>:again`. The map must show this as a new row, not `failed → approved`.
- A draft and its send are two rows that move as a pair (`depends_on_action_id`). A transition of one can force a transition of the other (draft `failed|undone` expires the send with `draft_missing`; a closed send expires its draft). A per-row map cannot show that. Decide in the plan how to record the pair rule (a second small table, or tests only).
- Do not parse the TypeScript or SQL text of the guards in the test. It breaks on every refactor. See the suggested test design below.
- Integration tests need Postgres and run only in one checkout at a time (`bun run test:int`). Pure-map tests can run in `test:unit`.

## Key data
- `actions.status` states (10): `ready, applying, applied, awaiting_approval, approved, rejected, expired, undone, logged, failed` — CHECK in `db/migrations/20261104000001_triage.sql`.
- Types (6): `move, mark_read, flag, save_summary, create_draft, send` (`db/migrations/20261108000001_delegation.sql`).
- Initial state: `actionStatusFor(decision)` in `packages/core/src/triage/policy.ts` (apply → ready, await_approval → awaiting_approval, log_only → logged).
- Transition writers found in `apps/server/src/modules/actions/repo.ts`: `markApplying` (587), `finishAction` (~640; applied / failed / expired), `releaseAction` (~690; back to ready|approved|applying), `releaseActions` (clears only the lock), expire-stale (~759), `markUndone` (~783), `expireReadyDraft` (~1050), `setExpired` (~1279), draft close for a send (~1300), approve (~1342), reject (~1367), `insertSendAgain` (~1395). Line numbers are approximate; re-grep `\.set\(.*status`.
- DB CHECKs that already guard edges: `actions_applied_at_check` (applied/undone need `applied_at`), `actions_send_never_ready_check`, send needs `approved_at` for approved/applying/applied (`20261107000001_assist_actions.sql`, `20261108000001_delegation.sql`).
- Constants: `STALE_AFTER_MS` 10 min, `APPROVAL_TTL_MS` 48 h, `UNNOTIFIED_TTL_MS` 7 d, `HARD_ERROR_TRIES` 3, `RETRY_WAIT_MS` 5 min (`actions/constants.ts`).
- Existing action tests (reuse their fixtures): `apps/server/test/integration/actions-*.test.ts` (apply, approvals, close, committer, drafts, end-to-end, expiry, move, repo, schema, send, undo); helpers in `apps/server/test/integration/fixtures.ts` and `helpers.ts`.
- Commands: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int` (the check set in `tasks/README.md`).
- Other 14 machines, in short (full list in my note): `emails.status` (5), emails location flags (`folder`, `source_folder`, `moved_at`, `returned_at`, `undo_pending_at`), `mailboxes.status` (3), `outbox.status` (4), `delegations.status` (6), `chat_link_tokens`, `digests`, notice episodes, onboarding, mailbox `mode`, `LlmPause`, Telegram polling, scheduler, web dialogs.

## Suggested design for the test (for you to confirm or replace; my idea, not agreed with the user)
- Put the map in a place that the unit tests can import without a DB (`packages/core` or `apps/server/src/modules/actions/transitions.ts`; decide, see open questions). Include: states, terminal states, allowed edges, and per edge the reason codes (`status_reason`) and the writer function name.
- Unit test A (no DB): the map is consistent (every state in the CHECK list is in the map; terminal states have no outgoing edges; `logged` has none).
- Integration test B (Postgres, rolls back like the other repo tests): for each repo function that changes status, run it from every one of the 10 states with the correct claim token, and assert that it changes the row exactly for the "from" states in the map. This compares the map with real behavior and does not parse source text.
- Schema test C: read the status list from the CHECK constraint (see how `actions-schema.test.ts` reads the schema) and compare it with the map's state list.
- Optional, ask the user: a DB trigger that rejects illegal edges. It needs a migration and is `[risky]`. My view: not now.

## Files and links
- `/home/artek/Documents/repos/email_assistant/notes/2026-11-11-implicit-state-machines.md` — the full inventory with edges, guards, file lines and ranking. Read first.
- `/home/artek/Documents/repos/email_assistant/CLAUDE.md` — repo rules (git mode, stage commits, review loop).
- `/home/artek/Documents/repos/email_assistant/tasks/README.md` — task template, plan shape, `[risky]`, pipeline mode, git mode, one-file-per-stage rule for plans over about 15 stages.
- `/home/artek/Documents/repos/email_assistant/docs/architecture.md` — §4 rules 6–7 (exactly-once, retries, committer rules, around lines 138–215) and §4.6 "Status flows" (around line 360). The written map of the machines.
- `/home/artek/Documents/repos/email_assistant/docs/code-patterns.md` — module layout and test layout.
- `/home/artek/Documents/repos/email_assistant/apps/server/src/modules/actions/` — `repo.ts`, `apply.ts`, `drafts.ts`, `send.ts`, `expiry.ts`, `expire.ts`, `undo.ts`, `approvals.ts`, `committer.ts`, `hooks.ts`, `constants.ts`.
- `/home/artek/Documents/repos/email_assistant/packages/core/src/triage/policy.ts` — initial status of an action.
- `/home/artek/Documents/repos/email_assistant/db/migrations/20261104000001_triage.sql`, `20261107000001_assist_actions.sql`, `20261108000001_delegation.sql` — status CHECKs.
- `/home/artek/Documents/repos/email_assistant/spec/features/planned/F031-actions-scope-removal/plan.md` — another planned task that touches `actions`; check for overlap.
- `/home/artek/Documents/repos/email_assistant/tasks/active/` — read at session start. Other work in progress: `s5c-web-settings-rules.md` (web, build not started), `sync-sort-folders.md` (stage 17 left; touches emails location flags), `llm-provider-switch.md`, `limen-transition.md`. Check for file or migration conflicts with your plan.

## Open questions
- Which machines are in this task: only `actions`, or `actions` + `delegations` (they are coupled by hooks)? — user. My recommendation: `actions` only.
- Where does the map live: `packages/core` (importable by the web and by unit tests) or `apps/server/src/modules/actions/`? — you decide with a recommendation; code-patterns say pure logic goes to `packages/core`, but the map describes DB rows owned by the `actions` module.
- Include the later step 4 (functions use the map at runtime) in this task or in a separate follow-up task? — user. My recommendation: separate follow-up, because it changes runtime code in a `[risky]` area.
- `emails.status = 'done'`: build it, delete it, or leave it and document? — user. Not part of this task unless the user says so.
- Is a DB trigger wanted? — user. My recommendation: no.
- Should the plan also cover the web dialogs (boolean soup → one status union)? — user. My recommendation: no, a separate small task if wanted.
- Timing: when should this run, given `s5c` and `sync-sort-folders` are active? — user. My recommendation: at the next change in `actions`; the safety-net steps (1–3) do not block other work.

## Suggested skills
- `explainer` — optional: a state diagram of `actions` for the user to approve the edge list before the plan is final.
- `gh-tickets` — not needed.

## Earlier handoffs
None
