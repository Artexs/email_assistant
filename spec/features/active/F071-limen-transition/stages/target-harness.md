# Target harness after the move to Limen

Part of [`../plan.md`](../plan.md). It covers two topics only:
(A) how to install Limen for this repository, (B) how the AI SDLC works after the move: planning, build, review, land.
Facts come from Limen `main` `f1e3a54` (read 2026-11-10/12) and from the current skills `~/.pi/agent/skills/{plan-task,run-task}/SKILL.md`.
Marks: **same** = no change, **changed**, **new**, **retired**.

## A. Installation

### A.1 Two places: the machine and the repo

Limen has two parts. The program is on the machine, one time for all projects. The project files are in this repo.

| Where              | What                                                     | How                                                                                       |
| ------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Machine (one time) | Limen clone `~/Documents/repos/limen`, `limen` on `PATH` | `git clone https://github.com/overment/limen && cd limen && npm install && npm link`      |
| Machine (one time) | Pin the version for the pilot                            | `git checkout f1e3a54` in the clone; update later on purpose (`git pull`, then `/reload`) |
| Machine (optional) | Herdr (tabs per job)                                     | Not now. Without Herdr: plain pi coordinator, detached jobs, wakes through the Pi hook    |
| Repo               | Project files                                            | `limen init` in the main checkout, then write the files of A.2                            |

Limen does not change `~/.pi/agent/settings.json`, the pi auth or the extensions (`docs/setup.md`).

### A.2 Files in this repo

| File                                                  | Mark        | Content                                                                                                                                                       |
| ----------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.pi/extensions/limen.ts`, `.omp/extensions/limen.ts` | new         | Stubs from `limen init`. They load the Limen hooks (wake, steering, communication) from the installed package                                                 |
| `spec/vision.md`                                      | new         | ~30 lines: product principles + current direction. Digest of `docs/product-brief.md`. In every coordinator call                                               |
| `.agents/limen/styleguide.md`                         | new         | ~40 lines: code shape, prefer, avoid. Digest of `docs/code-patterns.md` + code rules of `CLAUDE.md`. In every call of every role                              |
| `.agents/limen/reminders.md`                          | new         | Binding repo rules (secrets, own DB per job, one migration at a time, `[risky]` list, no force-push, the check line). First prompt of each job + finish check |
| `.agents/limen/communication.md`                      | new         | Overlay of Limen's speech register + STE rules                                                                                                                |
| `spec/build.md`                                       | new         | Board. TRACK holds the standing policy: models per role, review policy, user gates. NOW/PROVEN generated                                                      |
| `spec/features/{planned,active,done,dropped}/`        | new         | One folder per feature `FNNN-slug/`: `ticket.md`, `plan.md` (optional), `review-N.md`, `outcome.md`                                                           |
| `scripts/limen-prepare.sh`                            | new         | Runs in each new job worktree: copy `.env`, `bun install --frozen-lockfile`, `bun run db:worktree <job>`                                                      |
| `.gitignore`                                          | changed     | Add `.limen/` (job records stay local)                                                                                                                        |
| `CLAUDE.md`                                           | changed     | Workflow part points to Limen; code and safety rules move to styleguide/reminders (one place per rule)                                                        |
| `tasks/README.md`                                     | changed     | Old flow becomes history; "Limen flow" section                                                                                                                |
| `tasks/`                                              | same        | Frozen history + the old active tasks. New work goes to `spec/features/`                                                                                      |
| `AGENTS.md` (repo root)                               | not created | A project `AGENTS.md` replaces Limen's whole shop manual                                                                                                      |

### A.3 The Claude model route (must be proven first)

- Jobs start with `--no-extensions`. Limen loads the Claude bridge itself only for provider `pi-claude`. Our bridge registers `claude-bridge` (`pi-claude-bridge` 0.11.0, `src/convert.ts:8`).
- Route to test: `limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high --extension ~/.pi/agent/npm/node_modules/pi-claude-bridge ...`
- Limen wants personal routes in personal instructions, not in project Git: the route goes to `~/.pi/agent/AGENTS.md` § Limen.
- Proof: in a scratch repo, one job "create hello.txt and commit" ends `done`; `limen jobs <id>` shows the served model.

### A.4 Verification of the install

1. `limen --help` runs.
2. Scratch repo probe of A.3 passes.
3. In this repo: `limen status` runs; `bash scripts/limen-prepare.sh` in a test worktree gives `.env`, `node_modules` and its own DB.
4. `LIMEN_COORDINATOR=1 pi` in the main checkout: the coordinator loads the hooks (it sees the board digest).
5. Check that a job loads `CLAUDE.md` and `~/.pi/agent/AGENTS.md` (ask a probe job to quote one rule). This decides how much of B.5 is needed.

## B. The AI SDLC after the move

### B.1 The phases

```
1 PLAN ──▶ 2 TICKET ──▶ 3 BUILD ──▶ 4 REVIEW ──▶ 5 LAND ──▶ 6 CLOSE
 you +      commit on     worker      review job    coordinator   you try it,
 coordinator master       job per     per slice     merges+push   outcome.md
                          slice       (PASS/FAIL)   next slice ↺
