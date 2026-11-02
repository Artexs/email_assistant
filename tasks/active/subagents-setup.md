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

## Facts (Claude Code docs, checked 2026-11-02, https://code.claude.com/docs/en/sub-agents)
- Files: `.claude/agents/*.md` (project, commit them) or `~/.claude/agents/` (all projects). Markdown with YAML frontmatter; the body is the system prompt.
- Required fields: `name`, `description`. Useful: `tools`, `disallowedTools`, `model` (`sonnet`, `opus`, `haiku`, `fable`, a full id, or `inherit`), `permissionMode`, `maxTurns`, `effort`, `color`, `skills`.
- A subagent starts with a fresh context: its system prompt, the task message, CLAUDE.md files, a git status snapshot. It returns only a summary.
- A subagent cannot ask the user questions (`AskUserQuestion` is removed). Permission prompts pass through to the user.
- Call one explicitly with `@agent-<name>` or by name in the prompt. `/agents` now only prints where the files live.
- `isolation: worktree` runs a subagent in a temporary git worktree. Do not use it: `CLAUDE.md` forbids other branches.

## Log
- 2026-11-02: Created from the MVP review chat. The user asked for three subagents and a handoff to discuss them with another agent.
