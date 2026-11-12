> **Status 2026-11-12 — in progress — plan written, waiting for the user's answers to "Decisions" (D1–D9).** No install and no repo change yet. §4 holds the S5c build feedback as input for D3, D5–D7 and stages 2–5. Left: stages 0–5.

# Move the agent workflow to Limen

Scope: user decision 2026-11-10 ("I'd like to proceed with it and use this limen"). Analysis: [`notes/2026-11-10-limen-adoption.md`](../../notes/2026-11-10-limen-adoption.md). What Limen is: `~/.pi/agent/notes/2026-11-04-limen.md`. Needs: `sync-sort-folders` closed (stage 17, today) and the `s5a-web-foundation` build done or paused at a stage boundary (see stage 0).

Git mode: master (stages 1–3, 5: docs and config). Stage 4 uses Limen's own `limen/<job-id>` branches.

Limen version read: `main` at `f1e3a54` (2026-11-05), 0.1.0. Files read: `README.md`, `SECURITY.md`, `docs/{setup,jobs,commands}.md`, `templates/{agents,worker,reviewer,scout,researcher,judge,quality,keeper,communication,capability,styleguide}.md`, `templates/spec/**`, `templates/limen-extension.ts`, `hook/communication.ts`, `src/commands/spawn.ts`, `src/project/{inherit,git}.ts`, `src/runtime/engine.ts`, Limen's own `spec/build.md` (example board).

## Goal

New features run as Limen jobs: one coordinator pi session with the user, workers and reviewers as Limen jobs in their own worktrees, tickets in `spec/features/`. The useful parts of the current flow stay: deep plans for `[risky]` work, user approval before risky merges, the shared-runtime rules.

## Done when

- `limen --help` runs on this machine, and one worker job on the Claude bridge ends `done` with a commit (stage 1 probe).
- `limen init` files, `spec/vision.md`, `.agents/limen/{styleguide,reminders,communication}.md`, the board with model choices and the prepare script are committed (stages 2–3).
- One pilot feature went ticket → worker → review → `limen land` → push, and the pilot result is in the log with the measures of stage 4.
- `CLAUDE.md`, `tasks/README.md`, the `run-task` skill and the global `AGENTS.md` describe the new flow, and no rule in them conflicts with Limen (stage 5).

## 1. The idea (target picture)

```
You ──talk──▶ Coordinator (pi, LIMEN_COORDINATOR=1, Opus, main checkout on master)
                 │  - plan-task skill → ticket spec/features/active/FNNN-slug/ticket.md
                 │  - planner subagent (foreground, only for [risky]) → FNNN-slug/plan.md
                 │  - commits the ticket on master (workers read committed files)
                 │
                 ├─ limen spawn --role scout   (Haiku, read-only question, optional)
                 ├─ limen spawn                (worker, Sonnet/Opus, own worktree + branch limen/<id>)
                 │      --prepare scripts/limen-prepare.sh  (.env, bun install, own DB)
                 │      writes note.md, commits, final message → wake to coordinator
                 ├─ limen spawn --review --branch limen/<id>   (reviewer, PASS/FAIL <sha>)
                 │      coordinator files it as FNNN-slug/review-N.md
                 ├─ FAIL → limen continue <id> "fix findings"   (max 2 rounds, then you decide)
                 └─ PASS → [risky]? ask you → limen land <id> [--keep-open] → git push
                                               (land moves the ticket to done/YYYY-MM/, updates the board)
```

Three ideas carry the change:

1. **The job is the unit.** Each worker run has a durable record in `.limen/jobs/<id>/` (task, log, state, session, result, note). Today this lives in handoff notes and `~/.cache/ea-review/*.md.done`.
2. **The ticket is the brief.** Short (~300 words): outcome, scope, out of scope, acceptance. No step list, no status, no log. Depth goes into `plan.md` next to the ticket, only where risk needs it.
3. **Proof, not claims.** Each job writes `note.md` (Done means / Easy to miss / Not proven yet). At finish, Limen checks that each "proven" line names a command that ran with exit 0, or a file. Else the job is `done with open checks`. This is our "name the command and its output" rule, enforced.

## 2. Main categories of change

### 2.1 Machine and install (operator, one time)

