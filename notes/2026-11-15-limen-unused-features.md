# Limen features that the email_assistant harness does not use

> 2026-11-15. Audit only, read-only. No harness change was made. Limen checkout: `/home/artek/Documents/repos/limen` (master `ca4a70f`). Handoff: `~/.pi/agent/notes/2026-11-15-handoff-limen-unused-features.md`.

## Method and limits

- Sources read: `templates/agents.md` (coordinator manual), `docs/commands.md`, `docs/jobs.md`, `docs/seat/README.md`, `docs/herdr-status.md`, role templates `keeper.md`, `scout.md`, `quality.md`, `capability.md`, and `src/runtime/start-queue.ts`, `src/project/limits.ts`, `src/job/task-note.ts`.
- Usage evidence: the 587 job records in `.limen/jobs/` (role, state, log), `limen rule`, `limen queue`, `limen prune --retire --dry-run`, repo files, and the tool-call counts from the handoff ("Key data"). The handoff counts come from the session file; I did not recount them.
- I did not read `docs/groups.md`, `docs/picture.md`, `docs/finish-webhooks.md`, `docs/remote.md` or `docs/setup.md` in full. Rows that depend on them say so.

## Differences from the handoff

1. F961 (land check in `limen land`) and F958 are only **planned** tickets in Limen (`spec/features/planned/`). Not landed. Until F961 lands, the land check stays the manual step in seat rule `harness-2026-11-14` (2).
2. Planner scouts **have run**: 7 scout jobs exist (for example `f109-scout-1..4`). The handoff said "not yet seen in a real run".
3. `limen prune --retire --dry-run` lists **576 of 587** job records. `.limen/jobs` is 332 MB.
4. Three untracked notes sit in the repo (`notes/2026-11-14-f095-u1-facts.md`, `notes/2026-11-14-progress-overview.md`, `notes/decision-docs/`). They are not mine; I left them alone.
5. `/reload` in the coordinator pane: not confirmed. `herdr agent read w1:p1` shows no "compact" text.

## Role usage in the 587 job records

| Role | Jobs | Note |
| --- | --- | --- |
| worker (default) | about 360 | used |
| reviewer | 159 | used |
| planner | 58 | used |
| scout | 7 | used since 2026-11-15 |
| keeper, quality, judge, researcher | 0 | never used |

States: 543 done, 36 failed, 5 running, 3 stopped. No job hit the 900-call cap or the 90-minute timeout. Two jobs had `prepare failed: exit 2` (a failed command, not a timeout).

## Feature table

Fit: yes / no / try. "Evidence" shows how I decided "used or not".

