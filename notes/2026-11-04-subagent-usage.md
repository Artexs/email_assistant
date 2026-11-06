# Subagent and session token usage (2026-11-04)

Source: pi session files in `~/.pi/agent/sessions/--Users-artek-Documents-repos-email_assistant--/`.
Subagents run with `--no-session`, but the parent session keeps each run's usage in the `subagent` tool result (`details.results[].usage`).
Cost fields are 0 (claude-bridge, subscription), so tokens are the measure. Context re-read (cacheRead) is the biggest number.

Scripts:
- `python3 -I ~/.pi/agent/scripts/subagent-usage.py <session-dir>`: per agent+model totals and the last 40 runs.
- `python3 -I ~/.pi/agent/scripts/session-usage.py <session-dir>`: main-session totals (sessions with >3M cacheRead).

## Totals, subagents (runs, turns, output, cacheRead, cacheWrite)
| agent | model:thinking | runs | turns | output | cacheRead |
|---|---|---|---|---|---|
| implementer | opus:high | 18 | 321 | 254k | 14.0M |
| planner | opus:xhigh | 2 | 88 | 271k | 10.7M |
| reviewer | opus:high | 29 | 299 | 257k | 9.4M |
| reviewer | opus:xhigh | 3 | 82 | 117k | 8.5M |
| implementer | sonnet:medium | 31 | 220 | 130k | 4.3M |
| planner | opus:medium | 5 | 77 | 228k | 4.2M |
| planner | opus:high | 1 | 31 | 64k | 3.0M |

## Main sessions (orchestrator, opus): about 77M cacheRead in 7 big sessions
Largest: 2026-11-02T00-19 session, 109 turns, 25.6M cacheRead, peak context 373k tokens.
Each turn re-reads the full context, so a long main session costs more than all subagents together.

## Findings
1. Main session is the largest consumer (~77M vs ~54M for all subagents). Peak contexts 140k–373k.
2. Planning S1b cost more than all S1b building so far: planner xhigh 2.8M + 7.9M, plan reviews 2.2M + 7.4M (xhigh).
3. Opus:high implementer runs on S1a: 0.5M–3.3M cacheRead each, 17–46 turns. Sonnet:medium runs: 30k–680k, 3–20 turns.
4. Reviewer costs 2–5x the implementer on small S1b stages (impl 172k → review 452k; review 660k). It runs on opus at xhigh,
   but `reviewer.md` says `high`: the main session overrides it per call.
5. Fixed read cost per run: reviewer/implementer read CLAUDE.md, code-patterns.md and often docs/architecture.md (41 KB ≈ 10k tokens), re-read every turn.

## Options to cut cost with the same output (not applied yet; user decides)
- A. Main session: start a fresh session per stage (handoff file), do not run a whole slice in one chat. Biggest gain.
- B. Reviewer: sonnet:medium for normal stages, opus:high only for `[risky]`. Main session must not raise to xhigh.
- C. Review per group of small stages (for example 3 tiny stages together), not per stage.
- D. Planner: medium, one plan review, not two at xhigh.
- E. Reviewer/implementer: read only the doc sections the stage file links, not whole docs.
- F. Prompt: tell agents to read files once, batch checks into one bash call (fewer turns = less re-read).

## How to verify "same code, lower cost"
Replay: take a done stage (base commit X, stage file S). In a `git worktree` at X, run the cheaper config on S.
Compare: tests pass, reviewer (strong) verdict, diff size vs the real commit, and tokens from the scripts above.
Do 3–5 stages per config before switching the default.

## Correction and per-session breakdown (later on 2026-11-04)
Raw cacheRead made the main session look biggest. Weighted (cacheRead 0.1, cacheWrite 1.25, output 5, Sonnet 0.6 of Opus): main 18.2M, subagents 16.6M.
Per session (`python3 -I ~/.pi/agent/scripts/session-breakdown.py <session-dir>`):
| session | job | main | subagents | turns | avg ctx |
|---|---|---|---|---|---|
| 11-02T00-19 | MVP plan review (discussion, web research) | 6.0M | 1.4M | 109 | 253k |
| 11-03T23-49 | S1b planning | 2.5M | 6.0M | 97 | 123k |
| 11-03T09-34 | S1a build (48 subagent calls) | 2.2M | 6.5M | 142 | 93k |
| 11-01T22-21 | repo tour | 1.7M | 0 | 58 | 166k |
| 11-03T21-30 | project explanation | 1.4M | 0 | 106 | 82k |
| 11-04T15-29 | S1b build, stages 0–2 | 0.3M | 0.9M | 35 | 55k |
- Build sessions: subagents cost about 3x the main session. The big main costs are planning and discussion sessions.
- Cause: every turn re-sends the whole context. 109 turns x 253k avg = 27M re-read tokens. Big tool outputs (bash, fetch) stay in context. No compaction ran.
- Reviewer decision applied: Sonnet high per stage, Opus high for critical stages + group reviews (see run-slice skill, reviewer.md, s1b task file).
