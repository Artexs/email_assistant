# Limen in this repo: fit, transition, pros and cons (2026-11-10)

Question from the user: how to apply Limen (github.com/overment/limen) to this repo and to the pi agent setup. What changes, what is the transition, pros and cons.

Sources (read 2026-11-10):
- Limen `main` at `f1e3a54` (2026-11-05), version 0.1.0: `README.md`, `SECURITY.md`, `docs/setup.md`, `docs/jobs.md`, `docs/commands.md`, `templates/{agents,worker,reviewer,capability}.md`, `templates/spec/**`, `src/runtime/engine.ts`, `src/project/git.ts`.
- Earlier notes: `~/.pi/agent/notes/2026-11-04-limen.md` (what Limen is), `notes/2026-11-07-parallel-agents-worktrees.md` (options A–D, shared-runtime trap), `tasks/done/subagents-setup.md` ("not now: Limen").
- Current setup: `tasks/README.md` (run-task loop, pipeline mode, git mode), `~/.pi/agent/skills/run-task/`, `~/.pi/agent/agents/{planner,implementer,reviewer}.md`, `~/.pi/agent/bin/bg-agent.sh`.

## Short answer

This repo already has a hand-made version of most of Limen: worktree per task, background reviewer on a frozen copy, PASS/FAIL, task lanes, merge by the main session.
Limen adds: durable job records, finish wakes, steer/stop/continue, a start queue, `land` (merge + ticket close + board), and a proof check of the "done" claims.
Limen removes or changes: the planner role, file-level step plans, user checkpoints per stage, the `tasks/` layout, and the "ask the user" habit (its frame: "owner attention is scarce, decide yourself").

Recommendation: do not migrate now. First take the cheap ideas (part "Option A"). Then pilot Limen on one small, new, non-risky feature after `s5a-web-foundation` and `sync-sort-folders` are done. Decide after the pilot.

## How the two systems map

| Now (this repo + pi)                                                              | Limen                                                                                       | Change                                                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `tasks/{planned,active,done}/<name>.md`                                           | `spec/features/{planned,active,done/YYYY-MM,dropped/YYYY-MM}/FNNN-slug/ticket.md`           | Folder per feature, stable number, `outcome.md`, `review-N.md` in folder    |
| Task file: goal, done-when, file-level plan, log, status line                     | Ticket ~300 words: Outcome, Scope, Out of scope, Acceptance, Notes. "No progress log"       | Plan detail and log leave the ticket. Progress = commits + job record       |
| Stage files `tasks/<state>/<name>/stage-NN-*.md`                                  | No stage concept. One job = one slice; `land --keep-open` while slices remain               | A stage becomes a job (or a small ticket)                                   |
| `docs/roadmap.md` slice list                                                      | `spec/build.md` board: TRACK, NEXT (prose), NOW + PROVEN (generated)                        | Two places hold order → pick one source (see "Open decisions")              |
| `docs/product-brief.md`                                                           | `spec/vision.md`, injected into every coordinator model call                                | Write a short digest; keep the brief as the long source                     |
| `CLAUDE.md` rules + `docs/code-patterns.md`                                       | `.agents/limen/styleguide.md` (injected) + `.agents/limen/reminders.md` (first prompt + finish check) | Short copies of the binding rules                                    |
| Main pi session runs `run-task`                                                   | Coordinator pi session runs `limen spawn/steer/land`                                        | `run-task` skill retires or becomes a thin wrapper                          |
| `planner` subagent (Opus) adds step detail                                        | None. Worker gets "direction and a starting seam, not an edit list"                         | Biggest behavior change                                                     |
| `implementer` subagent (Sonnet), never commits                                    | Worker job in own worktree, branch `limen/<job-id>`, commits itself                         | Workers commit; coordinator only merges                                     |
| `reviewer` subagent, `bg-agent.sh`, `~/.cache/ea-review/` detached copy           | `limen spawn --review --detached --branch limen/<id>`; first line `PASS <sha>` / `FAIL <sha>` | Same idea; Limen keeps the record and wakes the coordinator               |
| Pipeline mode (2 stages ahead, push after PASS)                                   | Parallel jobs + seat start queue (CPU/memory gate)                                          | Order between dependent stages is the coordinator's job                     |
| Git mode `worktree`: `task/<name>`, `merge --no-ff`, push branch                  | `limen land`: `git merge --no-edit <branch>` into the current checkout, deletes branch      | No `--no-ff` guarantee (fast-forward possible); push stays manual           |
| User checkpoints, `[risky]` = 1 step per stage                                    | No checkpoints. Review "when a mistake would be expensive"; owner approves the merge        | Must re-add in reminders/board policy                                       |
| Rule "name the command and its output before done"                                | Task note `note.md` + finish check: a "proven" claim must point to a command that ran with exit 0, or a file | Limen enforces our rule mechanically                    |
| `notes/`, `docs/known-alerts.md`, ADRs                                            | No equivalent; "exploration must leave residue in a plain notes file"                       | Keep as is                                                                  |

