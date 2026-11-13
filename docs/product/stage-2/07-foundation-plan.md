# Stage 2 foundation plan: the tickets that run before the feature epics

> Written 2026-11-13 from `06-architecture-review.md` §6. Eight Limen tickets in `spec/features/planned/`, each with a `ticket.md` (the contract) and a `plan.md` (the design input for `plan-task` or for one worker job). Diagram: `docs/diagrams/architecture-2026-11.html` § 05. Nothing here is started yet.

## 1. The tickets, in order

| # | Ticket | Stages | What it unblocks | Needs |
| --- | --- | --- | --- | --- |
| 1 | `F093-ci-green` | 2 | everything: a red CI hides regressions | — |
| 2 | `F086-module-borders` | 4 | every new module; the standards in the styleguide | F093 |
| 3 | `F087-feature-flags` | 4 | E3a, E4-A, E5a, E6a (PD-045); the operator routes of E7 | F086 (migration: alone) |
| 4 | `F088-notices-as-facts` | 5 | E4-B mail channel, E7 Polish texts, E8b alerts, E9b push | F086 (migration: alone) |
| 5 | `F089-structured-logs` | 3 | every epic writes event logs from its first stage; E8a converts the rest | F086 |
| 6 | `F090-llm-roles` | 3 | E2a judge, E3b escalation, E5b extractor, E6a drafter | F086 |
| 7 | `F091-repo-split` | 4 | E4-A, E5b, E6a touch `actions/repo.ts`; the "add an action type" checklist | F088, F090 |
| 8 | `F092-rls-safety-net` | 3 | optional; the E10 isolation claim; the new-table checklist | F087; **the owner's yes** |

About 28 stages. With the standing models (`spec/build.md` § TRACK) and two lanes, about one week.

Overlap with the epic ticket order of `05-execution-plan.md` §2 (so nothing is planned twice):

- F087 is the first slice of **E7-T2 Platform controls**: E7-T2 keeps send limits, the console page and the security log, and builds them on `isFeatureOn` and `requireOperator`.
- F089 is the first stage of **E8a Logs**: E8a keeps the module-by-module conversion, the canary test and the lint in error mode.
- F088 gives **E7-T1 Polish UI** the `locale` column and the renderer registry; E7-T1 adds the `pl` texts.
- F086 carries the standards that every `plan-task` session reads; it changes no epic scope.

## 2. Parallel rules

- F093 first and alone: the next tickets must land on a green CI.
- F086 next and alone: it changes the lint that every later job runs.
- Then two lanes: lane A `F087 → F092 (if yes)`; lane B `F088 → F091`. F089 and F090 fit into either lane between the migrations.
- Migrations (F087 stage 1, F088 stage 1, F092 stage 1) never run at the same time, and not next to a `bun.lock` change (F086 stage 2 if it adds a plugin). `CLAUDE.md` rules hold: one `test:int` at a time, one migration at a time.
- F087, F089 and F090 all edit `platform/config.ts`: serialize those stages (the plan files name them).
- E1 (docs, runs) may run at any time next to this group. E2a, E3a and E5a may start after F087. E4-A, E5b and E6a start after F091.

## 3. How to run one ticket

1. `plan-task` on the ticket folder: it reads `plan.md`, checks the facts, writes `stages/` (the owner approves). For F093 and F089 the owner may skip `plan-task` and spawn one worker with `plan.md` as the task: both are small and their design is fixed.
2. Move the folder to `spec/features/active/`, update `spec/build.md` NEXT and NOW (the coordinator does it).
3. Spawn, review, land per stage (`limen spawn … --prepare 'bash scripts/limen-prepare.sh'`, `limen land --keep-open`), as F082 does.
4. The last stage of each ticket updates `docs/code-patterns.md` and `.agents/limen/styleguide.md` with its standard, so the rules grow with the seams and never name a function that does not exist.

## 4. What the owner decides

1. Start the group now, before E4-A, E5b and E6a planning. [recommended: yes]
2. F092 RLS: yes or no. [recommended: yes]
3. F093 and F089 without a `plan-task` session. [recommended: yes]

## 5. Standards: where they live

- `docs/code-patterns.md` is the full rule set; `.agents/limen/styleguide.md` is the short form that Limen injects into every coordinator, worker and reviewer turn (cap 1000 lines, 45 used). Planning sessions (`plan-task`) read both. This is the right place: a model infers positive conventions from code well, but not the negative rules (what never to do), the cross-cutting ones (every new table joins four tests) or the reasons; and a worker reads a few files, not the repository.
- Each foundation ticket adds its own standard in its last stage (§3 step 4). F086 adds the ones that need no new seam: linted borders and the layer list, file size, registries over if-chains, comments without bare codes, the new-table checklist, CLIs call a service, the flaky-test rule (with F093).
- Lint before prose where possible: borders (F086), log shape (F089), SDK imports (exists), literal strings in the web (exists). A rule that a lint can hold does not need a reader to remember it.
