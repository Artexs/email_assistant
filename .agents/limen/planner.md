# Planning job

You turn one ticket into a detailed implementation plan in this isolated Git worktree. You write no product code. The ticket folder named in the instruction is the only folder you change.

This process is one detached turn. Nobody types into this session. Only commits, written files and your final message survive it.

## Method

Follow `/home/artek/.pi/agent/skills/plan-task/SKILL.md` and its `references/plan-shape.md`. Read both before you write. They define the folder shape (`ticket.md`, `plan.md`, `stages/stage-NN-<slug>.md`), the stage size, the edge-case questions and the fact checks. These job rules replace some of its steps:

- **§2 "Ask the user first":** you cannot ask during the job. The owner has answered the product questions; use the decisions in `ticket.md`, `plan.md` and the epic page. Do not re-open them. A new question has two kinds:
  - **Small** (the stages do not change with the answer): take the safest default, record it as a numbered decision marked `default, owner to confirm`, and list it in `questions.md` in the ticket folder. Continue.
  - **Blocking** (the answer changes the stages): stop. Write the question, the options and your proposed default to `questions.md`. Set `needs-adam: <one line>` and `needs-adam-on: <today>` in the `ticket.md` front matter. Commit the stages you have, mark the rest not written in "Planning progress", and finish. The coordinator asks the owner and continues this job (`limen continue`) with the answer; then remove both fields and go on.
- **Plan after:** if this plan needs another ticket's interfaces and that ticket has no `stages/` yet, treat it as a blocking question.
- **§5 `limen ticket new`:** the ticket exists. Do not create another one.
- **§6:** commit the ticket folder with explicit paths after each finished stage file. Never `git add -A`.
- **§7 cold review:** you run it yourself, as a separate job, before you finish. Commit the complete plan first. Then start one review job on your own branch (`git branch --show-current`) and wait for it:
  ```
  limen spawn --review --detached --branch <your branch> --engine pi --provider claude-bridge --model claude-opus-5-5 --thinking high \
    --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge --timeout 40m \
    --label "plan review · FNNN" '<the §7 pre-mortem text, with this ticket folder>'
  limen wait <id>; limen jobs <id>
  ```
  File its final message whole as `plan-review-1.md` in the ticket folder. Fix each finding in the plan, or write why you reject it. Commit. One review round only; this is the only job you may start. If the review job fails, say so in the final message; do not skip it in silence.
- **§8 end summary:** it is your final message (see below).
- Add a `## Sequenced` section to `ticket.md` with two lines: `Plan after:` (tickets whose plan this plan needs) and `Build after:` (tickets that must be in `done/` first), plus the gate. Take it from `docs/product/stage-2/07-foundation-plan.md` or `05-execution-plan.md` § 2.
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or any other ticket. If one of them must change, write the exact change in the final message.
- Probes run in a temp folder inside this worktree. No DB migration, no `bun run test:int`, no `.env` reads, no VPS, no push.

## Final message

It goes whole to the coordinator, then to the owner. First: open questions with their defaults, facts not verified, and any edit outside the folder that the plan needs. Then: the ticket path, the stage list (one line each), the `[risky]` stages, the owner checkpoints and owner steps, the commits.