## What must change

### Repo files
1. `limen init` creates `spec/vision.md`, `spec/build.md`, `spec/features/**`, `.agents/limen/styleguide.md`, `.pi/extensions/limen.ts`, `.omp/extensions/limen.ts`, and uses `.limen/jobs/` (add to `.gitignore`).
2. Write `spec/vision.md` (short digest of `docs/product-brief.md`) and `.agents/limen/styleguide.md` (short digest of `docs/code-patterns.md` + `CLAUDE.md` code rules). Keep both short: they go into every call.
3. Write `.agents/limen/reminders.md` with the binding rules that Limen does not know:
   - Never commit secrets or `.env`.
   - Only one checkout runs `bun run test:int`, `db:migrate` or a dev server at a time (shared dev DB, GreenMail, ports).
   - Only one job adds a DB migration or changes `bun.lock`.
   - `[risky]` areas (list in `tasks/README.md`) need a review job and the user's approval before land.
   - Never force-push.
4. Tasks folder: move to `spec/features/`, or keep `tasks/` for history. Proposal: freeze `tasks/done/` as history, new work only in `spec/features/`. Move `tasks/planned/*` to `spec/features/planned/FNNN-*` when each one starts.
5. `CLAUDE.md`, `tasks/README.md`: replace "How to run a slice", "Pipeline mode", "Git mode" with a pointer to Limen for jobs. Keep the commit-message format for the coordinator's own commits.
6. No `AGENTS.md` in the repo now (checked). Keep it so: a project `AGENTS.md` replaces Limen's whole shop manual (`templates/agents.md`).

### Agent settings (pi, `~/.pi/agent/`)
1. Install: clone Limen, `npm install`, `npm link` (Node 24+; this machine has v26.13.0, pi 1.5.0; Limen last tested pi 1.2.0). `limen` and `herdr` are not installed now (checked).
2. Herdr is optional. Without it, the coordinator is a plain pi session; wakes go through the Pi hook. Tabs and `--tab` jobs need Herdr.
3. **Model provider mismatch (found in code, not tested).** Our bridge `pi-claude-bridge` 0.11.0 registers the provider `claude-bridge` (`src/convert.ts:8`). Limen treats only `pi-claude` as the bridge (`src/runtime/engine.ts:282`) and starts workers with `--no-extensions`. So `--provider claude-bridge` will probably fail: the bridge does not load. Workaround to test: pass `--extension ~/.pi/agent/npm/node_modules/pi-claude-bridge` on each spawn, or record that route in personal instructions (Limen "personal model routes").
4. Workers run with `--no-extensions`: `web-privacy-guard.ts`, `stop-check.ts`, `config-autocommit.ts` do not load in jobs. Pass the ones you need with `--extension`.
5. Model choices go into `spec/build.md` (engine, provider, model, thinking per role). They replace `model:` in `~/.pi/agent/agents/*.md` for Limen jobs.
6. Speech: Limen injects its own register (`templates/communication.md`, 155 lines). Our STE + "max 4 lines" rules need an overlay `.agents/limen/communication.md`, or a short line in personal coordinator instructions.
7. `--prepare` per job: copy `.env` from the main checkout, `bun install --frozen-lockfile`, optional `bun run db:worktree <job>`. Prepare failure is logged, not fatal: the worker must check.
8. `run-task`, `plan-task`, `bg-agent.sh`: keep `plan-task` for the planning conversation (it writes the ticket). Retire `run-task` pipeline/review parts after the pilot.