```

### B.2 Phase by phase: now and after

| Phase       | Now                                                                                                                                 | After                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Plan      | `plan-task` skill in the main session (Opus): task file + stage files with full step detail; cold review by `reviewer`; you approve | **Changed.** Same skill, same depth for big or `[risky]` work, same questions to you and the same cold review. Output: `ticket.md` (~300 words: outcome, scope, out of scope, acceptance) + `plan.md` (decisions, facts checked, slice list, per slice: files, interfaces, tests, check, `[risky]` mark). Small work: ticket only, no `plan.md`. You approve the ticket and `plan.md`        |
| 2 Ticket    | Task file in `tasks/active/`, plan commit                                                                                           | **Changed.** `limen ticket new` gives the number; the coordinator commits the folder on `master` (workers read only committed files)                                                                                                                                                                                                                                                         |
| 3 Build     | `run-task`: one `implementer` subagent call per step (27 calls in S5c), foreground, in the task worktree, never commits             | **Changed.** One worker **job** per batch of 2–3 slices (a `[risky]` slice alone; user decision U1, 2026-11-12), background, own worktree + branch `limen/<id>`, own DB from the prepare script. Prompt: Limen worker template + reminders + `Ticket:` pointer + "slice N of plan.md". The worker commits. It runs the affected tests while it works and the full check line once at the end |
| 3 Parallel  | Pipeline mode: builds in series, reviews in background, "2 stages ahead"                                                            | **Changed.** Independent slices (example S5c: backend and web) run as jobs at the same time; dependent slices wait for the land of the slice before. Limen's seat queue limits the load                                                                                                                                                                                                      |
| 4 Review    | `reviewer` subagent per stage, or `bg-agent.sh` on a copy in `~/.cache/ea-review/`; group review at checkpoints                     | **Changed.** `limen spawn --review --detached --branch limen/<id>` per batch. First line `PASS <sha>` / `FAIL <sha>`. The coordinator files it as `review-N.md`. Group review = one review job with `--base <first> --head <last>`. The reviewer stays read-only (**same**)                                                                                                                  |
| 4 Fix round | New `implementer` call with the findings, full check, fix commit                                                                    | **Changed.** `limen continue <id> "fix: <findings>"`: the same worker conversation, so it does not read everything again. Max 2 FAIL rounds, then you decide (**same**). One-line findings go into the next slice's job, not a separate round (§4 of the task)                                                                                                                               |
| 5 Land      | Main session commits each stage after PASS, pushes; at the end `merge --no-ff task/<name>`                                          | **Changed.** `limen land <id> --keep-open` merges the slice into `master`; the coordinator pushes. The last slice: `limen land <id>` moves the feature to `done/YYYY-MM/`. `[risky]` slice: the coordinator asks you before land                                                                                                                                                             |
| 6 Close     | You try the result; done-checklist; `git mv` to `tasks/done/`                                                                       | **Same idea.** You try it; the coordinator writes `outcome.md`, notes, alerts. `limen prune --retire` removes worktrees and branches; the prepare script's DB is dropped by hand (`db:worktree --drop`)                                                                                                                                                                                      |
| Recovery    | Handoff note, read the task file                                                                                                    | **Changed.** `limen status` and `limen jobs` show every job. Jobs keep running if the coordinator closes. Handoff stays for the coordinator's own context                                                                                                                                                                                                                                    |

### B.3 Roles: who runs where

| Role                | Mark         | Runs as                                                          | Model (proposal D3)                                           | Prompt source                                              | Edits code | Commits                        |
| ------------------- | ------------ | ---------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- | ---------- | ------------------------------ |
| Coordinator         | changed      | Your pi session, `LIMEN_COORDINATOR=1`                           | Opus, high                                                    | Limen shop manual + `CLAUDE.md` + vision/styleguide/board  | No         | Tickets, plans, reviews, lands |
| Planner (plan-task) | same         | The coordinator, in the plan session                             | Opus, high/max                                                | `plan-task` skill (output changed)                         | No         | Plan                           |
| `planner` subagent  | changed      | pi subagent, only to add detail to approved slices of a big plan | Opus, medium                                                  | `~/.pi/agent/agents/planner.md` (output: `plan.md` slices) | No         | No                             |
| Worker              | new          | Limen job, detached                                              | Sonnet, high; Opus for `[risky]`                              | Limen `templates/worker.md` + reminders                    | Yes        | Yes, own branch                |
| Reviewer            | changed      | Limen job `--review`, detached                                   | Sonnet, high; Opus for `[risky]`; other model than the worker | Limen `templates/reviewer.md` + reminders                  | No         | No                             |
| Scout               | new          | Limen job `--role scout`, read-only                              | Haiku                                                         | Limen `templates/scout.md`                                 | No         | No                             |
| `implementer` agent | retired here | —                                                                | —                                                             | Kept in `~/.pi/agent/agents/` for other repos              | —          | —                              |
| testmail agents     | same         | pi subagents of the coordinator                                  | Sonnet, Haiku                                                 | `~/.pi/agent/agents/testmail-*.md`                         | No         | No                             |

### B.4 The loop that runs a whole epic

The old `run-task` loop stays as an idea. It becomes event-driven: the coordinator does one step per turn, and a job's end (the wake) starts the next turn.

```
for each slice in plan.md, in order (independent slices may start together):
  spawn worker ─wake─▶ read final message + note check
     open checks? ──▶ continue <id> (prove or fix) ─wake─▶ …
  spawn review ─wake─▶ PASS? ──no──▶ continue <id> "fix" ─wake─▶ review again (max 2)
                         │yes
                         ▼
             [risky] or user checkpoint? ──yes──▶ ask you
                         ▼
             land --keep-open, push, tell you one line
