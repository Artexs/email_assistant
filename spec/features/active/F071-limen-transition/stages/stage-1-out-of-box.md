> **Status 2026-11-12 — in progress — steps 1.1–1.8 done.** Next: step 1.9 waits for an S6-quiet time (user); then 1.10, 1.11.

# Stage 1 — Limen out of the box

Part of [`../plan.md`](../plan.md) §6 (decisions V1–V8). Git mode: master (main checkout), except step 1.9 (migration branch, see there).

## Goal

Limen runs in this repo as its author designed it: package prompts only (no `worker.md` / `reviewer.md` / `communication.md` overlay, no repo `AGENTS.md`), Herdr coordinator, detached jobs, the Limen folder layout. Our own rules do not fight it. The user then uses it for real work and sees how it behaves.

## Done when

1. `limen --help` runs; `herdr --version` prints 0.9.1.
2. Probe job in `/tmp/limen-probe` ends `done` with 1 commit, on `claude-bridge/claude-sonnet-5-5`.
3. `limen status` and `limen board` run in this repo without errors.
4. All task history except the S6 family is in `spec/features/`; `limen ticket check limen/migrate-tasks` passes; no tracked file outside the S6 family links to a moved `tasks/` path.
5. `CLAUDE.md` and `~/.pi/agent/AGENTS.md` hold no rule that tells an agent "never commit", "use Git mode / `task/<name>`", "create `tasks/active/…`" or "update the status line".
6. A Herdr coordinator pane (`LIMEN_COORDINATOR=1`) in the main checkout sees the board (the user asks it "what is on the board?").

## What stage 1 does NOT do (stage 2 or 3)

- No change of `plan-task`, `run-task`, `handoff` skills or of the `planner` / `implementer` / `reviewer` agent files (they still name `tasks/`; the old flow keeps them for the S6 family).
- No `.agents/limen/reminders.md`, no overlays, no custom roles, no "always review" policy: the coordinator follows Limen's own judgment.
- No delete of `bg-agent.sh`, `~/.cache/ea-review/`, `tasks/README.md` (the S6 family still needs them).

## Facts checked (2026-11-12, Limen `main` `f1e3a54`, clone in `/tmp/limen-read/limen`)

