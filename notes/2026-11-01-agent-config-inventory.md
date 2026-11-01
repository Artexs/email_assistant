# Agent config in other repos — inventory (2026-11-01)

Scanned `~/Documents/repos/{hotshots,mega}` for CLAUDE.md, AGENTS.md, `.claude/`, `.agents/`, skills, tasks, notes, docs.
Nothing was copied yet. The "Copy?" column is a recommendation for `email_assistant`.

## What email_assistant has now

- No `CLAUDE.md`, no `AGENTS.md`, no `.claude/`, no `tasks/`, no `notes/` (this file is the first).
- Old rules for other tools: `.cursor/rules/*.mdc` (8 files), `.windsurfrules` (template with `{{project-name}}` still in it),
  `.github/copilot-instructions.md`, `.ai/` (AGENT.md = adapter pattern + `log` util, prd, tech-stack, architecture, ddd, database).
- Stack: Astro 5 + React 19 + Tailwind 4 + shadcn frontend; Bun/TS `backend/` with Supabase, IMAP, OpenAI adapters.

## hotshots/Hotshots-appbackend (Bun/TS backend — closest match)

| Item | Content | Copy? |
|---|---|---|
| `CLAUDE.md` | Project summary, key conventions with links to rules, "commit to main only", Tasks workflow, "grep docs/known-alerts.md" | Yes, as a template (adapt text) |
| `.claude/rules/dates.md` | `toLocaleDateString("sv")`, never `toISOString()` (UTC off-by-one) | Yes, if dates in Europe/Warsaw matter (mail dates do) |
| `.claude/rules/logging.md` | Never `console.*`, use `log`; levels; `[Component]` prefix; Telegram sink on `log.error` | Yes, adapt: here the logger is `backend/src/utils/log.ts`, no Telegram |
| `.claude/rules/error-handling.md` | `return await`, log before throw, `AppError`, `unhandledRejection` | Yes |
| `.claude/rules/typescript.md` | `import type`, no `any`, no `const enum`/`namespace`, `noUncheckedIndexedAccess`, ESLint strict tip | Yes, check against this tsconfig |
| `.claude/rules/testing.md` | `bun test`, no `mock.module()`, use `spyOn`, `tests/setup.ts` preload | Yes, when backend tests exist |
| `.claude/commands/pre-commit-review.md` | `/pre-commit-review`: 4-phase review of staged diff, writes `.claude/reviews/<ts>.md` + `.claude/.last-review.md` | Yes (change "Hotshots" text and conventions list) |
| `.claude/hooks/review-gate.sh` + `.claude/settings.json` | PreToolUse hook: blocks `git commit` (>20 lines, code files) unless a CLEAN review matches the diff hash | Optional — it adds friction; needs `jq`, `sha256sum` |
| `.claude/reviews/`, `.last-review.md` | Old review outputs | No (generated) |
| `tasks/{active,done,planned}/README.md` | Task folder convention | Yes (structure only) |
| `docs/known-alerts.md` | Alert log | Create empty when first needed |

## hotshots/Hotshots-GAS (Google Apps Script)

| Item | Content | Copy? |
|---|---|---|
| `CLAUDE.md` + `CLAUDE_CONTEXT.md` | GAS `global` exports, `SecretEnvManager`, clasp deploy, code style (template literals, no `var`) | No — GAS-specific. Idea only: keep long architecture in a separate file and `@import` it from CLAUDE.md |
| `tasks/`, `docs/known-alerts.md` | Same conventions as appbackend | Already covered |

## hotshots/Hotshots-asterisk
Only `docs/` (prd, tech-stack, monitoring). No agent config. Nothing to copy.

## mega (course repo)

| Item | Content | Copy? |
|---|---|---|
| `CLAUDE.md` | Course workflow (lessons, debriefs), azyl server, home VM | No — course-specific |
| `.claude/skills/read/` | Rules: quote API contract before sending a body; cut-diff check when shortening text; check live page for "newest model" | Better as a global skill (`~/.claude/skills`), not per repo |
| `.claude/skills/vps-ssh/` | azyl dev server over SSH, public URL on port 53816 | Only if this app gets deployed to azyl; else no |
| `.claude/skills/mega-browser/` | hq.mega.dev via cmux browser | No |
| `s01e05/rig/AGENTS.md` + `CLAUDE.md` (`@AGENTS.md`) | Pattern: one `AGENTS.md` for all harnesses, `CLAUDE.md` only imports it; shared skills in `.agents/skills/` | Yes, the pattern — this repo already has 4 tools' rule files that drift |
| `s01e05/rig/.agents/skills/plan-to-issues/` | Split `plan.md` into issue files after human review | Optional, if you use plan → issues → workers |
| `notes/2026-10-31-parallel-workers.md` | How to run headless worker agents per issue in worktrees | Reference only |
| `notes/2026-10-30-skill-vs-saved-script.md` | Fixed repeated job → saved script that fails loud; judgment job → skill | Reference only (relevant to a mail-triage job) |

## Global (already apply to every repo, no copy needed)
- `~/.pi/agent/AGENTS.md`: reply style (STE, 5 lines), tasks/notes/alerts convention.
- Skills in `~/.claude/skills` and `~/.pi/agent/skills`: gh-tickets, handoff, skill-shaper, teach-me (`~/.claude/skills` also has `synced`).

## Proposed layout for email_assistant
```
AGENTS.md                 # one source: summary, stack, structure, conventions, tasks workflow, commit rule
CLAUDE.md                 # "@AGENTS.md" (+ Claude-only bits)
.claude/rules/            # dates, logging, error-handling, typescript, testing (adapted)
.claude/commands/pre-commit-review.md
.claude/settings.json + hooks/review-gate.sh   # optional
tasks/{active,planned,done}/
notes/  docs/known-alerts.md
```
Open decisions: keep or delete `.cursor/rules`, `.windsurfrules`, `.github/copilot-instructions.md` (merge their useful parts into AGENTS.md);
move `.ai/` docs to `docs/` or link them from AGENTS.md; "commit to main only" rule — yes or no; review-gate hook — yes or no.