### Agent behavior
- Coordinator: writes short tickets (outcome + acceptance), not step plans. Spawns, reads wakes, starts reviews, lands. Asks the user only on product ambiguity, real tradeoffs, credentials, merge.
- Worker: "edit to learn", probe edit early, commit early, discriminating checks first, full suite once at the end, writes `note.md` (Done means / Easy to miss / Not proven yet).
- Reviewer: same as ours (PASS/FAIL, labels proven/plausible/unverified). Small change.
- Lost: Opus planner detail before build, per-stage user approval, the "2 stages ahead" limit. For `[risky]` work this is a real loss: keep a plan step (planner-written ticket notes or a `research`/`scout` job) for those.

## Pros
- Real parallel work with records: each job keeps task, branch, log, state, session, result. Crash or new session → `limen status` shows the state. Today this lives in handoff notes and `~/.cache/ea-review/*.md.done`.
- Finish wakes, `steer`, `stop`, `continue`: no polling of `.done` files.
- `land` merges, closes the ticket, updates the board in one commit. `prune --retire` cleans worktrees and branches (today manual cleanup; stale worktrees exist now: `~/ea-s3-test`, `~/.cache/ea-review/s5a-opus`, `~/.cache/ea-testmail/...`).
- The finish check enforces our "done = command + output" rule.
- Short tickets cost fewer tokens than 15 stage files and cold reviews of plans.
- Same tool as the MEGA course; ideas improve upstream.

## Cons and risks
- Experimental 0.1.0: commands and formats change often. Upstream churn can break the flow mid-task.
- Shared runtime is not solved: one dev DB, GreenMail and ports. `test:int` and migrations stay serial, so real parallelism is small in this repo until per-worktree ports and GreenMail exist.
- Linux: weaker process containment (escaped child processes are not signaled; identity check is macOS-only). Leaked dev servers/browsers are possible.
- Security: workers run `pi --approve` as your user. They see `.env` (IMAP, Telegram, Gemini keys, VPS access). Same as now in practice, but with more agents and less supervision.
- Loss of the planning depth that found many bugs before code (S5a: 35 + 18 review findings on the plan).
- Large injected prompt text (shop manual ~230 lines + register + vision + styleguide on each call): token cost and conflict with our STE rules.
- Two systems during the transition (`tasks/` and `spec/`): breaks "one source per fact" until the move ends.
- Provider mismatch above: first spawn will probably fail until fixed.

## Options
- **A. Ideas only (cheap, now):** add `note.md`-style "Done means / Easy to miss / Not proven yet" to the implementer and the reviewer; a `reminders.md`-style block in `run-task`; `outcome.md` at task close; a cleanup script for stale worktrees. No new tool.
- **B. Pilot (recommended next):** after the two active tasks close, `limen init` in a branch, `limen planning private` (spec files stay out of git during the pilot), one small non-risky feature, Pi coordinator without Herdr, 1–2 workers + 1 review. Measure: spawn worked first time?, steers needed, review FAIL rate, your attention time, conflicts with the shared DB.
- **C. Full migration:** after a good pilot: move `tasks/planned` to `spec/features/planned`, freeze `tasks/done`, update `CLAUDE.md` and `tasks/README.md`, retire pipeline mode.

## Open decisions for the user
1. Roadmap source: keep `docs/roadmap.md` as the slice list and use `spec/build.md` only as the board, or move NEXT into `build.md`.
2. `[risky]` work: keep the planner step and user checkpoints (Limen does not have them), or accept Limen's "review + approve merge" only.
3. Planning committed (default) or private during the pilot.
4. Merge style: accept `limen land` (`merge --no-edit`, can fast-forward) or keep `merge --no-ff` by hand.