- Clone Limen to `~/Documents/repos/limen` (not in this repo), `npm install`, `npm link`. Update later with `git pull` there, then `/reload` in the coordinator.
- Node v26.13.0 and pi 1.5.0 are here; Limen's last known-good is pi 1.2.0. The stage 1 probe proves the pair.
- Herdr: optional. Start without it (plain pi coordinator, wakes through the Pi hook, detached workers). Add Herdr later for tabs and `--tab` jobs.
- **Claude route (blocker, from code, not tested):** our `pi-claude-bridge` 0.11.0 registers provider `claude-bridge` (`~/.pi/agent/npm/node_modules/pi-claude-bridge/src/convert.ts:8`). Limen auto-loads the bridge only for provider `pi-claude` (`src/runtime/engine.ts:282`) and starts jobs with `--no-extensions`. Route to test: `--provider claude-bridge --model claude-sonnet-5-5 --extension ~/.pi/agent/npm/node_modules/pi-claude-bridge`. Limen expects personal routes in personal instructions, not in project Git: put the route in `~/.pi/agent/AGENTS.md` § Limen (stage 3).
- Seat queue defaults (CPU ≥ 25% idle, memory ≥ 20% free, 60 s between starts) are fine. Change in `~/.limen/start-gate.json` only if needed.

### 2.2 Repo files

| File                                                  | Content                                                                                                  | Source now                                            | Injected where                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| `spec/vision.md`                                      | Product principles + current direction, ~30 lines                                                        | `docs/product-brief.md`, `docs/roadmap.md`            | Every coordinator model call            |
| `.agents/limen/styleguide.md`                         | Shape / Prefer / Avoid, ~40 lines                                                                        | `docs/code-patterns.md`, `CLAUDE.md` § Rules          | Every call of every role                |
| `.agents/limen/reminders.md`                          | Binding repo rules (list below)                                                                          | `CLAUDE.md`, `tasks/README.md` § Git mode             | First prompt of each job + finish check |
| `.agents/limen/communication.md`                      | Overlay: Limen register + our STE and "max 4 lines to the user" rules                                    | Package `templates/communication.md` + AGENTS.md      | Every call                              |
| `spec/build.md`                                       | Board: TRACK, NEXT, PARKED, DROPPED (prose) + NOW, PROVEN (generated) + model and review policy in TRACK | `docs/roadmap.md` (order), `tasks/README.md` (models) | Coordinator (board digest)              |
| `spec/features/{planned,active,done,dropped}/`        | Feature folders `FNNN-slug/` with `ticket.md`, optional `plan.md`, `review-N.md`, `outcome.md`           | `tasks/`                                              | Workers read by `Ticket:` pointer       |
| `.pi/extensions/limen.ts`, `.omp/extensions/limen.ts` | Stubs that load Limen hooks from the installed package (written by `limen init`)                         | —                                                     | Coordinator session                     |
| `.agents/limen/limits.json`                           | Only if `bun install` or prepare needs > 5 min                                                           | —                                                     | —                                       |
| `scripts/limen-prepare.sh`                            | Prepare per job (below)                                                                                  | `tasks/README.md` § Git mode step 1                   | Run by Limen before the engine          |
| `.gitignore`                                          | Add `.limen/`                                                                                            | —                                                     | —                                       |

Do **not** add `AGENTS.md` to the repo root: a project `AGENTS.md` replaces Limen's whole shop manual. Keep project rules in `CLAUDE.md` (stage 3 checks that the coordinator and the jobs load it) and in the files above.
Do **not** add overlays `.agents/limen/worker.md` or `reviewer.md` at first: an overlay replaces the whole package prompt and stops upstream fixes. Use `reminders.md` for repo rules. Add an overlay only when a rule cannot live in reminders.

`reminders.md` draft:

- Never commit or print secrets or `.env`. Read them from env/config.
- Template literals for strings with variables; `const`/`let` only.
- One commit message form: `<area>: FNNN <slice> — <what>`; body: the check command and its result.
- `bun run test:int`, `bun run db:migrate` and dev servers use the job's own database from the prepare step. GreenMail is shared: only one job at a time runs mail integration tests (the ticket says which job).
- Only one job at a time adds a DB migration or changes `bun.lock`; the ticket says so when it does.
- `[risky]` areas (data integrity, sync and dedup, exactly-once, security, auth, tenant isolation, sending to people, LLM prompts and evals, migrations): the ticket marks them, and the worker proves each acceptance line with a test.
- Never force-push. Never push `master` from a job.
- Before done: `bun run lint && bun run typecheck && bun run test:unit` passed at the final commit, run as one `&&` chain (the finish check counts only `&&` chains with exit 0).

