# F138 stage 05 — Current docs

Part of [`../plan.md`](../plan.md). Needs stages 03 and 04 landed.

Runs after stage 04 (B2): `capability-map.test.ts` fails on "ADR 0037" in a page until the ADR file exists. This stage owns the current docs outside `docs/decisions/`, `docs/legal/` and `docs/product/`, plus `README.md` and `CLAUDE.md`. Link to the ADR by the number that stage 04 used. If stage 04 took another number than 0037, fix it here also in `JUDGE_SAME_MODEL` and `evals/README.md` (N7).

## Step 1 — What the system does now

- **Goal:** a reader of the current docs learns that the system calls only OpenAI, and how the judge is chosen.
- **Files and decisions:**
  - `docs/architecture.md` §6.3 and the other current lines (the diagram, the LLM row, the `llm:check` provider list, the dependency list): one provider `openai` behind the registry; the keys of `.env.example`; the judge rule (ADR 0037). Dated eval results in §6.3 stay, under a line "History (before ADR 0037)".
  - `docs/capabilities/triage.md` and `open-loops.md`: the current rules name only OpenAI. The rule that lists ADRs may keep "0007, 0015" with "(superseded / amended by 0037)".
  - `docs/capabilities/measurement.md` or `live-lab.md`, wherever the judge or eval roles are described: add the judge rule and the default judge model. If neither describes the judge, add one line to the page that holds the eval gate.
  - `docs/modules.md`, `docs/code-patterns.md`: remove the `@google/genai` lines; the `openai` confinement rule stays.
  - `docs/own-model.md`: remove the sentence about a role set to `gemini`.
  - `docs/roadmap.md` § LLM: current text names OpenAI only; the S1b state line of 2026-11-05 is history and stays.
  - `docs/known-alerts.md`: alert entries are history; keep their alert text and dates. Change only the "Fix" or "Check" instructions that tell a reader to check a `GEMINI_*` key or run `gemini:test`: they say "since ADR 0037 no Gemini path exists" and point to the OpenAI keys and `bun run llm:check`.
  - `README.md`: "AI: OpenAI"; remove the `gemini:test` line.
  - `CLAUDE.md` (project): the target stack names OpenAI, not Gemini.
  - `docs/diagrams/architecture-2026-11.{md,html}`: a dated snapshot; leave it (allowed hit).
- **Test:** none (docs). Every link you add resolves (`ls` the target).

## Step 2 — Allowed hits of the acceptance grep

- **Goal:** the files of this stage hold only allowed hits. The list below is the one definition; stage 06 runs the full grep against it after stages 03–05 landed.
- **Command (this stage):** `git grep -niE "gemini|@google/genai|generativelanguage" -- docs README.md CLAUDE.md ':!docs/decisions' ':!docs/legal' ':!docs/product' ':!docs/product-brief.md'`.

### Allowed hits

The ticket grep (`git grep -niE "gemini|@google/genai|generativelanguage" -- apps packages docs evals deploy .env.example package.json bun.lock`) may find only:

1. `docs/decisions/0007-*`, `0012-*`, `0013-*`, `0015-*`, `0035-*` (old text), `0037-*`, and `docs/decisions/README.md` rows.
2. `evals/results/**` (old result files) and lines of `evals/README.md` that name an old result file.
3. `docs/product/**` and `docs/product-brief.md`: dated owner text and the "Changed by ADR 0037" lines.
4. `docs/known-alerts.md`: dated alert text (not an instruction).
5. `docs/architecture.md`: lines under "History (before ADR 0037)".
6. `docs/roadmap.md`: dated state lines.
7. `docs/diagrams/architecture-2026-11.*`.
8. `docs/legal/claims.md` rows whose claim starts `Removed by ADR 0037` (B1).
9. `CHANGELOG.md` is outside the grep paths; do not edit old entries.

Any other hit in a file of this stage is fixed here. Save the output of the command of this stage to `/tmp/f138-s05/grep.log` and give the count of hits per allowed group.

## Check

`bun test apps/server/src/capability-map.test.ts apps/server/src/own-model-docs.test.ts` and `bun run lint`.

## Done when

- The grep of this stage shows only allowed hits 4–7 (the log and the per-group count in the final message).
- The Proof (`sNN` = `s05`) prints `PROOF_OK`.

## Out of scope

`docs/decisions/`, `docs/legal/`, `docs/product/` (stage 04); code (stages 02, 03); `notes/`, `spec/`, `tasks/`, `.ai/` (history, outside the acceptance grep).