| Feature (source) | What it does | Used? (evidence) | Fit | Gain | Risk | How to adopt |
| --- | --- | --- | --- | --- | --- | --- |
| Start gate settle (`docs/jobs.md` § Start queue; `~/.limen/start-gate.json`) | After each start, the next start waits `settle` (default 60 s). A job that waits makes a "started, no action needed" wake. | Default. File `~/.limen/start-gate.json` does not exist. 321 of 587 jobs logged `start queue: started after …`; the machine was 85 % idle, gate 25 %. | yes | Fewer idle wakes: about 10 % of coordinator tokens (handoff, 55 wakes in 10 h). Jobs also start sooner. | The file is seat-wide. Other plants share it. Bursts of `bun install` raise load. | Write `{ "settle": "10s" }`. Watch `limen queue` for a week. Also file a Limen ticket: skip `start-notice` when the wait is under about 2 min (`start-queue.ts` `started()` writes it for every job that waited; no setting exists). |
| `limen prune --retire` (`docs/commands.md` § Land and clean up) | Deletes records of done, failed or stopped jobs whose branch landed or went away. | Not run. 576 records would go; 332 MB. | yes | Shorter `limen jobs --all` and `status`; less disk. | Deletes the job `result` (the reviewer verdict) and the session. Reviews are not filed (see next row). | First file or drop the reviews that matter, then `limen prune --retire --dry-run`, then run it. Optional: the `limen-prune` systemd timer in `docs/seat/`. |
| Filing reviews as `review-<n>.md` (manual step 6) | The coordinator saves each verdict in the feature folder. | Mostly not. 159 reviewer jobs, 27 `review-*.md` files in the repo (23 in `done/`, 4 elsewhere). | try | Review history survives `prune --retire`; later agents read it. | Coordinator tokens per review (small). | Add one line to TRACK: "file `review-<n>.md` in the same commit as the verdict action". Or ask Limen for `limen land` to file the final review. The keeper does not do this. |
| Priority budget (`limen rule set … --start-priority`, `spawn --priority`) (`docs/jobs.md`) | While a rule holds, only detached jobs at priority N or more urgent start. | Rules used (4 `rule set`), but never `--start-priority` or `--priority`. | try | Stops quota bursts from many Opus jobs when the Claude week is low. | A person must read the budget; Limen does not. A held job waits, so a stage can slip. | When the budget is low: `limen rule set claude-week --until <reset> --start-priority 1 "…"`. Give review and plan jobs priority 1 or 3 on purpose. Needs a TRACK line that says which jobs get which priority. |
| Land check in `limen land` (Limen F961) | `limen land` tests the merged code before it lands. | Planned ticket only. The project does it by seat rule (merge master, typecheck, unit tests). | yes, later | Removes the rule and one coordinator step per land (320 lands). | None for us. | Ask the Limen author to schedule F961. After it lands, end rule `harness-2026-11-14` item (2). |
| Quality pass (`--role quality`, `templates/quality.md`) | One detached job reads landed work against the vision and the styleguide. It writes `spec/quality/YYYY-MM.md` with drop-candidates and small tickets. | Never run; `spec/quality/` does not exist. The manual asks for one after every ten proven landings. 72 tickets are in `done/`. | try | Finds dead code and doubled decisions. Fits the owner's "subtraction" aim. | Overlap with F125 (test audit). One Sonnet job of cost. | One run: `limen spawn --role quality --detached --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking medium …`. Name the stretch in the task. Turn findings into tickets; do not auto-land. |
| Spec keeper (`limen keeper`, `templates/keeper.md`) | A short job fixes ticket front matter, board lines and map links on the candidate branch before land. | Never run (0 jobs). `ticket check` ran 10 times; `board` 9. | no for now | Would help only if land checks refuse often. | One more job per land. | Re-check if `limen land` refuses a ticket or the board drifts again. The coordinator handles it by hand now. |
| Groups (`limen group start`, `docs/groups.md`, not read in full) | Several models on one task: draft, critique, revise, final. Limen runs the rounds. | Never run. Planner role plus a cold review does the same job at lower cost. | try (one case) | A second view on high-risk plans (migration, money, deploy). | Several Opus-class agents at once; heavy quota. | Try once on the next `[risky]` plan, not on every plan. Start it from the coordinator pane only. |
| Researcher and judge roles (manual § Research) | Two researchers and one judge answer a question with reports. | Never run. | no | Owner questions that need two opinions. | Spend that the owner must approve. | Use on request only. |
| Project `reminders.md` (`src/job/task-note.ts`) | Text copied into every job's note as binding reminders. | No file. The guard-removal check lives in TRACK text and in each task. | try | One place for rules that every worker and reviewer must follow; fewer words in each task. | It goes to all roles (reviewers too), and every job. Keep it under about 10 lines. | Create `.agents/limen/reminders.md` with the guard-removal check and the quality rules that now repeat in tasks. |
| Project `limits.json` (`src/project/limits.ts`) | Raises the prepare limit (5 min) and stalled-tool limit (3 min). | No file. | no | None now. | None. | Add only if jobs show `prepare failed: timed out` or a stalled-tool stop. Today: 0 timeouts. |
| `limen picture` (map, watch, serve, tick) | Local architecture map from the spec and code, refreshed by a hook. | Not built. `picture watch` is off. | no | We have `docs/architecture.md`, ADRs and capabilities. | A model call on each top-branch move. | Skip. |
| `limen sweep` and seat bell (`docs/seat/`: Moshi, ntfy, prune timer) | Notifies the owner when a job needs them; removes finished worktrees. | `.limen/last-sweep` exists; no `limen*` systemd timer. Not verified whether the owner uses phone alerts. | ask | The owner gets a ping at gate G1 stops and failed jobs, so they need not watch the pane. | Setup work. | Ask the owner if they want phone alerts. Setup is in `docs/seat/README.md`. |
| Finish webhooks (`limen webhook`, `docs/finish-webhooks.md`, not read) | HTTP ping on job finish and plant events. | Not used. | no | Only with an outside receiver. | Credentials. | Skip. |
| `limen linear`, `limen github …` (doorbell), Devin engine | Linear mirror; GitHub `@limen` requests; cloud sessions. | Not used. | no | None for a solo owner. | Credentials, outside authority. | Skip. |
| `limen highlight`, `ticket-author`, `ticket series`, `workspace init`, `planning private`, `--repo` | Display mark; author lookup; shared F numbers; multi-repo parent; private planning. | Not used. | no | Single repo, one plant, committed planning. | None. | Skip. |
| `limen watch`/`unwatch`, `open`, `close`, `diff` | Take over a job; focus a tab; close tabs; visual diff. | Not used by the coordinator. `close FNNN` may help to clear leftover tabs. | try | Tab clutter after features close. | Closes tabs: make sure no job runs. | Run `limen close FNNN` after a feature moves to `done/`. |
| Scout role | One read-only question, evidence packet. | Used (planner starts 2–4). 7 jobs. | used | — | The manual bans scouts before a review of record; `planner.md` does not use them there. | Keep. |
| `--task-file`, `continue`, `steer`, `--keep-open`, `--review` | Standard controls. | Used (counts in the handoff). | used | — | — | Keep. |

## Ranked top 5 for the owner to approve

1. **Lower the start settle and stop idle start wakes.** Write `~/.limen/start-gate.json` with `{ "settle": "10s" }` (seat-wide, one file, easy to undo). File a Limen ticket for "no start notice when the wait is short". Expected gain: about 10 % of coordinator tokens, faster stage starts. Evidence: 321 of 587 jobs waited; the machine was 85 % idle.
2. **File the reviews that matter, then run `limen prune --retire`.** 576 records, 332 MB, a long `limen jobs --all`. Add a TRACK line so each review verdict goes into `review-<n>.md`. Do this in this order: retire deletes the verdicts.
3. **Create `.agents/limen/reminders.md`.** Put the guard-removal check and other repeated task lines there. Cost: one small file. Less text in every spawn task. Check the effect on the next five jobs.
4. **Run one quality pass.** One Sonnet job, a findings file in `spec/quality/`. After 72 landed tickets, this is the cheapest way to find dead code. Run it before or beside F125 and tell the quality job to skip tests.
5. **Prepare the priority budget rule.** Add a TRACK line now that says which jobs run at priority 1 and 3. Then, when the Claude week budget is low, one `limen rule set claude-week --start-priority 1` command limits bursts without stopping any coordinator.

Not in the top 5 but worth a Limen request: F961 (land check in `limen land`).

## Questions for the owner

- Approve items 1–5? Default: item 1 and 2 now, 3–5 as proposals.
- Do you want phone alerts (Moshi or ntfy) for stops and failures?
- Did you type `/reload` in the coordinator pane (needed for the compaction extension)?
- The rule "plan a ticket only when its build can start within about one day" (harness review §5.2) is still open.
