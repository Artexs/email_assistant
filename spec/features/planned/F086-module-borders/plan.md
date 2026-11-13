# F086 · Module borders: plan input

> Written 2026-11-13 from the architecture review (`docs/product/stage-2/06-architecture-review.md` §3.2, §3.13, §3.14, §7). Input of the `plan-task` session. Ticket: [ticket.md](ticket.md). Runs after F093 (CI green), so the new lint is proven by a green run.

## Facts (2026-11-13)

- `eslint.config.js` restricts only `grammy`, `openai` and `@google/genai`. `eslint-plugin-import` 2.31 is installed; `import/no-cycle` and `import/no-restricted-paths` are available without a new dependency. `eslint-plugin-boundaries` would be a new dependency (one `bun.lock` change).
- Cross-module imports today, from a grep of `from "../<module>"` in `apps/server/src/modules`: `actions → audit, mail, tenancy` (+ `delegation/repo`, deep); `channels → actions, audit, config, delegation, mail, reports, tenancy, triage`; `config → actions (type), audit`; `delegation → actions, audit, config, mail, tenancy`; `mail → audit, config, tenancy`; `reports → actions, audit, config, delegation, mail, tenancy, triage`; `tenancy → audit`; `triage → actions, audit, config, delegation, mail, tenancy`; `audit`, `testmail` import no module.
- `madge --circular` (2026-11-13): 10 cycles; one crosses modules: `actions/index → apply → drafts → expiry → repo → mail/index → connect-request → connect → config/index → routes → service → (type) actions`.
- `ExpireFilter` (`actions/repo.ts:1022`) is a plain shape: `mailboxId`, `emailId?`, `types: MailboxActionType[]`, `category?`, `sends?`. `openDelegationFilter` (`delegation/repo.ts:16`) is a Kysely `sql` fragment used by `actions/repo.ts:1728` (retention of payloads) and `delegation/repo.ts:546`.
- 321 bare codes (`S3`, `D29`, `U11`, `A23`, `F079`) in non-test comments.

## Design decisions

- **D1 Layers as data.** One file `apps/server/src/modules/layers.ts` (or a JSON next to `eslint.config.js`) lists the layers, lowest first: `platform` → `audit`, `tenancy` → `config`, `mail` → `triage`, `actions`, `delegation` → `reports`, `channels` → the composition roots (`main.ts`, `web.ts`, `composition.ts`, `retention.ts`, `scripts/`). `testmail` sits beside `channels` (it is a tool; a later ticket moves it to `tools/`). A module imports only `index.ts` of a module in a lower layer or in its own layer when the allowed-edge list names the pair (`triage → actions`, `triage → delegation`, `delegation → actions`).
- **D2 Lint with what is installed.** `import/no-restricted-paths` zones from the layer list (generated into the ESLint config by a small function, so the list lives once) plus a `no-restricted-imports` pattern `../*/!(index)` for deep imports, plus `import/no-cycle` with `maxDepth` at the module level. If the plan-task session finds the zone list too clumsy, `eslint-plugin-boundaries` is the alternative; it is one dependency and one `bun.lock` change (serialize with other jobs).
- **D3 Fix the type edge by moving the shape.** `ExpireFilter` moves to `packages/core/src/triage/` (it names `MailboxActionType`, which is already in core). `actions` re-exports it for its callers.
- **D4 Fix the deep import by inversion.** `actions` must not know how a delegation is open. The retention clear of payloads (`clearActionPayloads`) takes a predicate parameter `keepPayloadWhere: Expression<SqlBool> | null` from the composition root (`apps/server/src/retention.ts` passes `openDelegationFilter` exported from the `delegation` index). The hooks pattern already does this for writes; this is the read-side twin.
- **D5 Generated graph.** `bun run graph:modules` (a script over the ESLint import graph or madge's JSON) writes `docs/diagrams/module-graph.md` (Mermaid) and `docs/diagrams/module-graph.json`. A unit test loads the JSON and the allowed-edge list and fails on a new edge. `docs/modules.md` §2 keeps the prose and links the generated file.
- **D6 Standards now, seams later.** Add to `docs/code-patterns.md` and the styleguide: borders are linted (with the layer list); file size about 400 lines and one aggregate; registries over if-chains; comments name rules, ADRs or ticket paths, never bare codes; a flaky test is quarantined the same day (F093 adds it; keep one wording); a new table with `org_id` joins the tenant-filter test, the organization delete and the DSR map; new CLIs call a service. The flag, notice, LLM-role and log standards go in with F087, F088, F090 and F089.

## Stages

1. **Repair the two edges.** Files: `packages/core/src/triage/expire-filter.ts` (new) and its export; `actions/repo.ts`, `actions/index.ts`, `config/service.ts`; `actions/repo.ts` `clearActionPayloads` signature, `retention.ts`, `delegation/index.ts`; the retention tests. Check: `bun run typecheck`, `bun run test:int` (retention and expire tests), `madge --circular` shows no cross-module cycle.
2. **The lint.** Files: `eslint.config.js`, the layer list file, three fixture files under `apps/server/test/lint/` with the expected errors, `package.json` (a `lint:fixtures` script if needed). Check: `bun run lint` clean on the repo; each fixture fails with the named rule.
3. **The generated graph and its test.** Files: `scripts/module-graph.ts` (repo root or `apps/server/src/scripts/`), `docs/diagrams/module-graph.{md,json}`, `apps/server/src/modules/layers.test.ts`, `docs/modules.md` §2. Check: the test passes; a fake extra edge in the JSON fails it.
4. **Standards.** Files: `docs/code-patterns.md` (new § "Layers and borders", additions to § Style and § Tests), `.agents/limen/styleguide.md` (§ Shape, § Prefer, § Avoid). Check: the styleguide stays under 1000 lines; `limen` reads it (no format check needed beyond Markdown).

Parallel: stage 1 first (it changes code). Stages 2 and 3 may run at once after it. Stage 4 after 2. No migration. A `bun.lock` change only if D2 picks `eslint-plugin-boundaries`; then that stage runs alone.

## Done when

- The four acceptance lines of the ticket hold, each with its test or command named in the log.
- `docs/modules.md` §2 has no hand-drawn edge list that can go stale.

## Open questions for the plan-task session

- `import/no-restricted-paths` zones or `eslint-plugin-boundaries`: try the installed plugin first; switch only if the config needs more than about 40 lines.
- Whether `testmail` moves to `tools/` in this ticket (small) or in E2a (which replaces its AgentMail parts). Default: E2a.