last slice: land (closes the feature) ▶ you try it ▶ outcome.md
```

Skill change: `run-task` gets a rewrite with this loop and the `limen` commands (D7). `plan-task` changes only its output (B.2 phase 1). The loop text says when to stop and ask you, as now: a question from a job, 2 FAIL rounds, a change of scope, a user checkpoint.

### B.5 Behavior rules: one place per rule

A Limen job is a normal pi process in a worktree, so it may also load `CLAUDE.md` and `~/.pi/agent/AGENTS.md` (A.4 step 5 proves it). Rules that conflict with the worker prompt must move.

| Rule                                                         | Now in                               | After                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Code rules (template literals, `const`/`let`, patterns)      | `CLAUDE.md`, `docs/code-patterns.md` | `.agents/limen/styleguide.md`; `CLAUDE.md` links it                                                                       |
| Safety rules (secrets, migrations, shared DB, no force-push) | `CLAUDE.md`, `tasks/README.md`       | `.agents/limen/reminders.md`; `CLAUDE.md` links it                                                                        |
| "Subagents never commit", "commit after PASS", Git mode      | `CLAUDE.md`, `tasks/README.md`       | Replaced: "workers commit on `limen/*`; only the coordinator lands and pushes"                                            |
| Task files, status lines, notes, logs                        | `~/.pi/agent/AGENTS.md`, `CLAUDE.md` | Coordinator only. Add: "in a Limen job (`LIMEN_JOB=1`), follow the ticket; write only the notes file the ticket asks for" |
| Reply style (STE, max 4 lines to you)                        | `~/.pi/agent/AGENTS.md`              | Same for the coordinator; a job's final message is a report to the coordinator                                            |
| Models per role                                              | `~/.pi/agent/agents/*.md` `model:`   | `spec/build.md` TRACK; the coordinator passes them on each spawn                                                          |
| Claude route                                                 | —                                    | `~/.pi/agent/AGENTS.md` § Limen                                                                                           |

### B.6 Your gates

| Gate                       | Now                    | After                           |
| -------------------------- | ---------------------- | ------------------------------- |
| Plan approval              | Yes                    | Yes (ticket + `plan.md`)        |
| Planner questions          | Yes                    | Yes                             |
| User checkpoints in a plan | Yes, with group review | Yes, with a group review job    |
| Each stage                 | One line per stage     | One line per land               |
| `[risky]` merge            | Through checkpoints    | Yes, before each `[risky]` land |
| Try the result             | Yes                    | Yes                             |

### B.7 Detail of plans (closed 2026-11-12)

User decision U3: keep the detailed plans of `plan-task` (stage files with full step detail) in the feature folder. The reminders say: "when the ticket names a plan, follow its decisions and interfaces; a deviation is a question, not a choice".

## C. Harness tree after the move

```
~/.pi/agent/
  settings.json                 same
  AGENTS.md                     changed  (§ Limen: Claude route, LIMEN_JOB rule)
  extensions/                   same     (coordinator only; jobs get only --extension paths)
  agents/planner.md             changed  (output = plan.md slices)
  agents/implementer.md         same file, not used in this repo
  agents/reviewer.md            same file, not used in this repo
  agents/testmail-*.md          same
  skills/plan-task/             changed  (output = ticket.md + plan.md)
  skills/run-task/              changed  (rewrite: Limen epic loop, B.4)
  skills/handoff, others        same
  bin/bg-agent.sh               retired after the pilot
~/Documents/repos/limen/        new      (the Limen program, npm link)
~/.limen/                       new      (seat queue, rules; created by Limen)

email_assistant/
  CLAUDE.md                     changed  (B.5)
  tasks/README.md               changed  (old flow = history)
  tasks/                        same     (history)
  spec/                         new      (vision, board, features)
  .agents/limen/                new      (styleguide, reminders, communication)
  .pi/extensions/limen.ts       new      (hook stub)
  scripts/limen-prepare.sh      new
  .limen/                       new, gitignored (job records)
```
