> **Status 2026-11-02 — in progress.** Left: discuss the open questions with the user; create the subagent files; test each one once; write the slice loop into `tasks/README.md`.

# Subagents for the slice loop (plan → build → review)

Scope: how S0–S6 get implemented. Needs: —. Handoff: `~/.pi/agent/notes/2026-11-02-handoff-subagents.md`.

## Goal
Three Claude Code subagents run the build and review steps of each slice, so the user does not open a new session per step.
The main session (strong model) stays the orchestrator and planner, because only it can ask the user questions.

## Done when
- `.claude/agents/implementer.md`, `.claude/agents/implementer-strong.md`, `.claude/agents/reviewer.md` exist and the user agreed to their text.
- Each subagent ran once on a small real job, with the result in the log (for example: the reviewer on commit `29e9522`).
- `tasks/README.md` has a section "How to run a slice" with the loop, the human gates and the `[risky]` step marker.

## The loop (agreed in principle by the user, 2026-11-02)
1. Main session (strong model) moves the slice file to `active/` and writes the file-level plan: small steps, each with files, test and check command. Risky steps get the marker `[risky]`. **The user approves the plan.**
2. For each step: the main session calls `implementer` (or `implementer-strong` for `[risky]` steps) with only the task file path and the step number.
3. `reviewer` gets only the task file path and the commit range. It reads the diff itself. Findings go back to an implementer.
4. **The user tries the result.** The main session closes the task and writes a handoff for the next slice.

Risky areas (strong model writes the code): IMAP sync and dedup (S1a), prompt and eval (S1b), committer and exactly-once (S3), approval, send and injection guards (S4).

## Proposal (to discuss, not final)

| File | `model` | `tools` | Job |
|---|---|---|---|
| `implementer.md` | `sonnet` | Read, Edit, Write, Bash, Grep, Glob | Build one normal plan step: code, tests, run checks, review `git diff --staged`, commit, one log line |
| `implementer-strong.md` | `opus` | same | Same job, for `[risky]` steps |
| `reviewer.md` | `opus` | Read, Grep, Glob, Bash; `disallowedTools: Edit, Write` | Read the diff of a commit range; check plan step, done-when, `docs/code-patterns.md`, `docs/architecture.md` rules (§4.1 rules 5–7, §4.3 policy, tenant filter), security; run tests; return verdict + findings (severity, file:line, fix) |

Body rules for both implementers (draft): read `docs/code-patterns.md` and the task file first; do only the given step;
stop and report when the step is unclear (do not guess); return files changed, test command + output, commit hash, open points.

## Open questions (for the user)
1. Three files, or two (`implementer` + `reviewer`) with a per-call model override (`model: opus`) for `[risky]` steps? The override exists, but the main session can forget it.
2. Model ids: aliases (`sonnet`, `opus`: always the newest) or pinned ids (`claude-sonnet-5-5`, `claude-opus-5-5`)?
3. Push policy: `CLAUDE.md` says commit and push all work to `master`. Does the implementer push at once, or does the main session push after the review passes?
4. Nesting: subagents can start their own subagents (up to 3 levels by default). Turn it off with `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`?
5. Permission mode: the subagent inherits `acceptEdits` / `bypassPermissions` / auto from the main session. Which mode does the user run?
6. Reviewer: `disallowedTools: Edit, Write` still leaves Bash, which can write files. Is a prompt rule enough, or add a hook?
7. Harness: these files work in Claude Code. The user also uses pi (`~/.pi/agent`). Does the user run the slices in Claude Code? [pi subagent support not verified]

## Review of the proposal (second agent, 2026-11-02; not agreed yet)
Sources: Claude Code docs (link below); MEGA course `~/Documents/repos/mega`: lessons s01e02 "Subagents and Workers", s01e04 "Multi-agent";
examples `fork-or-fresh-subagent`, `worker-result-handoff`, `pr-review-rules`, `self-verification`, `effort-routing`, `worktree-isolation`.
- Keep the main session as planner + orchestrator. Correct: only it can ask the user, and the plan needs approval.
- The plan file is the only brief. A fresh subagent knows only its prompt (`fork-or-fresh-subagent`: task-only subagent kept 0–1 of 4 earlier decisions).
  So each step must hold: goal, files, interfaces, decisions from the chat, test to write, check command, done-when, out of scope.