`scripts/limen-prepare.sh` draft (runs in the new worktree):

1. Copy `.env` from the main checkout (`$LIMEN_CONTEXT_ROOT` or `git worktree list` first entry; check which variable Limen gives in stage 1).
2. `bun install --frozen-lockfile`.
3. `bun run db:worktree <job-id>` and append the two printed env lines to the worktree `.env`.
4. Optional: `PORT=8080+N` offset. GreenMail stays shared (open item since 2026-11-07).
5. Exit non-zero on failure. Limen logs a prepare failure but still starts the job, so `reminders.md` tells the worker to check `.env` and `node_modules` first.
   Cleanup: `limen prune` removes worktrees, not databases. A weekly `bun run db:worktree --drop` for retired jobs is needed (stage 5 adds it to the close step).

### 2.3 Tasks folder (small decision, D1)

- New work: `spec/features/<lane>/FNNN-slug/`. Numbers start at F001. `limen ticket new "what becomes true" --lane planned` picks the number.
- `tasks/done/`: freeze as history. Do not move it (links in docs and notes point there).
- `tasks/active/`: finish in the old flow (s5a, sync-sort-folders, llm-provider-switch, s5-web-panel master plan).
- `tasks/planned/` (37 files): move one file when it starts (lazy), not all at once. A moved file gets a short ticket; the old text goes to `plan.md` or stays linked.
- Big multi-segment plans (S5): one feature per segment (S5b = one FNNN). Stage files → slices. Slice list with job ids lives in `plan.md` (notes are allowed in the folder; the ticket gets no progress lines). `limen land --keep-open` keeps the feature active until the last slice.
- `docs/roadmap.md` vs `spec/build.md` (D2): recommendation: `roadmap.md` keeps the long-term slice list (S0–S6); `build.md` TRACK/NEXT hold only the next few features and link to the roadmap row. One fact, one place: order of slices = roadmap; order of the next tickets = board.
- `notes/`, `docs/known-alerts.md`, ADRs: no change.

### 2.4 Agents and subagents (roles)

Two mechanisms after the move:

- **Limen jobs** (`limen spawn`): own process, own worktree and branch, durable record, wake at the end, runs with `--no-extensions` (only the extensions you pass). For work that edits code or must survive a crash.
- **pi subagents** (`~/.pi/agent/extensions/subagent/`, foreground in the coordinator): no worktree, no record. Keep only for short, read-only or planning work inside the coordinator's turn.

| Role now                              | Role after                                                                                                    | Mechanism                         | Model (recommendation, D3)                                         | Prompt                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Main session (Opus)                   | **Coordinator**                                                                                               | pi session, `LIMEN_COORDINATOR=1` | `claude-bridge/claude-opus-5-5`, high                              | Limen shop manual + `CLAUDE.md` + vision/styleguide/register                        |
| `planner` subagent (Opus, medium)     | **planner**, only for `[risky]` or > ~5 slices: writes `plan.md` (slices, interfaces, risky decisions, tests) | pi subagent (keep)                | Opus, medium                                                       | `~/.pi/agent/agents/planner.md`, edited: output = `plan.md` slices, not stage files |
| `implementer` subagent (Sonnet)       | **worker**                                                                                                    | `limen spawn` (detached)          | Sonnet 5.5, high; Opus for `[risky]`                               | Package `templates/worker.md` + reminders                                           |
| `reviewer` subagent + `bg-agent.sh`   | **reviewer**                                                                                                  | `limen spawn --review --detached` | Sonnet 5.5, high; Opus for `[risky]` (other model than the worker) | Package `templates/reviewer.md`                                                     |
| — (main session reads code)           | **scout**: one read-only question before a spawn                                                              | `limen spawn --role scout`        | Haiku 5.5, medium                                                  | Package `templates/scout.md`                                                        |
| — (plan cold reviews)                 | **researcher** / **judge** for open design questions                                                          | `limen spawn --role researcher`   | Opus                                                               | Package templates                                                                   |
| — (`docs-review` tasks)               | **quality** pass after 10 landings                                                                            | `limen spawn --role quality`      | Sonnet                                                             | Package `templates/quality.md`                                                      |
| `testmail-writer`, `testmail-checker` | keep as pi subagents (they are not code jobs); later optional custom roles `.agents/limen/testmail-*.md`      | pi subagent                       | as now (Sonnet, Haiku)                                             | `~/.pi/agent/agents/testmail-*.md`                                                  |
| — (manual worktree cleanup)           | **keeper** + `limen prune --retire`                                                                           | Limen                             | Haiku or Sonnet                                                    | Package `templates/keeper.md`                                                       |

