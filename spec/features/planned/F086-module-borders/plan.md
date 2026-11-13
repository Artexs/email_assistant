# F086 · Module borders: plan

> **Status 2026-11-13 — planned.** Five stages written; cold review in § "Cold review". Builds after F093 (CI green), alone. Ticket: [ticket.md](ticket.md). Open defaults: [questions.md](questions.md).

## Input

Source: the architecture review (`docs/product/stage-2/06-architecture-review.md` §3.2, §3.13, §3.14, §7), owner decision 5 of its §8 ("Adopt the twelve standards of §7 into `docs/code-patterns.md` and the styleguide in the P1 ticket. [recommended: yes]"), and the foundation plan (`docs/product/stage-2/07-foundation-plan.md` §2: "F086 next and alone: it changes the lint that every later job runs."). The owner answered the product questions before this planning job; the job does not reopen them.

### Design decisions of the ticket author (2026-11-13, kept word for word)

- **D1 Layers as data.** One file `apps/server/src/modules/layers.ts` (or a JSON next to `eslint.config.js`) lists the layers, lowest first: `platform` → `audit`, `tenancy` → `config`, `mail` → `triage`, `actions`, `delegation` → `reports`, `channels` → the composition roots (`main.ts`, `web.ts`, `composition.ts`, `retention.ts`, `scripts/`). `testmail` sits beside `channels` (it is a tool; a later ticket moves it to `tools/`). A module imports only `index.ts` of a module in a lower layer or in its own layer when the allowed-edge list names the pair (`triage → actions`, `triage → delegation`, `delegation → actions`).
- **D2 Lint with what is installed.** `import/no-restricted-paths` zones from the layer list (generated into the ESLint config by a small function, so the list lives once) plus a `no-restricted-imports` pattern `../*/!(index)` for deep imports, plus `import/no-cycle` with `maxDepth` at the module level. If the plan-task session finds the zone list too clumsy, `eslint-plugin-boundaries` is the alternative; it is one dependency and one `bun.lock` change (serialize with other jobs).
- **D3 Fix the type edge by moving the shape.** `ExpireFilter` moves to `packages/core/src/triage/` (it names `MailboxActionType`, which is already in core). `actions` re-exports it for its callers.
- **D4 Fix the deep import by inversion.** `actions` must not know how a delegation is open. The retention clear of payloads (`clearActionPayloads`) takes a predicate parameter `keepPayloadWhere: Expression<SqlBool> | null` from the composition root (`apps/server/src/retention.ts` passes `openDelegationFilter` exported from the `delegation` index). The hooks pattern already does this for writes; this is the read-side twin.
- **D5 Generated graph.** `bun run graph:modules` (a script over the ESLint import graph or madge's JSON) writes `docs/diagrams/module-graph.md` (Mermaid) and `docs/diagrams/module-graph.json`. A unit test loads the JSON and the allowed-edge list and fails on a new edge. `docs/modules.md` §2 keeps the prose and links the generated file.
- **D6 Standards now, seams later.** Add to `docs/code-patterns.md` and the styleguide: borders are linted (with the layer list); file size about 400 lines and one aggregate; registries over if-chains; comments name rules, ADRs or ticket paths, never bare codes; a flaky test is quarantined the same day (F093 adds it; keep one wording); a new table with `org_id` joins the tenant-filter test, the organization delete and the DSR map; new CLIs call a service. The flag, notice, LLM-role and log standards go in with F087, F088, F090 and F089.
- Open questions of the author, answered here: zones or `eslint-plugin-boundaries` → zones (D8); `testmail` to `tools/` now or in E2a → E2a (D13).

### Decisions of this planning job (2026-11-13)

Each one refines D1–D6 after a fact check. "Default" marks a choice that the owner may still change; it is listed in [questions.md](questions.md).

- **D7 Layer data in JSON: `apps/server/src/modules/layers.json`.** D1 allows a JSON. `eslint.config.js` runs under Node (`node_modules/eslint/bin/eslint.js` starts with `#!/usr/bin/env node`); a `.ts` import there depends on the Node version of each machine and of CI. JSON is read by `eslint.config.js` (`readFileSync` + `JSON.parse`) and by the Bun tests. Fields: `layers` (module names, lowest layer first; `platform` and the roots are fixed in code, not in the file), `sameLayerEdges` (`{ from, to, why }`), `rootDeepImportExceptions` (`{ file, why }`). Rejected: `layers.ts` (Node cannot import it on every machine).
- **D8 One rule: `import/no-restricted-paths` zones, generated.** One zone per ordered module pair: a permitted pair gets `except: ["./index.ts"]` (only the index may be imported), a forbidden pair gets no `except` (nothing may be imported). The rule resolves each import to a file, so it catches deep imports, `import type`, `export … from` and `import()` (probe P1). Rejected: the `no-restricted-imports` pattern `../*/!(index)` (a path pattern cannot tell a sibling folder of the same module, `mail/imap/`, from another module, and a later flat-config block replaces the options of the four SDK blocks); `eslint-plugin-boundaries` (a new dependency and a `bun.lock` change; the zones need about 40 lines).
- **D9 No `import/no-cycle`.** It ignores type-only imports (its docs, line 25), and the broken `config → actions` edge is type-only. It also reports the 9 cycles inside one module (out of scope) and has no per-folder filter. A cycle between two modules cannot pass the zones: every permitted edge goes to a lower layer or along `sameLayerEdges`, and the stage 04 test fails when `sameLayerEdges` or the generated graph has a cycle. The cycle fixture of the acceptance fails with `import/no-restricted-paths` (probe P1).
- **D10 Three more same-layer edges (default).** D1 names three same-layer pairs; the code has three more today, and all three are acyclic: `tenancy → audit`, `mail → config`, `channels → reports`. They go into `sameLayerEdges` with their reason. Rejected: one layer per module (it changes the owner's layer list).
- **D11 Test files are outside the borders (default).** The zone block ignores `**/*.test.ts`, and the graph does not count them. Tests assemble modules like a composition root does: `mail/views.test.ts` imports `../actions`, and `apps/server/test/` imports module internals 138 times. The lint covers only `apps/server/src/**/*.ts` and `packages/**/*.ts`.
- **D12 Two e2e seed scripts keep their deep import (default).** `scripts/e2e-seed.ts` and `scripts/e2e-activity-rows.ts` import `insertMailbox`, `insertCredentials`, `insertInboxFolder` from `../modules/mail/repo` to seed test data. They are named in `rootDeepImportExceptions` and ignored by the zone block. Rejected: export raw credential inserts from the `mail` index (a wider public API only for a test seed).
- **D13 `testmail` stays in `modules/` (layer 4).** The E2a ticket that replaces AgentMail moves it to `tools/`. Today no module imports it.
- **D14 The keep rule is a typed, required function.** D4's `Expression<SqlBool> | null` becomes `keep: PayloadKeepRule`, with `type PayloadKeepRule = (eb: ExpressionBuilder<DB, "actions">, ctx: TenantContext) => Expression<SqlBool>`, defined in `actions/repo.ts` and exported from the `actions` index. `delegation` exports `isOpenDelegationDraft: PayloadKeepRule` (the same `EXISTS` subquery as today, moved), and `retention.ts` passes it. Reasons: the typed builder checks the column names (a raw `sql` fragment that names `actions.id` does not); "required" makes typecheck stop a caller that forgets the rule (the pattern of `SettingsDeps.expireReady`); `null` has no caller. Behaviour does not change: the SQL is the same.
- **D15 The graph builder uses the TypeScript compiler, no new tool.** `ts.preProcessFile(text, true, true)` lists every import, `import type`, `export … from` and `import()` (probe P4). A relative import that resolves into another module folder is an edge. madge is not a dependency (it runs as `bunx madge@8.0.0` for the one-time acceptance check only). Rejected: madge's JSON (a download on every run and in CI).
- **D16 Generated files are formatted with Prettier.** `lint-staged` runs `prettier --write` on staged `.md` and `.json` files, so the generator formats its output with the repo Prettier config (`resolveConfig` + `format`, probe P5). Otherwise a commit would change the files and the freshness test would fail.
- **D17 Five stages, not four.** The `[risky]` retention change (data integrity: an open delegation must keep its draft payload) is a stage of its own, as the plan-task rule says. The 07 table says 4 stages; the count changes, the content does not.
- **D18 The flaky-test rule is F093's wording.** Stage 05 does not write it again. If `docs/code-patterns.md` has no quarantine rule when stage 05 starts, the worker stops and reports it (F093 must be in `done/` first).

A gap or a deviation that a worker finds is a question in its final message, not a choice. The coordinator decides from this "Input" or asks the owner.

## Facts checked (2026-11-13, at commit `cb3a447`)

- Probes ran in `.probe-f086/` in this worktree (deleted before the commit; their code is in the stage files).
- Cross-module imports (grep of `from "(../)+<module>"` in non-test files of `apps/server/src/modules`, and the TypeScript probe P4): 36 module edges; the only deep one is `actions → delegation/repo`. The list matches `plan.md` of the author. Same-layer edges under D1: `tenancy → audit`, `mail → config`, `triage → actions`, `triage → delegation`, `delegation → actions`, `channels → reports` (D10).
- `platform` imports no module (grep of `modules/` in `apps/server/src/platform`: no hit). `packages/core` imports nothing from `apps/`.
- Roots with deep imports: only `scripts/e2e-seed.ts:10` and `scripts/e2e-activity-rows.ts:6` (D12). Test files with a higher-layer import: `modules/mail/views.test.ts:4` (D11).
- **P1 (zones probe).** A probe config (`eslint.config.js` + one block with generated zones, D8) on `apps/server/src` and `packages`: exactly 2 errors, `actions/repo.ts:14` and `config/service.ts:19` (the second is an `import type`). Under Bun, `new ESLint({ cwd, overrideConfigFile }).lintText(code, { filePath })` with a virtual file path in a module folder: deep import, higher layer, mail→triage (cycle), actions→triage (same-layer reverse), `import type`, `export … from`, `import()`, subfolder (`channels/telegram/` → `../../actions/undo`), module → root, platform → module, root deep import: each gives one `import/no-restricted-paths` error; `../mail` from `triage`, `./modules/mail` from a root: no error. 15 cases in 1.4 s.
- `import/no-restricted-paths` (eslint-plugin-import 2.31.0, `lib/rules/no-restricted-paths.js:88`): `basePath` defaults to `process.cwd()`, so the config must set `basePath: __dirname`. A zone `from` list must be all globs or all paths: a mix fails every file with "Restricted path `from` must contain either only glob patterns or none".
- Full `bun run lint` time: 13.4 s now, 13.7 s with the zones (probe config, `.probe-f086` ignored).
- `import/no-cycle` docs (`node_modules/eslint-plugin-import/docs/rules/no-cycle.md:25`): "This rule ignores type-only imports" (D9).
- **P2 (madge).** `bunx madge@8.0.0 --circular --extensions ts --ts-config apps/server/tsconfig.json apps/server/src`: 18 cycles, 9 of them across modules, all through `config/service.ts → actions/index.ts`. The review counted 10 cycles with another madge run; same root edge. madge exits 1 when it finds any cycle. With only the `config/service.ts:19` import removed (a copy of `src`): 9 cycles, 0 across modules. With both imports removed: the same 9 in-module cycles: `actions/apply ↔ drafts`, `actions/apply ↔ send`, `mail/repo ↔ sync-rules`, `triage/classifier ↔ prompts/classifier-v2`, and 5 in `platform/llm/` (`client`, `providers/index`, `gemini`, `openai`). They stay (out of scope).
- The cross-module awk filter of stage 01 § Check printed 9 lines on the madge log of today and 0 on the log of the fixed copy.
- **P4 (graph probe).** `ts.preProcessFile(text, true, true).importedFiles` returns `./a`, `./b`, `./c`, `./d`, `./e` for `import type`, `export {} from`, `export * from`, `import()` and a bare `import "./e"`. A walk over `apps/server/src/modules` with it gives the same 36 edges as grep.
- **P5 (Prettier).** `resolveConfig("docs/diagrams/module-graph.json")` + `format(text, { ...config, filepath })` works under Bun from the repo root (Prettier 3.6.2, the `.prettierrc.json` with the Astro plugin). JSON pairs format as `["actions", "audit"]` on one line.
- `ExpireFilter` (`actions/repo.ts:1022`) is used by `actions/expire.ts:11,19`, exported at `actions/index.ts:88`, imported by `config/service.ts:19,39`. No test imports it. `MailboxActionType` is in `packages/core/src/triage/planners.ts:11`.
- `openDelegationFilter` (`delegation/repo.ts:16`) is used at `actions/repo.ts:1728` (inside `clearActionPayloads`, an `EXISTS` over `delegations` with `whereRef("delegations.draft_action_id", "=", "actions.id")` and `delegations.org_id = ctx.orgId`) and `delegation/repo.ts:546`. `clearActionPayloads` callers: `retention.ts:84` (via `Clearers`), `test/integration/retention-clear.test.ts:307,326,366,371,403`. `retention-job.test.ts` has no open delegation with an old draft (its delegation drafts are 1 day old, line 262), so the wiring of the keep rule is not tested yet; stage 02 adds that test.
- Node v26.13.1 and Bun 1.4.4 on this machine; CI uses Bun 1.3.14 for lint and tests (`.github/workflows`).
- `docs/modules.md` §2 holds a hand-drawn Mermaid block after the line `Module dependencies (arrow = "uses"):` (lines 71–129) and prose lines per edge (lines 131–151). `.agents/limen/styleguide.md`: 39 lines. `docs/code-patterns.md`: 101 lines.
- The organization delete and the DSR map do not exist yet (E7-T3, `05-execution-plan.md` §2.1 row 12). What exists: the `tenant filter` describe blocks in the repository integration tests (`actions-repo.test.ts:552`, `delegation-repo.test.ts:378`, `tenancy-organization.test.ts:170`, `config-rules.test.ts:199`), `delete_mailbox` (`db/migrations/20261111000001_delete_mailbox.sql`) with `test/integration/delete-mailbox.test.ts`, and the retention map in `docs/architecture.md` §7.

## Not verified

- ESLint's Node API under Bun 1.3.14 (CI). Probe P1 ran on Bun 1.4.4. Stage 03 proves it by the CI run of its landed commit; if the test fails only in CI, the worker of the next stage reports it.
- That F093 put the quarantine rule into `docs/code-patterns.md` § Tests and the styleguide. Stage 05 checks it first (D18).
- That no branch which lands between F086 stage 03 and its own rebase adds a forbidden import. The coordinator checks it (§ "How to run").

## Done when

1. `bun run lint` is clean on the repo, and `apps/server/src/modules/borders.test.ts` (in `bun run test:unit`) proves that the lint fails with `import/no-restricted-paths` on a deep import, a higher-layer import, a cycle between two modules, and an `import type` across a forbidden pair.
2. `grep -n "delegation/repo" apps/server/src/modules/actions/*.ts` and `grep -n 'from "../actions"' apps/server/src/modules/config/*.ts` print nothing; the madge filter of stage 01 prints 0 lines.
3. `bun run graph:modules` writes `docs/diagrams/module-graph.md` and `.json`; a second run changes nothing (`git status --short docs/diagrams` is empty); `apps/server/src/modules/layers.test.ts` fails on an edge that `layers.json` does not permit and on a stale generated file.
4. `docs/code-patterns.md` § "Layers and borders" and the styleguide hold the layer list and the D6 standards; `docs/modules.md` §2 has no hand-drawn edge list and links the generated graph.
5. Retention keeps the applied draft payload of an open delegation through the job (`retention-job.test.ts`), and `bun run test:int` passes.

## Rules for every stage

- Read `ticket.md`, this file and your one stage file. Build only your stage. A gap or a deviation is a question in your final message, not a choice.
- No behaviour change. The only SQL that moves is the `EXISTS` subquery of stage 02, unchanged.
- Format only the files of your stage (`bunx prettier --write <files>`). Never run `bun run format` or `prettier --write .` (an S2 builder did, and the diff touched hundreds of files).
- No temporary files inside the worktree: `bun run lint` lints every `.ts` file in it. Use `/tmp/f086-sNN/`.
- Comments in new or changed lines state the rule in one sentence and name an ADR or a ticket folder path if a source is needed. No bare codes (`D29`, `S4`, `A23`, `F083`) in new comments (the standard of stage 05).
- No secret, `.env` value, mail text or address in a log line, a test name or a commit message.
- `bun run test:int` runs in your own DB (the prepare script makes it); no lock needed. Do not run `bun run test:e2e`.
- No migration, no `bun.lock` change, no new dependency. `bunx madge@8.0.0` runs from the cache of `bunx` and does not touch `bun.lock`; check `git status --short bun.lock` after it.
- Before each commit: `git diff --staged`; look for bugs, secrets, debug code and changes outside the stage.

## Proof

Each stage ends with this chain, after its last commit, with nothing after it (replace `NN`):

```
mkdir -p /tmp/f086-sNN && bun run lint > /tmp/f086-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f086-sNN/typecheck.log 2>&1 && bun run test:unit > /tmp/f086-sNN/unit.log 2>&1 && bun run test:int > /tmp/f086-sNN/int.log 2>&1 && echo PROOF_OK
```

While it works, a worker runs only the tests of the code it changed. In the final message, list as proven only what a saved log shows.

## Owner checkpoints and owner steps

- Owner checkpoints: none. The plan has no migration, no real system, no send, no deploy.
- Owner steps: none. The owner may confirm or change the defaults in [questions.md](questions.md) at any time before stage 03 (D10–D12 shape `layers.json`).

## Review

- Stage 02 `[risky]` (retention: an open delegation must keep its draft payload) and stage 03 (the lint that every later job runs) get a review job before the land, with the board's reviewer (`spec/build.md` § TRACK: Sonnet 5.5, thinking high). The reviewer may run `bun run test:int` at the candidate commit.
- Stages 01, 04, 05 land on the worker's proof.

## Stages

| # | Stage | Risk | File |
| --- | --- | --- | --- |
| 01 | `ExpireFilter` moves to core; `config` stops importing `actions`; madge shows no cross-module cycle | normal | [stages/stage-01-expire-filter-to-core.md](stages/stage-01-expire-filter-to-core.md) |
| 02 | Retention keep rule from the composition root; `actions` stops importing `delegation` | `[risky]` | [stages/stage-02-retention-keep-rule.md](stages/stage-02-retention-keep-rule.md) |
| 03 | `layers.json`, generated `import/no-restricted-paths` zones, the lint fixture test | normal | [stages/stage-03-border-lint.md](stages/stage-03-border-lint.md) |
| 04 | `bun run graph:modules`, the generated graph files, `layers.test.ts`, `docs/modules.md` §2 | normal | [stages/stage-04-module-graph.md](stages/stage-04-module-graph.md) |
| 05 | The standards in `docs/code-patterns.md` and `.agents/limen/styleguide.md` | normal | [stages/stage-05-standards.md](stages/stage-05-standards.md) |

All stages run in order, one at a time. Each needs the one before it: 03 needs a clean lint (01, 02); 04 reads `layers.json` (03); 05 names the files of 03 and 04.

## How to run (coordinator)

1. Start only when F093 is in `spec/features/done/` and no other Stage 2 ticket is in build. Move this folder to `spec/features/active/` and commit it before the first spawn.
2. For each stage NN in order (land stage NN before you spawn NN+1):

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F086" \
  'Implement F086 stage NN. Read spec/features/active/F086-module-borders/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: mkdir -p /tmp/f086-sNN && bun run lint > /tmp/f086-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f086-sNN/typecheck.log 2>&1 && bun run test:unit > /tmp/f086-sNN/unit.log 2>&1 && bun run test:int > /tmp/f086-sNN/int.log 2>&1 && echo PROOF_OK. In the final message, list as proven only what a saved log shows.'
```

3. Stages 02 and 03: start a review job on the stage branch before the land (`limen spawn --review --branch <stage branch> …` with the reviewer model). Land with `limen land --keep-open`; the land of stage 05 closes the ticket.
4. Before the land of stage 03: list the open job branches (`limen jobs`). After the land, tell each open job to rebase and run `bun run lint`: a branch that adds a cross-module import may now fail. F082 (active) is the known case.
5. After each land, drop the job DB (`bun run db:worktree <name> --drop` from the main checkout, name printed by the prepare script).
6. After the land of stage 03, check the CI run of `master` (Not verified: ESLint under Bun 1.3.14).

## Planning progress

- [written] stage 01 · [written] stage 02 · [written] stage 03 · [written] stage 04 · [written] stage 05
- [pending] cold review (`plan-review-1.md`)

## Cold review

Pending.

## Log

- 2026-11-13: plan written by a planner job (Opus 5.5) from the author's input; probes P1–P5.