- Fixed report shape for the implementer (files, check command + output, commit hash, deviations, open points). `worker-result-handoff`: a filed report beats reading the screen.
- Reviewer gets rules + plan + touched files, not the diff only (`pr-review-rules`). It runs the check commands itself and does not trust the implementer's output (`self-verification`: green tests are not proof).
- Review cost: review each `[risky]` step at once; review normal steps together at the end of the slice (one commit range). Max 2 fix rounds, then the user decides.
- Fix round: send findings back to the same implementer (`SendMessage` resumes it with its history), not a new one.
- Nesting: a `tools` allowlist without `Agent` already blocks nesting for that subagent. No env var needed.
- Reviewer read-only: add a subagent-scoped `PreToolUse` hook on Bash that blocks `git commit|push|reset|checkout|rm` and `>` redirects (exit 2). A prompt rule alone is weak.
- Permissions: no `defaultMode` in `~/.claude/settings.json` and no `.claude/settings.json` in the repo (checked). Add a project allowlist (`bun test`, typecheck, `git add|commit|diff|status|log`) so subagents do not stop on prompts.
- Optional: a skill `run-slice` holds the orchestrator procedure, so a session starts with one command. The loop text stays in `tasks/README.md`.
- Not now: background workers / worktrees (course s01e04, Limen + Herdr). Builds run one at a time on `master`, so foreground subagents are enough.
- pi: `~/.pi/agent/extensions/` has only `handoff.ts` and `web-privacy-guard.ts`. No subagent support in pi now (checked); run slices in Claude Code.

## Facts: pi (checked 2026-11-02, pi 1.4.0)
- Subagents in pi are an example extension, not built in: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent/` (README, `index.ts`, `agents.ts`, sample `planner`/`reviewer`/`scout`/`worker`, prompts `/implement`, `/implement-and-review`). Not installed now (`~/.pi/agent/extensions/` has only `handoff.ts`, `web-privacy-guard.ts`).
- Install: copy `index.ts` + `agents.ts` to `~/.pi/agent/extensions/subagent/`; agents in `~/.pi/agent/agents/*.md` (default) or `.pi/agents/*.md` (only with `agentScope: "both"` + a confirm prompt).
- Agent fields: only `name`, `description`, `tools` (pi names: `read, edit, write, bash, grep, find, ls`), `model` (e.g. `claude-bridge/claude-sonnet-5-5`). No `effort`/thinking field, no per-call model or thinking, no hooks, no `maxTurns`.
- Each call runs `pi --mode json -p --no-session` as a new process: no resume. A fix round is a new call with the findings.
- Thinking: when `model` is set, the extension passes no `--thinking`; pi then uses `modelThinkingLevels` from `~/.pi/agent/settings.json` (now: opus medium, sonnet medium). Small patch needed for a per-agent `thinking` field.
- pi asks no permission for tool calls (docs/security.md). Read-only reviewer / no-commit implementer = prompt rule + the main session checks `git status` and `git log` after each call.
- The child process loads the user extensions and packages, so `web-privacy-guard.ts` and `pi-web-access` (`web_search`, `fetch_content`) work there. A `tools` list without `subagent` blocks nesting.
- pi reads `CLAUDE.md` as a context file, so repo rules apply. Skills: `~/.pi/agent/skills`, `~/.agents/skills`, `.agents/skills`.

## Facts (Claude Code docs, checked 2026-11-02, https://code.claude.com/docs/en/sub-agents)
- Files: `.claude/agents/*.md` (project, commit them) or `~/.claude/agents/` (all projects). Markdown with YAML frontmatter; the body is the system prompt.
- Required fields: `name`, `description`. Useful: `tools`, `disallowedTools`, `model` (`sonnet`, `opus`, `haiku`, `fable`, a full id, or `inherit`), `permissionMode`, `maxTurns`, `effort`, `color`, `skills`.
- A subagent starts with a fresh context: its system prompt, the task message, CLAUDE.md files, a git status snapshot. It returns only a summary.
- A subagent cannot ask the user questions (`AskUserQuestion` is removed). Permission prompts pass through to the user.
- Call one explicitly with `@agent-<name>` or by name in the prompt. `/agents` now only prints where the files live.
- Model order: per-call `model` (aliases only) > frontmatter `model` > `CLAUDE_CODE_SUBAGENT_MODEL` > main model. `effort`: `low`–`max`. `maxTurns` stops a runaway subagent.
- Per-call `effort` exists too (needs v2.1.292+; installed: 2.1.312, checked 2026-11-02). `CLAUDE_CODE_EFFORT_LEVEL` overrides both: do not set it. Per-call `model` and `effort` stay on resume.
- Discussed 2026-11-02 (not agreed yet): drop `implementer-strong`; three agents `planner`, `implementer`, `reviewer`; risky steps = `implementer` with per-call `model: opus`, `effort: high`; subagents never commit; the main session makes one commit per reviewed stage and pushes it.
- Subagent-scoped `hooks` in frontmatter run only while that subagent runs. `memory: project` gives a subagent its own `MEMORY.md` across sessions.
- `isolation: worktree` runs a subagent in a temporary git worktree. Do not use it: `CLAUDE.md` forbids other branches.

## Log
- 2026-11-02: Created from the MVP review chat. The user asked for three subagents and a handoff to discuss them with another agent.
- 2026-11-02: Second agent checked the handoff claims (all true), read the course material, added "Review of the proposal". No agent files yet.
- 2026-11-02: The user runs slices in pi, not Claude Code. Checked the pi subagent extension; facts in "Facts: pi". Planner web search: discussed.