Model choices live in `spec/build.md` TRACK as one "Standing models" bullet (Limen's own board does it the same way). The coordinator passes `--engine pi --provider claude-bridge --model <m> --thinking <t> --extension <bridge>` on every spawn and continue. `model:` in `~/.pi/agent/agents/implementer.md` and `reviewer.md` stops being used for code work.

Extensions in jobs: jobs get none by default. Decide per extension (D4): `web-privacy-guard.ts` → pass to workers (keeps web queries generic); `stop-check.ts`, `config-autocommit.ts`, `handoff.ts`, `omarchy-system-theme.ts`, `subagent/` → not in jobs. A worker that can call subagents is out of scope.

### 2.5 Agent behavior (what each role does differently)

- **Coordinator.** Writes a short ticket, not a stage plan. Commits it, then spawns. Does not edit code. Reads each wake whole (final message + note check + open checks). Starts a review for every candidate (D5: Limen's default is "review when expensive"; this repo: always). Files the review as `review-N.md`. Lands and pushes. Asks the user only for: product questions, `[risky]` merges, credentials, real tradeoffs, and the 2-round FAIL limit. Keeps our reply rules (STE, max 4 lines).
- **Worker.** Starts from the ticket's seam, probe edit within minutes, commits each coherent piece, writes `note.md`, runs the narrow check first and the full suite once at the end, never edits the board or ticket status. New vs now: it commits itself, and it decides file-level details that the planner decided before.
- **Reviewer.** As now: PASS/FAIL, findings labelled proven/plausible/unverified. New: first line `PASS <sha>` / `FAIL <sha>`; "blocking is only a proven break of an acceptance bullet" (stricter than now: a plausible risk is a note, not a FAIL). For `[risky]` work, the ticket's acceptance must hold the risk, else the reviewer cannot block on it.
- **User.** Talks only to the coordinator. Approves: tickets for `[risky]` work, the `plan.md` for big work, every `[risky]` land, and tries the result at the end. Does not approve each stage any more (D6).
- **Lost on purpose:** stage-by-stage commits on `master`, pipeline mode "2 stages ahead", cold reviews of every plan. **Kept on purpose:** planner depth for `[risky]`, user approval of risky merges, one-migration-at-a-time.

### 2.6 Rule documents to change (stage 5)

- `CLAUDE.md` § Rules: "Subagents never commit" → "Limen workers commit on `limen/*` branches; only the coordinator lands and pushes". "One commit per stage after PASS" → "one land per PASS". Remove pipeline-mode text; point to `tasks/README.md`.
- `CLAUDE.md` § Tasks: new work in `spec/features/`; `tasks/` is history + the old active tasks.
- `tasks/README.md`: replace "How to run a slice", "Pipeline mode", "Git mode" with "Old flow (history)" + a link to a new section "Limen flow" (the picture in part 1 + commands).
- `~/.pi/agent/skills/run-task/`: retire, or reduce to "run the Limen flow for FNNN" (D7). `plan-task`: output = ticket + optional `plan.md`.
- `~/.pi/agent/bin/bg-agent.sh`, `~/.cache/ea-review/`: retire after the pilot.
- `~/.pi/agent/AGENTS.md`: add § Limen: the personal Claude route (2.1), "the Knowledge rules apply to the coordinator; Limen jobs follow the ticket and reminders".

## 3. Before and after (user question 2026-11-10)

Short answer: it is **not** "install, move the tasks, start". Three layers change: the tool (install), the repo (spec files + rule files), and the harness (skills, `AGENTS.md`, one rewritten loop skill). Pi settings, models, extensions and most skills stay.

### 3.1 What stays the same

- You talk to one pi session. Replies stay STE, max 4 lines.
- Pi is the engine; Claude models through `pi-claude-bridge` (with the `--extension` route of 2.1).
- `~/.pi/agent/settings.json`, `~/.pi/agent/extensions/*`, the `subagent` extension: no change. Limen does not change pi settings or credentials (`docs/setup.md`).
- Skills `plan-task` (changed output only), `handoff`, `explainer`, `gh-tickets`, `free-memory` and the others: stay.
- Product code, tests, CI, `docs/`, ADRs, `notes/`, `docs/known-alerts.md`, VPS deploy: no change.
- Worktree per task, review before merge, PASS/FAIL, max 2 FAIL rounds, the coordinator pushes `master`: same ideas, now done by Limen.
- The epic loop: still possible (3.3).

### 3.2 What changes

| Area                  | Now                                                                          | After                                                                                        |
| --------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Where work is written | `tasks/<state>/<name>.md` + stage files                                      | `spec/features/<lane>/FNNN-slug/` (`ticket.md`, `plan.md`, `review-N.md`, `outcome.md`)      |
| Status of work        | Status line + log in the task file                                           | Lane folder + `spec/build.md` board + `.limen/jobs/<id>/` records. No status line in tickets |
| Who builds            | `implementer` pi subagent, foreground, in the main checkout or task worktree | Limen worker job, background, own worktree + branch `limen/<id>`                             |
| Who commits           | Main session, after PASS                                                     | The worker, on its branch. The coordinator only lands (merges) and pushes                    |
| How the loop moves    | The main session waits for each subagent call                                | Event-driven: the job ends → a wake starts the coordinator's next turn                       |
| Review                | `reviewer` subagent / `bg-agent.sh` on a frozen copy                         | Review job on the job's branch; first line `PASS <sha>`                                      |
| Plan detail           | Planner writes step detail for every stage                                   | Short ticket; planner `plan.md` only for `[risky]` or big work                               |
| Proof of done         | Rule in `AGENTS.md`, checked by the reviewer                                 | Also checked by Limen at finish (`note.md`, `open-checks`)                                   |
| Crash / new session   | Handoff note                                                                 | `limen status` / `limen jobs` (handoff still useful for the coordinator's own context)       |
| Cleanup               | By hand                                                                      | `limen prune`, `limen prune --retire` (DBs still by hand)                                    |
| Your approvals        | Plan, each user checkpoint, end                                              | Risky tickets, `plan.md`, risky lands, end (D6)                                              |

### 3.3 Multi-step epics with implement → review loops

Yes, this still works. Two ways:

**Way 1 (recommended): the coordinator loops over Limen jobs.**

1. `plan.md` lists the slices of the epic (what `stage-NN` files hold now, shorter).
2. The coordinator spawns slice 1 and ends its turn.
3. The wake (job done) starts its next turn: it reads the result, spawns the review job.
4. Next wake: PASS → `limen land --keep-open` → push → spawn slice 2. FAIL → `limen continue <id> "fix: …"` → review again (max 2 rounds, then ask you).
5. Independent slices can run at the same time (2–3 workers); dependent slices wait for the land of the slice before.
6. Last slice: `limen land` (no `--keep-open`) closes the feature; you try the result.

This needs a rewritten `run-task` skill ("limen epic loop"): the same loop text, with `limen` commands in place of subagent calls. Limen itself has no epic concept; the loop is coordinator behavior. The loop stops at your checkpoints, as now.
Difference to now: the coordinator does not wait inside one long turn. Each step is one short turn after a wake. If the pi session closes, the jobs still finish; a new coordinator reads `limen status` and continues.

**Way 2: one Limen job per epic, the old loop inside it.** Spawn one worker with `--extension ~/.pi/agent/extensions/subagent/index.ts` and the `run-task` skill, so it runs implementer/reviewer subagents itself. Needs `--timeout` far above 90 min and a higher `LIMEN_MAX_TOOL_CALLS` (default 900). It keeps your old loop, but Limen sees only one job: no per-slice review records, no wakes per slice. Use it only as a bridge for an epic that already has stage files (for example `s5a`).

### 3.4 Harness settings: what to change

| Item                                               | Change?          | What                                                                                                                                                                                   |
| -------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.pi/agent/settings.json`                        | No               | —                                                                                                                                                                                      |
| `~/.pi/agent/extensions/*`                         | No               | They load in the coordinator. Jobs get only the ones passed with `--extension` (D4)                                                                                                    |
| `~/.pi/agent/agents/planner.md`                    | Yes              | Output = `plan.md` slice list (not stage files, not the task file)                                                                                                                     |
| `~/.pi/agent/agents/implementer.md`, `reviewer.md` | No (unused here) | Limen's worker/reviewer prompts replace them in this repo. Keep for other repos                                                                                                        |
| `~/.pi/agent/agents/testmail-*.md`                 | No               | Coordinator still calls them as subagents                                                                                                                                              |
| `~/.pi/agent/skills/run-task/`                     | Rewrite          | Way 1 loop with `limen` commands (D7)                                                                                                                                                  |
| `~/.pi/agent/skills/plan-task/`                    | Small            | Output: `ticket.md` (~300 words) + optional `plan.md`; use `limen ticket new`                                                                                                          |
| `~/.pi/agent/bin/bg-agent.sh`                      | Retire           | After the pilot                                                                                                                                                                        |
| `~/.pi/agent/AGENTS.md` (global)                   | Yes              | Add § Limen: Claude route; and "in a Limen job (`LIMEN_JOB=1`): do not create task or note files, follow the ticket" (else the Knowledge rules tell workers to write `tasks/active/…`) |
| `CLAUDE.md` (repo)                                 | Yes              | See 3.5                                                                                                                                                                                |
| `tasks/README.md`                                  | Yes              | Old flow becomes history; new "Limen flow" section                                                                                                                                     |

### 3.5 Why `CLAUDE.md` and `AGENTS.md` must change

A Limen worker is a normal pi process in a worktree of this repo. Pi will most likely load `~/.pi/agent/AGENTS.md` and the repo `CLAUDE.md` into it too (to prove in stage 1). Today these files say things that conflict with the Limen worker prompt:

- "Subagents never commit" / "commit after reviewer PASS" vs Limen: "the worker commits".
- "Git mode: worktree, branch `task/<name>`, merge --no-ff" vs Limen branches `limen/<id>` and `limen land`.
- "Create `tasks/active/<name>.md`", "update the status line before each commit" vs Limen: "never edit the board or ticket status".
- "Max 4 lines" is for replies to you; a worker's final message is a report to the coordinator.
  A model that reads two rule sets that conflict acts at random. So each rule must live in one place:

| Rule kind                                                                     | Lives in (after)                                                                               |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Code rules (template literals, const/let, patterns)                           | `.agents/limen/styleguide.md` (all roles); `CLAUDE.md` points to it                            |
| Repo safety rules (secrets, migrations, shared DB, risky list, no force-push) | `.agents/limen/reminders.md`; `CLAUDE.md` points to it                                         |
| Product intent                                                                | `spec/vision.md` (short) → `docs/product-brief.md` (long)                                      |
| Coordinator workflow (tickets, spawn, review, land, push, your checkpoints)   | `CLAUDE.md` § Workflow + `spec/build.md` TRACK                                                 |
| Your reply style (STE, 4 lines)                                               | `~/.pi/agent/AGENTS.md` + `.agents/limen/communication.md` overlay                             |
| Knowledge rules (notes, alerts)                                               | `~/.pi/agent/AGENTS.md`, with "not inside Limen jobs, except a notes file the ticket asks for" |

### 3.6 Effort

- Stage 1 (install + probe): ~1 hour.
- Stages 2–3 (repo files, rule rewrite, skill rewrite): ~half a day, mostly writing and your review of vision/styleguide.
- Stage 4 (pilot): one small feature, then one with 2 parallel workers.
- Moving tasks: no bulk move. Each planned task moves when it starts.

## 4. Input: S5c build feedback (2026-11-11)

Context only: this section makes no decision. The user decided on 2026-11-12 to adopt Limen, and to bring the build feedback into this plan instead of editing the current harness first. Use it when you answer D1–D9 and when you write stages 2–5.

Source: the S5c build session, `~/.pi/agent/sessions/--home-artek-Documents-repos-email_assistant--/2026-11-11T12-49-29-870Z_01a1caa7-ff0e-7455-8d98-ecb9d555cee6.jsonl`, the last 3 user/assistant messages. The user asked why the build is slow and how to change the implementer, reviewer and planner. Read them there for the full text.

### What the S5c build measured

- Stages 1–11 took about 2 h 20 min (14:00–16:20), plus the group review.
- 12 stages, 25 steps, one implementer call per step: 27 implementer calls, 17 reviews, 6 fix commits.
- Almost no `BLOCKED`. The one FAIL (stage 9) was a real bug. The detailed plan and the reviews pay off in quality.
- Times are partly estimates: no per-call timings were measured.

### Bottlenecks found

1. **One call per step.** Each call is a new process that reads the task file, the master plan and the stage file again.
2. **Checks run twice.** The implementer runs lint, typecheck, unit and int, then the main session runs the same line again. `test:int` alone takes 140 s. Cost: about 35 min over 14 commits.
3. **Heavy fix rounds.** Most of the 6 fix commits were one-line items. Each cost an implementer call, a full check and a commit.
4. **Everything in series.** The backend stages (2–6) and the web stages (7–10) did not need each other until the Playwright stage. Two worktrees with two databases could cut wall time by about 30–40 %.
5. **Review ritual.** The Opus reviews of stages 2–6 gave mostly minor findings. The "two stages ahead" limit, the review worktree and `bun install` each time add small waits.

### Proposals and where they land in Limen

| Proposal (S5c build)                                                | Limen equivalent                                                       | Where in this plan                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| One implementer call per stage, not per step                        | One worker job per stage (or per small ticket)                         | Stage 4 pilot: measure calls per feature                |
| Implementer runs only the affected tests, full check line once      | Worker runs affected tests; the finish check needs proof (exit 0)      | Stage 2: `reminders.md`; D5 says who runs the full line |
| Trivial fixes inline or with the next call, not as a full fix round | `limen continue <id>` with the findings, or the coordinator fixes them | D5/D6: write a policy line for trivial findings         |
| Review risky stages one by one, UI stages in pairs                  | Review job per land; batch by landing two slices at once               | D5 (review policy), D3 (Opus only for `[risky]`)        |
| Parallel tracks: backend and web in two worktrees and two databases | Parallel worker jobs, seat start queue, `scripts/limen-prepare.sh`     | Stage 2 (own DB per job), stage 4 second pilot (2 jobs) |
| Edit `run-task/SKILL.md` and `agents/implementer.md`                | Not done on purpose: D7 retires or rewrites `run-task`                 | D7, stage 5                                             |

### Keep as is (confirmed by the S5c build)

- **The reviewer stays read-only.** If it fixes its own findings, nobody reviews the fix. Limen's reviewer is also read-only.
- **Sub-agents (jobs), not one long thread.** The main session's context grows with each stage, and the S5c thread already needed a resume. Coarser units are the middle path.

## Decisions (user)

- **D1** Tasks folder: freeze `tasks/`, new work in `spec/features/`, move planned files lazily. (Recommendation: yes.)
- **D2** Order of work: `docs/roadmap.md` for slices, `spec/build.md` for the next tickets. (Recommendation: yes.)
- **D3** Models: coordinator Opus high; worker and reviewer Sonnet high; Opus for `[risky]`; scout Haiku. Or other.
- **D4** Extensions in jobs: only `web-privacy-guard.ts` + the bridge. Or other.
- **D5** Review: always a review job before land (recommendation), or Limen default (only when expensive).
- **D6** Checkpoints: you approve risky tickets, `plan.md`, risky lands and the final try; no per-stage approval. Or keep per-stage approval for `[risky]`.
- **D7** `run-task` skill: retire, or keep a thin "Limen flow" skill.
- **D8** Pilot feature (stage 4): candidates `testmail-mail-kind` (tooling, low risk) or `telegram-review-command` (product, small). Not `[risky]`.
- **D9** Planning files committed (Limen default) or `limen planning private` during the pilot. (Recommendation: committed: `spec/` is the new `tasks/`.)

## Plan

- [ ] **Stage 0 — clear the ground.** `sync-sort-folders` closes (stage 17). `s5a-web-foundation`: finish the build in the old flow, or pause it at a pushed stage boundary. Remove stale worktrees after a check: `~/ea-s3-test`, `~/.cache/ea-review/s5a-opus` (only when its review is done), `~/.cache/ea-testmail/82cf…`. Check: `git worktree list`.
- [ ] **Stage 1 — install and route probe (no repo change).** Clone, `npm install`, `npm link`. `limen --help`. In a scratch repo (`/tmp/limen-probe`, one commit): `limen init`, then one detached spawn on the Claude route of 2.1 with the task "create hello.txt, commit". Check: `limen jobs <id>` shows `done`, one commit, `model` line names the Sonnet route. Also note the env variables a job gets (`LIMEN_CONTEXT_ROOT`, `LIMEN_JOB_ID`) for the prepare script. Write the result in this log and in `~/.pi/agent/notes/2026-11-04-limen.md`.
- [ ] **Stage 2 — repo files.** `limen init` in the main checkout. Write `spec/vision.md`, `.agents/limen/styleguide.md`, `reminders.md`, `communication.md` (overlay), `scripts/limen-prepare.sh`, `.gitignore` line. User reviews vision and styleguide (they are injected into every call). Check: `limen status` runs; `bash scripts/limen-prepare.sh` in a test worktree gives `.env`, `node_modules`, own DB. Commit on master.
- [ ] **Stage 3 — roles and board.** `spec/build.md` with TRACK bullets: standing models (D3), review policy (D5), checkpoint policy (D6), `[risky]` list link. Edit `planner.md` output (2.4). Add § Limen to `~/.pi/agent/AGENTS.md`. Start the coordinator: `LIMEN_COORDINATOR=1 pi` in the main checkout; check that the Limen hooks load (the coordinator answers with the board digest). Commit.
- [ ] **Stage 4 — pilot (D8).** Ticket F001 via `plan-task` → commit → worker → review → land → push → user tries. Measure, in the log: spawn worked first time (y/n), steers needed, review rounds, open checks at finish, your attention time (rough minutes), DB/port conflicts, tokens (`limen jobs <id>` tokens line). Then one second feature with 2 independent workers in parallel.
- [ ] **Stage 5 — switch rules and close.** Decide go / no-go from the pilot. Go: change the documents of 2.6, retire `bg-agent.sh` and pipeline mode, add the DB drop to the close step. No-go: remove `spec/`, `.agents/limen/`, the stubs; keep the ideas of option A in the analysis note. Done-checklist, `git mv` this file to `tasks/done/`.

Rollback at any stage: Limen adds files only (`spec/`, `.agents/limen/`, `.pi/extensions/limen.ts`, `.omp/extensions/limen.ts`, `.limen/`). Remove them and the old flow works again; `tasks/` is not touched until stage 5.

## Risks to watch

- Upstream churn (0.1.0, many commits per week): pin the Limen clone to a commit during the pilot; update on purpose.
- Prepare failure is not fatal: a worker without `.env` may run against nothing or the wrong DB. Reminders say "check first".
- Linux: escaped child processes of a stopped job are not killed. After a stop, check for leftover `bun --watch` and browsers (`free-memory` skill).
- Workers run `pi --approve` with your user's access to `.env` (IMAP, Telegram, Gemini, VPS SSH key). Same trust as now, more agents.
- Injected text per call (shop manual ~230 lines + register + vision + styleguide): token cost. Keep vision and styleguide short.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe the new flow (`docs/architecture.md` only if it names the agent flow); ADR for the workflow change if the user wants one.
- [ ] Learned facts are in `notes/` and `~/.pi/agent/notes/2026-11-04-limen.md`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/` (or `spec/features/planned/`).

## Log

- 2026-11-10: User decided to move to Limen. Analysis note written; Limen `main` `f1e3a54` read; bridge provider mismatch found in code (not tested). This plan written. Waiting for D1–D9.
- 2026-11-10: Added part 3 "Before and after" (what stays, what changes, epic loop ways 1–2, harness settings, why CLAUDE.md and AGENTS.md change, effort) on the user's question.
