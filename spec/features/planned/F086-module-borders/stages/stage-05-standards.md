# F086 stage 05 — The standards in `docs/code-patterns.md` and the styleguide

Part of [`../plan.md`](../plan.md). Decisions: D6, D18, D19. Needs stages 03 and 04 landed (the text names their files). Docs only, no code. Two steps.

## Step 1 — `docs/code-patterns.md`

**Goal.** The full rule text of the D6 standards, so a planning session and a worker read the layer list and the rules that a model cannot infer from code.

**Files.** `docs/code-patterns.md`.

**Precondition (D18).** `grep -n -i "quarantin" docs/code-patterns.md .agents/limen/styleguide.md` must print at least one line in each file (F093 wrote the flaky-test rule). If it prints nothing for a file, stop and report it in the final message: F093 is not landed, and this stage does not write the rule a second time.

**Interfaces.** Four edits. Write the text below as given (you may fix line wrap; keep the words).

1. In § "Layout and borders", replace the line "A module exposes one `index.ts`. Other modules import only from it, never from its inner files." with "A module exposes one `index.ts`. Other modules import only from it, never from its inner files. ESLint enforces it (§ Layers and borders)."

2. New section directly after § "Layout and borders" (before § "Ports and adapters"):

```markdown
## Layers and borders

The server modules sit in layers. `bun run lint` fails on an import that crosses a border the wrong way (`import/no-restricted-paths`, zones generated in `eslint.config.js` from `apps/server/src/modules/layers.json`). The list lives once, in that file; this table repeats it for readers.

| Layer | Modules |
| --- | --- |
| roots | the composition roots `apps/server/src/*.ts` (`main.ts`, `web.ts`, `composition.ts`, `retention.ts`) and `apps/server/src/scripts/` |
| 4 | `reports`, `channels`, `testmail` |
| 3 | `triage`, `actions`, `delegation` |
| 2 | `config`, `mail` |
| 1 | `audit`, `tenancy` |
| base | `apps/server/src/platform/`, then `packages/core` |

- A module imports only the `index.ts` of a module in a lower layer, or of a module in its own layer when `sameLayerEdges` in `layers.json` names the pair with its reason. Never an inner file (`../mail/repo`), also not for a type, a re-export or an `import()`.
- A module never imports a composition root or a script. `platform` imports no module. `packages/*` import nothing from `apps/*`.
- A reverse need (a lower module must call a higher one) is a hook interface or a parameter in the lower module, filled in a composition root: `DelegationHooks` in `actions/hooks.ts` (write side), the keep rule `PayloadKeepRule` of `clearActionPayloads` that `retention.ts` fills with `isOpenDelegationDraft` of `delegation` (read side). A shared plain shape goes to `packages/core` (`ExpireFilter`).
- A new module: add its folder name to a layer in `layers.json` (the lint stops with "Modules without a layer" until you do).
- A new or removed import between two modules (also a permitted one): run `bun run graph:modules` and commit `docs/diagrams/module-graph.{md,json}`; `layers.test.ts` fails on a stale graph. On a merge or rebase conflict in these two files, run the command again; do not merge them by hand.
- A new same-layer edge: add `{ from, to, why }` to `sameLayerEdges`. It must not close a cycle: the lint stops on a cycle in `sameLayerEdges`, and `apps/server/src/modules/layers.test.ts` fails on a cycle, on an edge that the layers do not permit, and on a stale generated graph.
- Test files (`*.test.ts`, `apps/server/test/`) are outside the borders: they assemble modules like a composition root. The e2e seed scripts in `rootDeepImportExceptions` may import a repository directly; add no other entry without a reason in its `why`.
- The generated graph: `docs/diagrams/module-graph.md`. The reasons for single edges: `docs/modules.md` §2.

## Size and shape

- A source file stays under about 400 lines and holds one aggregate (one table or one closely tied group of tables). A repository that grows past it becomes `repo/<aggregate>.ts` behind the same module `index.ts`.
- Registries over if-chains: action handlers, notice detectors, notice renderers, LLM roles, prompts and jobs are entries in a typed record keyed by the enum. A test checks the record against the enum and, where one exists, the CHECK list of the migration. A new kind is a new entry, not a new `if` or `case` in a shared function.
- A CLI script that reads or writes the DB parses its arguments, loads config and calls a service function of a module index, the same function a route calls (ADR 0023). It does not query a repository directly. A dev tool that touches no DB (`scripts/module-graph.ts`) is outside this rule. Existing scripts change when they are touched.
```

3. In § "Data access", after the line that starts with "- Every repository function takes a `TenantContext` and filters by `org_id`." and its exception list (before the line "- Retention (S6a): …"), add:

```markdown
- A new table with `org_id`, in the ticket of its migration: a `tenant filter` test for each new repository function (as in `actions-repo.test.ts` and `delegation-repo.test.ts`); a clear function and a row in `docs/architecture.md` §7 if it holds text; and a row in the organization delete and the DSR address map. The last two do not exist yet (E7-T3 builds them); until then, the migration ticket names the table in its plan so E7-T3 finds it.
```

4. In § "Style", add as the last bullet:

```markdown
- A comment states the rule in one sentence. If it needs a source, it names an ADR (`ADR 0014`) or a ticket folder path (`spec/features/done/2026-11/F083-…/`). No bare stage or decision codes (`S3`, `D29`, `U11`, `A23`, `F079`): their plan files move, and no reader can resolve them. Fix the codes of a comment when you change its code; no mass edit.
```

**Decisions.** D6, D18 (the flaky-test rule stays as F093 wrote it), D19 (the new-table rule names what exists and defers the delete and DSR map to E7-T3).

**Test.** Markdown only.

1. `grep -n "## Layers and borders\|## Size and shape" docs/code-patterns.md` prints two lines.
2. `grep -c "layers.json" docs/code-patterns.md` prints at least `3`.
3. The layer table matches `apps/server/src/modules/layers.json` (compare by eye; name each module once).

**Check.** `bunx prettier --check docs/code-patterns.md` passes (run `bunx prettier --write docs/code-patterns.md` first).

**Done when.** Tests 1–3 hold.

**Out of scope.** The flag, notice, LLM-role, locale and log standards (F087, F088, F090, F089 add them with their seams). Rewriting old comments.

## Step 2 — `.agents/limen/styleguide.md`

**Goal.** The short form that Limen injects into every coordinator, worker and reviewer turn.

**Files.** `.agents/limen/styleguide.md`.

**Interfaces.**

- § Shape: replace the bullet that ends "Other modules import only from `index.ts`. No import cycles." with:

  "- Server modules: `apps/server/src/modules/<module>/` with `index.ts` (public API), `service.ts`, `repo.ts`, `routes.ts`, `jobs.ts`, `*.test.ts` next to the code. Layers, lowest first: `platform` → `audit`, `tenancy` → `config`, `mail` → `triage`, `actions`, `delegation` → `reports`, `channels`, `testmail` → composition roots (`apps/server/src/*.ts`, `scripts/`). A module imports only the `index.ts` of a lower layer, or of its own layer when `apps/server/src/modules/layers.json` names the pair. `bun run lint` enforces it; a reverse need is a hook or a parameter filled in a composition root (`docs/code-patterns.md` § Layers and borders). A new module gets a layer in `layers.json`; a new or removed import between modules needs a run of `bun run graph:modules` (on a conflict in its files, run it again)."

- § Prefer: add three bullets at the end:
  - "Files under about 400 lines and one aggregate; a bigger repository becomes `repo/<aggregate>.ts` behind the same index."
  - "Registries (a typed record keyed by the enum, with a test against the enum and the CHECK list) over if-chains for handlers, detectors, renderers, roles, prompts and jobs."
  - "A new table with `org_id` gets tenant-filter tests, retention (if it holds text) and a note for the organization delete and DSR map (`docs/code-patterns.md` § Data access)."

- § Avoid: add two bullets at the end:
  - "Bare codes in comments (`S3`, `D29`, `A23`, `F079`): name the rule, an ADR or a ticket folder path."
  - "A CLI that queries a repository directly: a CLI that uses the DB calls the service function that a route calls."

**Decisions.** D6, D18.

**Test.**

1. `wc -l < .agents/limen/styleguide.md` prints a number under `1000` (39 today; about 47 after).
2. `grep -n "layers.json" .agents/limen/styleguide.md` prints the § Shape bullet.
3. `grep -n -i "quarantin" .agents/limen/styleguide.md` still prints F093's line (not removed, not duplicated).

**Check.** `bunx prettier --check .agents/limen/styleguide.md` passes.

**Done when.**

- Tests 1–3 hold; step 1 tests hold.
- The Proof of `plan.md` ends with `PROOF_OK` (`NN` = `05`). The land of this stage closes the ticket.

**Out of scope.** Other styleguide lines (one stale line says only one checkout runs `test:int`; `CLAUDE.md` now allows parallel runs; leave it for its owner).