| Fact | Source |
| --- | --- |
| `limen init` creates `spec/vision.md`, `spec/build.md`, `spec/features/{planned,active,done,dropped}/.gitkeep`, `spec/features/_template/{ticket,outcome}.md`, `.agents/limen/styleguide.md`, `.pi/extensions/limen.ts`, `.omp/extensions/limen.ts`, `.limen/jobs/`; appends `/.limen/` to `.gitignore`; never overwrites a file | `src/commands/init.ts:66–100` |
| A project file `AGENTS.md`, `.agents/limen/{worker,reviewer,communication}.md` replaces the package prompt | `src/project/inherit.ts:15–20` |
| Without `--model` / `LIMEN_WORKER_MODEL`, jobs use `openai-codex/gpt-6-astra:high`; the board holds models per role; the coordinator passes them as flags | `docs/setup.md` § Models |
| Limen adds the bridge extension only for provider `pi-claude`; jobs start with `--no-extensions` | `src/runtime/engine.ts:282–315` |
| Our bridge registers provider `claude-bridge` | `~/.pi/agent/npm/node_modules/pi-claude-bridge/src/convert.ts:8` |
| Personal routes (`--extension <path>`) belong in personal instructions, not in project Git | `docs/setup.md` § Personal model routes |
| Limen finds Herdr only as `herdr` on `PATH` (or `LIMEN_HERDR`) and needs `HERDR_ENV=1` | `src/integrations/herdr.ts:57,775` |
| `herdr-app` 0.1.13 / `herdr-core` (`hc`) 0.1.18 are a different program (no `herdr integration`, no `herdr agent start`); `herdr` 0.9.1 was removed 2026-11-05 | `/var/log/pacman.log`, `hc --help`, `herdr-app --help` |
| `omarchy/herdr 0.9.1-2` (Limen's last known-good) is in the Omarchy repo; `herdr-app` declares no conflict | `pacman -Ss '^herdr'`, `pacman -Qi herdr-app` |
| The coordinator is "a hosted session in Herdr for this plant (`LIMEN_COORDINATOR=1`)" | `templates/agents.md:7` |
| Ticket front matter accepts only known fields (`opened`, `landed`, `touches`, …); an unknown field is an error; an active ticket without front matter is an error | `src/picture/tickets.ts:128–200` |
| Heading form `# FNNN · Title`; `## Outcome` gives the board line | `src/picture/tickets.ts:143–147` |
| `land` moves a ticket to `done/YYYY-MM/` and sets `landed:` | `docs/commands.md:102`, `src/project/lanes.ts:160` |
| `ticket new` takes one more than the highest F number in use (folders, branches, labels) | `docs/commands.md:117` |
| Prepare gets `LIMEN_CONTEXT_ROOT` in its env (probe confirms the value) | `src/runtime/job-setup.ts:24` |
| Jobs do not pass `--no-context-files`, so pi most likely loads `CLAUDE.md` and `~/.pi/agent/AGENTS.md` in jobs | `src/runtime/engine.ts:248` (only `--append-system-prompt`); probe 1.3 proves it |

## Decisions of this stage (agent, from V1–V8)

- **S1-D1 Herdr:** install `omarchy/herdr` 0.9.1 next to `herdr-app` and run `herdr integration install pi`. Why: the author designs the coordinator as a Herdr pane, and 0.9.1 is the tested version. `herdr-app` stays as it is. Fallback if 0.9.1 conflicts with `herdr-app`: remove it again and run the coordinator as a plain `LIMEN_COORDINATOR=1 pi` (Limen supports it; no job tabs).
- **S1-D2 Models (board):** worker and reviewer `--engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high` (same as `reviewer.md`; `implementer.md` has medium, Limen's worker does more per job, so high). Coordinator: the user's pi session model.
- **S1-D3 S6 family stays:** `tasks/active/s6-pre-sale.md`, `s6a-customer-core.md` (+ folder) and `tasks/planned/s6b…s6f-*.md` stay in `tasks/`, with `tasks/README.md`, until S6 is done (user, 2026-11-12). Another session works on them now: stage 1 does not touch these files.
- **S1-D4 Migration form:** each old task becomes `spec/features/<lane>/FNNN-<old-name>/` with a short `ticket.md` and the old file moved whole (`git mv`) to `plan.md`; its stage folder moves to `stages/`. History (`git log --follow`) stays.
- **S1-D5 Migration runs on a branch** `limen/migrate-tasks`, so `limen ticket check limen/migrate-tasks` can test all new tickets against Limen's land gate before the merge to `master`.

## Steps

### 1.1 Clear the ground

- Remove stale worktrees (both on `master`, no changes, checked 2026-11-12): `git worktree remove ~/ea-s3-test`, `git worktree remove ~/.cache/ea-testmail/82cf1562c682f53b157e4f6536227e9afa2cb433`, then `git worktree prune`.
- Remove the empty folder `~/Documents/repos/email_assistant-wt` (`rmdir`, fails if not empty).
- Keep `~/.cache/ea-review/` (the S6 flow may use pipeline mode).
- Check: `git worktree list` shows only the main checkout (and S6 worktrees, if the other session made some).
- Rollback: `git worktree add --detach <path> <sha>`.

### 1.2 Install Limen and Herdr

1. `git clone https://github.com/overment/limen.git ~/Documents/repos/limen && cd ~/Documents/repos/limen && git checkout f1e3a54 && npm install && npm link`.
2. `sudo pacman -S omarchy/herdr` (user step: needs sudo). Then `herdr integration install pi` (writes a Herdr state extension under `~/.pi/agent/extensions/`; record its file name).
3. Check: `limen --help`, `herdr --version` (0.9.1), `herdr-app --version` (still 0.1.13, still opens).
- Rollback: `npm unlink -g limen`, `rm -rf ~/Documents/repos/limen`, `sudo pacman -R herdr`, remove the Herdr state extension file.

### 1.3 Probe in a scratch repo (no change to this repo)

1. `mkdir /tmp/limen-probe && cd /tmp/limen-probe && git init && printf '# Probe\n\nMARKER-CLAUDE: when asked for the marker, answer BLUE-17.\n' > CLAUDE.md && git add . && git commit -m init && limen init && git add -A && git commit -m "limen init"`.
2. Spawn without the bridge path first: `limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high --label "probe no bridge" 'Create hello.txt with one line, commit it.'`. Expected: fails (model not found). Record the error text.
3. Spawn with the route: same + `--extension ~/.pi/agent/npm/node_modules/pi-claude-bridge --prepare 'env | grep ^LIMEN_ > limen-env.txt'` and the instruction `'Create hello.txt with one line, commit it. In your final message: quote the marker answer from CLAUDE.md if you see it, quote the first heading of ~/.pi/agent/AGENTS.md if it is in your context, and print pwd.'`.
4. Check: `limen jobs <id>` = done, 1 commit, served model Sonnet; read `limen-env.txt` in the job worktree.
5. Record in `~/.pi/agent/notes/2026-11-04-limen.md`: route works y/n, context files loaded y/n, `LIMEN_CONTEXT_ROOT` value, worktree path.
- If the job does **not** load `CLAUDE.md` / `AGENTS.md`: steps 1.4 stay (they are also for the coordinator), but mark the "Inside a Limen job" line as optional.
- Rollback: `rm -rf /tmp/limen-probe`.

### 1.4 Rule files (before → after)

**`~/.pi/agent/AGENTS.md`** (global, all repos, V8). Lines removed:

```
- **Tasks:** `<root>/tasks/{active,planned,done}/<name>.md`.
  - When I start a new task or ask for a task or an implementation plan, create `tasks/active/<name>.md`.
  - Start each plan with: `> **Status YYYY-MM-DD — <planned | in progress | code done, deploy left | done>.**` and what is left.
  - Update the status line before each commit that changes the task.
  - When the task is finished, `git mv` it to `tasks/done/`. Put ideas for later in `tasks/planned/`.
- **Session start:** read `tasks/active/`. Before you investigate a topic, grep `notes/`, `tasks/` and `docs/known-alerts.md`.
```

and in `## Replies`: "Put detail in a file and give the path in chat: the task file of this chat, else a notes file".

Lines added:

```
- **Work items:** Limen feature folders `<root>/spec/features/{planned,active,done/YYYY-MM,dropped/YYYY-MM}/FNNN-slug/ticket.md`. Create one with `limen ticket new "what becomes true"`. Where `limen init` did not run, use the same layout by hand. Detail that does not fit the ticket goes to `plan.md` in the same folder.
- A repo can keep old `tasks/` files while their work finishes. Its `CLAUDE.md` says which.
- **Session start:** read `spec/build.md` and `spec/features/active/`. Before you investigate a topic, grep `notes/`, `spec/features/` and `docs/known-alerts.md`.
```

`## Replies`: "…: the ticket folder of this chat, else a notes file…".

New section:

```
## Limen
- Inside a Limen job (`LIMEN_JOB=1`), the Limen prompt and the ticket decide the work, the commits and the final report. The Replies and Knowledge rules above are for sessions with me.
- Personal Claude route for Limen jobs: `--engine pi --provider claude-bridge --model <model> --thinking <level> --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge`. Limen adds the bridge by itself only for provider `pi-claude`.
```

Unchanged: Harness, the rest of Replies, Done, Web search, Notes, Alerts, Root.

Open item (default in brackets): `~/.pi/agent/tasks/active/{harness-sync,short-replies}.md` [move by hand to `~/.pi/agent/spec/features/active/F001-…`, `F002-…`, no `limen init` there].

**Repo `CLAUDE.md`.** Lines removed (the whole Git-mode and Plan-stages blocks, and `## Tasks`):

```
- Git mode per task, named in the task file: … (4 lines)
- Plan stages (the plan → build → review loop …):
  - Subagents (`planner`, `implementer`, `reviewer`) never commit or push. The main session commits and pushes.
  - One commit per stage, only after the reviewer gives PASS. …
  - Exception, pipeline mode …
  - Commit message: `<area>: <slice> stage N — <what>`. …
  - A problem found after the push gets a new fix commit. Never rewrite pushed history.
## Tasks
- **Tasks** are the record of all work … (6 bullets)
```

Kept: the intro, the alert line, the first four rules (secrets, template literals, `const`/`let`, review staged changes), "Never force-push …" (moved to its own bullet with "Never rewrite pushed history"), `## Notes`.

Added:

```
- Shared runtime: one dev DB, GreenMail and the ports in `.env`. A Limen job gets its own DB from `scripts/limen-prepare.sh`. Only one checkout at a time runs `bun run test:int`. Only one at a time adds a DB migration or changes `bun.lock`.

## Work

- Work runs through Limen. Tickets: `spec/features/<lane>/FNNN-slug/`. Board and standing choices (models, prepare): `spec/build.md`. Product intent: `spec/vision.md`. Code style: `.agents/limen/styleguide.md`.
- Old tasks are in `spec/features/` too: `plan.md` in each folder is the old task file.
- Old flow, until S6 is done: `tasks/active/s6-pre-sale.md` and its sub-tasks `s6a`–`s6f` run with `run-task` and `tasks/README.md`.
```

Also the `CLAUDE.md` intro line "Code patterns: @docs/code-patterns.md" stays.

- Check: `grep -nE "never commit|Git mode|tasks/active|status line" CLAUDE.md ~/.pi/agent/AGENTS.md` → only the S6 "old flow" line.
- Rollback: `git revert` (repo); `~/.pi/agent` is a git repo with autocommit: `git -C ~/.pi/agent revert <sha>`.

### 1.5 `limen init` in the repo

- `cd ~/Documents/repos/email_assistant && limen init`. Expected output: `created …` for each file of the facts table, `ready .limen/jobs`.
- Check: `git status --short` shows only the new files and `.gitignore` (+ `/.limen/`).

### 1.6 `spec/vision.md` and `.agents/limen/styleguide.md` (user gate)

- `vision.md`: ~30 lines in the template's two sections (Product principles, Current direction), from `docs/product-brief.md` and `docs/roadmap.md` (S6 now). Link the long docs; do not copy them.
- `styleguide.md`: ~40 lines in Shape / Prefer / Avoid, from `docs/code-patterns.md` and the code rules of `CLAUDE.md`. Add the check line: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
- **The user reads both files and says OK.** Limen calls `vision.md` "human-owned".

### 1.7 `spec/build.md` TRACK

Three bullets at most (template rule):

```
- Standing models: worker and reviewer `--engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high`, with the personal Claude route (`~/.pi/agent/AGENTS.md` § Limen). Prepare: `--prepare 'bash scripts/limen-prepare.sh'`.
- Now: S6 pre-sale runs in the old flow (`tasks/active/s6-pre-sale.md`); new work goes here.
```

NEXT: empty (the user picks the test feature, V5). NOW / PROVEN: `limen board --write` after the migration.

### 1.8 `scripts/limen-prepare.sh`

1. `root="${LIMEN_CONTEXT_ROOT:-$(git worktree list --porcelain | awk 'NR==1{print $2}')}"`; copy `$root/.env` to `.env` (never print it).
2. `bun install --frozen-lockfile`.
3. `bun run db:worktree "${LIMEN_JOB_ID}"`; append the two printed env lines to `.env`.
4. `set -euo pipefail`; exit non-zero on failure.
- Check: in a test worktree (`git worktree add --detach /tmp/ea-prep HEAD`), run `LIMEN_JOB_ID=prep-test bash scripts/limen-prepare.sh`; then `.env`, `node_modules` exist and `psql`/`db:worktree` lists `prep-test`. Clean up with `bun run db:worktree prep-test --drop` and `git worktree remove /tmp/ea-prep`.
- Cleanup of job DBs: `limen prune` does not drop them. Stage 2 adds a cleanup step; until then drop by hand.

Commit of 1.5–1.8 on `master`: `limen: stage 1 — limen init, vision, styleguide, board, prepare`. Explicit paths only.

### 1.9 Move the task history to `spec/features/` (branch `limen/migrate-tasks`)

Scope: every tracked `tasks/{done,active,planned}/*.md` and its folder, except the S6 family (S1-D3) and `tasks/README.md`. Count on 2026-11-12: done 34 files + 12 folders, active 1 (`limen-transition` + folder), planned 40 (tracked, without `s6b…s6f`). The script recounts.

1. `git switch -c limen/migrate-tasks`.
2. One-off script `scripts/one-off/migrate-tasks.ts` (Bun, deleted in stage 3):
   - Order: by the date of the first commit that added the file (`git log --diff-filter=A --follow --format=%cs`), oldest first. Numbers F001, F002, … in that order.
   - Lane: `done` → `done/<YYYY-MM>/` of the commit that added it under `tasks/done/`; `active` → `active/`; `planned` → `planned/`.
   - Slug: the old file name (`s5a-web-foundation` → `F0NN-s5a-web-foundation`).
   - `git mv tasks/<state>/<name>.md spec/features/<lane>/FNNN-<name>/plan.md`; `git mv tasks/<state>/<name>/ spec/features/<lane>/FNNN-<name>/stages/` when it exists.
   - Write `ticket.md`:
     ```
     ---
     opened: <first-add date>
     landed: <done date>        # done lane only
     ---

     # FNNN · <H1 of the old file>

     ## Outcome

     <first paragraph of the old "## Goal" section; else the status line text without the bold mark>

     ## Notes

     Moved from `tasks/<state>/<name>.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
     ```
   - Write the map `old path → new path` to `spec/features/migration-map.tsv` (tracked, so later readers can follow old links in chat history).
   - Rewrite links in every tracked text file (`git ls-files '*.md' '*.ts' '*.html'` + `deploy/README.md`): each old path → new path, also relative forms (`../done/x.md`, `x/stage-01.md` inside `plan.md` → `stages/stage-01.md`). The S6 family files get their links to moved files rewritten too (only link text changes).
3. Checks:
   - `limen ticket check limen/migrate-tasks` → all tickets pass.
   - `git grep -nE "tasks/(done|planned|active)/" -- ':!tasks' ':!spec/features/migration-map.tsv'` → only S6-family paths.
   - A link check script (same one-off): every relative `.md` link in tracked files resolves.
   - `limen board --write`; `limen board` lists the active ticket(s) and the PROVEN lines.
   - `bun run lint && bun run typecheck` (the `host-check.ts` comment change).
4. Merge: `git switch master && git merge --no-ff limen/migrate-tasks`, push, `git branch -d limen/migrate-tasks`. Commit message: `tasks: move task history to spec/features (Limen layout)`.
- Run window: when the S6 session does not commit (ask the user). The S6 files are not moved, so a conflict can come only from link lines in `docs/` or `notes/` that both sides edit.
- Rollback: before the merge, delete the branch. After the merge, `git revert -m 1 <merge>`.

This task itself moves too: `spec/features/active/F071-limen-transition/plan.md` → `spec/features/active/FNNN-limen-transition/plan.md`, its folder → `stages/` (this file then is `stages/stage-1-out-of-box.md`).

### 1.10 `tasks/README.md`

Add one line at the top: "Old flow. It applies only to the S6 family (`s6-pre-sale`, `s6a`–`s6f`) until S6 is done. All other work: `spec/features/` (Limen)." No other change (the S6 run needs its procedure).

### 1.11 Start the coordinator and hand over

1. In a Herdr 0.9.1 space named `email_assistant`: open a pi tab with `LIMEN_COORDINATOR=1` in the main checkout (`herdr agent start limen-peer --kind pi --pane <pane> -- --provider claude-bridge --model claude-opus-5-5 --thinking high`, or a plain tab + `LIMEN_COORDINATOR=1 pi`).
2. Ask it: "What is on the board?" It must quote TRACK and NOW.
3. The user gives it the first real task in plain words (V5).
- Log in `plan.md`: what worked out of the box, what needed a manual step.

## After stage 1: the whole picture

```
~/.pi/agent/
  AGENTS.md                     CHANGED  Knowledge → spec/features; § Limen (job rule, Claude route)
  settings.json                 same
  extensions/                   same + Herdr state extension (herdr integration install pi)
  agents/planner|implementer|reviewer.md   same (old flow, S6 only)
  agents/testmail-*.md          same
  skills/plan-task, run-task, handoff      same (still name tasks/; stage 2)
  bin/bg-agent.sh               same (old flow, S6 only)
  tasks/active/*.md             moved to spec/features/active/ (open item, default)
~/Documents/repos/limen/        NEW      Limen at f1e3a54, npm link → `limen` on PATH
~/.limen/                       NEW      seat state (created by Limen)
/usr/bin/herdr (0.9.1)          NEW      next to herdr-app (unchanged)
~/.cache/ea-review/             same (old flow)

email_assistant/
  CLAUDE.md                     CHANGED  Rules: no Git mode / plan stages; § Work → Limen
  .gitignore                    CHANGED  + /.limen/
  spec/vision.md                NEW      (user-owned)
  spec/build.md                 NEW      board: TRACK standing models + prepare
  spec/features/_template/      NEW      (limen init)
  spec/features/done/YYYY-MM/FNNN-*/     MOVED  old tasks/done (ticket.md + plan.md + stages/)
  spec/features/active/FNNN-limen-transition/  MOVED
  spec/features/planned/FNNN-*/ MOVED    old tasks/planned (without s6b–s6f)
  spec/features/migration-map.tsv        NEW
  .agents/limen/styleguide.md   NEW
  .pi/extensions/limen.ts, .omp/extensions/limen.ts   NEW (hook stubs)
  scripts/limen-prepare.sh      NEW
  scripts/one-off/migrate-tasks.ts       NEW (delete in stage 3)
  tasks/README.md               CHANGED  one "old flow, S6 only" line
  tasks/active/s6-pre-sale.md, s6a-*   same (old flow)
  tasks/planned/s6b…s6f-*.md    same (old flow)
  .limen/                       NEW, gitignored (job records)
  docs/, notes/, code           links rewritten only
```

## Rollback of the whole stage

Revert the repo commits (1.4, 1.5–1.8, the 1.9 merge with `-m 1`), revert the `~/.pi/agent` commit of `AGENTS.md`, `npm unlink -g limen`, `sudo pacman -R herdr`. The old flow never stops working for S6, so nothing else depends on stage 1.

## Stage 2 and stage 3 (outline only; own plan session)

- **Stage 2 (after the user used stage 1):** adapt `plan-task` (ticket + `plan.md` in the feature folder, `Batch:` / `Track:` fields), a `limen-run` skill or none, `handoff` (task file → ticket folder), `reminders.md` (S5c findings, U1–U2), maybe overlays, the job-DB cleanup step. Input: the user's notes from real use.
- **Stage 3 (decide):** plain Limen vs adapted Limen. Then remove what is not used: `run-task`, `bg-agent.sh`, `~/.cache/ea-review/`, `tasks/README.md` and `tasks/` (after S6 is done and moved), `scripts/one-off/`, the `implementer` / `reviewer` / `planner` agent files if no repo uses them.

## Log

- 2026-11-12: 1.1 done: `~/ea-s3-test` and `~/.cache/ea-testmail/82cf…` worktrees removed, `email_assistant-wt` removed; `git worktree list` = main checkout only. 1.2 done: user installed `herdr` 0.9.1 (`herdr --version` → `herdr 0.9.1`; `herdr-app 0.1.13` unchanged); Limen cloned at `f1e3a54`, `npm link`, `limen --help` runs; `herdr integration install pi` → `~/.pi/agent/extensions/herdr-agent-state.ts`. 1.3 done: probe job without `--extension` FAILED (`Unknown provider "claude-bridge"`); with the bridge path DONE WITH OPEN CHECKS, commit `3fd536e Add hello.txt`, model `claude-bridge/claude-sonnet-5-5`. Jobs load `CLAUDE.md` and `~/.pi/agent/AGENTS.md` (marker `BLUE-17` and heading `## Harness` quoted without a read). So step 1.4 "Inside a Limen job" line is required, not optional. `LIMEN_CONTEXT_ROOT` = main checkout. Detail: `~/.pi/agent/notes/2026-11-04-limen.md` § "Install and probe 2026-11-12".
- 2026-11-12: 1.4 done. `~/.pi/agent/AGENTS.md` as planned (Work items, Session start, § Limen; Replies → ticket folder); `~/.pi/agent` commit `d964223`, pushed. Open item done by default: `~/.pi/agent/tasks/active/{short-replies,harness-sync}.md` → `~/.pi/agent/spec/features/active/F001-short-replies/`, `F002-harness-sync/` (`plan.md` + `ticket.md`, by first-add date); `.gitignore` allowlist + `!/spec/`; link in `notes/2026-11-06-harness-migration.md` rewritten. `CLAUDE.md` as planned; one extra: `## Notes` grep line now names `spec/features/`, `tasks/` (S6 only). Check: `grep -nE "never commit|Git mode|tasks/active|status line" CLAUDE.md ~/.pi/agent/AGENTS.md` → only `CLAUDE.md:26` (the S6 old-flow line).
- 2026-11-12: 1.5 done: `limen init` → `created` for the 11 files of the facts table, `ready .limen/jobs`; `.gitignore` + `/.limen/`. 1.7 done: TRACK has the 2 planned bullets; NEXT placeholder removed. Check: `limen status` → `Running (0)` … `Coordinator tabs: unknown (Herdr agent list unavailable…)` (no Herdr session in this shell); `limen board` prints the board, no error. 1.8 done: `scripts/limen-prepare.sh`. Changes from the plan: (a) Limen writes prepare output to the job log (`src/runtime/job-setup.ts` `runPrepare`), so the script never prints `.env` lines or DB URLs; (b) it drops the main `DATABASE_URL` / `MIGRATOR_DATABASE_URL` lines from the copied `.env` and appends the job ones, so no duplicate keys; (c) DB name = date + hash part of the job id (`2026-11-12-<label>-c87b722b` → `2026-11-12-c87b722b`), because a long label breaks the 63-byte Postgres limit; (d) it refuses to run in the main checkout. Check: `git worktree add --detach /tmp/ea-prep HEAD`, `LIMEN_JOB_ID=2026-11-12-prep-test-abcd1234 bash scripts/limen-prepare.sh` → exit 0, 0 `postgres://` strings in the output, `.env` mode 600 with the 2 URLs on `email_assistant_2026_11_12_abcd1234`, `node_modules` present; the `app` role connected to the job DB (`schema_migrations` exists, no grant for `app`); `bun run db:worktree 2026-11-12-abcd1234 --drop` → `dropped`; `git worktree remove` → only the main checkout. 1.6: drafts written (vision 25 lines, styleguide 39 lines), waiting for the user's OK.
- 2026-11-12: 1.6 done: the user accepted both drafts ("they should be fine for now. So I accept them"). Extra: `bun run lint` failed on the 2 Limen hook stubs (`.pi/extensions/limen.ts`, `.omp/extensions/limen.ts`, 32 prettier errors); the stubs stay as Limen writes them, `.pi/**` and `.omp/**` added to the eslint ignores and `.prettierignore`. Check: `bun run lint && bun run typecheck && bun run test:unit` → lint ok, typecheck ok, 1719 pass, 0 fail (`test:int` not run: no server code changed, GreenMail shared with the S6 session).
