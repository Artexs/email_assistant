# F095 stage 02 — Capability map frame

Part of [`../plan.md`](../plan.md). Decisions P2, D1, D2, D3. Read "Rules for every stage" first.

The folder `docs/capabilities/` exists with its index and rules, a unit test checks every page, and the docs that agents read name the rule. No page is written here (stages 03–07 write them). Three steps.

## Step 1 — `docs/capabilities/README.md`

- **Goal:** one file tells an agent what the map is, the page template and the rule.
- **Files:** new `docs/capabilities/README.md`.
- **Content (write it in this order):**
  1. `# Capability map`
  2. A `>` line: `Agent-facing reference of what the system does now: one page per capability, with rules, entry points, data, limits and decisions. It is not on the public docs site (PD-100). User docs come with E10a.`
  3. `## Rules`, these bullets:
     - `A landed feature updates its capability page in the same change (PD-009). Once the docs site of E10a exists, a landed user-visible feature also updates its user doc page (en) in the same change (PD-100).`
     - `A page states the code at the commit on its "Checked against" line. Plans and gaps go only to "Limits", with the ticket folder or F-number.`
     - `Behaviour detail lives here. \`docs/architecture.md\` keeps goals, context, layout, module rules, ports, invariants, data model, security and deployment, and links here.`
     - `A new capability adds a page and an index row in the same change.`
     - `\`apps/server/src/capability-map.test.ts\` checks the pages: the index, the headings, the "Checked against" line, every repo path, every \`bun run\` script and every ADR number.`
  4. `## Page template`: the template of `plan.md` D2 as a fenced Markdown block (H1, the `> Checked against the code at \`<sha>\`, YYYY-MM-DD.` line, the seven `##` headings with one comment line each saying what goes there, from D2).
  5. `## Pages`: a table `| Page | Capability | Main modules |` with **no rows yet** (header and separator only). Each later stage adds its rows. Under the table one line: `Planned pages (stages 03–07 of \`spec/features/active/F095-e1-close-the-mvp/\`): sync, triage, actions and Undo, drafts and send, delegation, digest and notices, web panel, tenancy and plans, retention, backups.`
- **Decisions:** D1, D2, P2.
- **Test:** step 2 covers it (the README is checked like a page for paths, scripts and ADRs, not for the seven headings).
- **Check:** `bunx prettier --check docs/capabilities/README.md`.
- **Done when:** the file exists in this shape.
- **Out of scope:** any page file.

## Step 2 — `apps/server/src/capability-map.test.ts`

- **Goal:** a renamed file, a wrong script name, a missing ADR or a page without the template fails `bun run test:unit`.
- **Files:** new `apps/server/src/capability-map.test.ts` (one file; helpers inside it, not exported to the app).
- **Interfaces (inside the test file):**

  ```ts
  const ROOT = path.resolve(import.meta.dir, "../../..");           // repo root (check: ROOT/package.json exists)
  const CAP_DIR = path.join(ROOT, "docs/capabilities");
  const SECTIONS = ["What it does now", "Rules", "Entry points", "Data", "Limits", "Decisions", "Tests"] as const;
  const PATH_ROOTS = ["apps/", "packages/", "db/", "deploy/", "docs/", "tools/", "scripts/", "evals/", "spec/"];

  function pathTokens(markdown: string): string[]      // backticked tokens that start with a PATH_ROOT; strip a trailing ":<digits>[-<digits>]" and "#…"; skip tokens with a space, "<", "*", "{" or "$"
  function scriptNames(markdown: string): string[]     // names after "bun run " (regex /bun run ([a-z0-9][a-z0-9:_-]*)/g)
  function adrNumbers(markdown: string): string[]      // /ADR (\d{4})/g
  function indexPages(readme: string): string[]        // file names of rows "| [x.md](x.md) |" in the "## Pages" table
  function pageProblems(markdown: string): string[]    // "no H1", "no checked line", "sections: <found list>" when the "## " headings are not exactly SECTIONS in order
  ```

  The "checked line" regex: `/^> Checked against the code at `[0-9a-f]{7,40}`, \d{4}-\d{2}-\d{2}\.$/m`. A path exists when `existsSync(path.join(ROOT, token))` (a token ending in `/` is a folder).
- **Decisions:** D3.
- **Test (numbered cases, fixed values):**
  1. `pathTokens("see \`apps/server/src/main.ts:85\`, \`docs/x.md#a\`, \`apps/<m>/\`, \`bun run lint\`, \`deploy/\`")` → `["apps/server/src/main.ts", "docs/x.md", "deploy/"]`.
  2. `pathTokens("\`apps/server/src/retention.ts:19-94\`")` → `["apps/server/src/retention.ts"]`.
  3. `scriptNames("run \`bun run org:flag --org-id x\` or bun run lint; bun run --filter x")` → `["org:flag", "lint"]`.
  4. `adrNumbers("ADR 0014 and ADR 0027, not ADR 14")` → `["0014", "0027"]`.
  5. `indexPages("## Pages\n\n| Page | Capability | Main modules |\n| --- | --- | --- |\n| [sync.md](sync.md) | Sync | mail |\n")` → `["sync.md"]`.
  6. `pageProblems(<good fixture>)` → `[]`. Good fixture: `# Sync\n\n> Checked against the code at \`9d9bfb8\`, 2026-11-14.\n\n` plus the seven `## ` headings in order, each followed by one text line.
  7. `pageProblems(<good fixture without "## Limits">)` → one problem that starts with `sections:`.
  8. `pageProblems(<good fixture with "## Data" and "## Rules" swapped>)` → one problem that starts with `sections:`.
  9. `pageProblems(<good fixture with the sha "abc">)` → `["no checked line"]`.
  10. Folder: `readdirSync(CAP_DIR)` minus `README.md`, sorted, equals `indexPages(README)` sorted (zero pages today: both empty).
  11. Folder: for each page, `pageProblems` → `[]` (`expect({ page, problems }).toEqual({ page, problems: [] })`).
  12. Folder: for each file of the folder **and** `README.md`, every `pathTokens` entry exists, every `scriptNames` entry is a key of the root `package.json` `scripts`, and every `adrNumbers` entry has one file `docs/decisions/<n>-*.md`. Name the file and the token in the expectation (pattern of `layers.test.ts`: `expect({ file, token, exists }).toEqual({ file, token, exists: true })`).
- **Check:** `bun test apps/server/src/capability-map.test.ts` → 12 pass, 0 fail.
- **Done when:** the check holds and `bun run lint` and `bun run typecheck` pass.
- **Out of scope:** checking claims against code; a CI job; checking `docs/architecture.md`.

## Step 3 — The rule in the docs that agents read

- **Goal:** every planner and worker learns the PD-009 / PD-100 rule and where behaviour text lives.
- **Files:** `docs/code-patterns.md`, `.agents/limen/styleguide.md`, `docs/architecture.md` (one line), `CLAUDE.md` (one line).
- **Edits:**
  1. `docs/code-patterns.md`: a new section `## Capability map (PD-009)` before `## Tests`, three bullets: (a) `A change that lands a feature or changes behaviour updates \`docs/capabilities/<capability>.md\` in the same change; once E10a exists, a user-visible change also updates its user doc page (en) (PD-100).` (b) `Behaviour rules go to the capability page, not to \`docs/architecture.md\`. A plan that names a section of \`architecture.md\` that now holds a link line writes to the page it links.` (c) `The page template and the index: \`docs/capabilities/README.md\`; \`apps/server/src/capability-map.test.ts\` checks paths, scripts and ADR numbers.`
  2. `.agents/limen/styleguide.md` § Prefer, one bullet: `` - A change that lands behaviour updates its page in `docs/capabilities/` in the same change (PD-009); behaviour rules go there, not into `docs/architecture.md`. ``
  3. `docs/architecture.md`: under the H1, after the existing `>` lines (or as the first `>` line), one line: `` > Behaviour detail per capability (rules, entry points, limits): `docs/capabilities/` (PD-009). This file keeps goals, context, layout, module rules, ports, invariants, data model, security and deployment. ``
  4. `CLAUDE.md`, the line `Architecture and stack: …`: append ` What each capability does now: \`docs/capabilities/\`.`
- **Check:** `grep -n "docs/capabilities" docs/code-patterns.md .agents/limen/styleguide.md docs/architecture.md CLAUDE.md` → at least one line per file. `wc -l .agents/limen/styleguide.md` ≤ 1000.
- **Done when:** the check holds.
- **Out of scope:** `docs/product/stage-2/*`; the E10a user doc rule beyond the sentence above.

## Review focus

Test cases 1–12 exist with the fixed values; the helpers skip placeholders (`<`, `*`, `{`, `$`, space) so later pages can name templates; the README template matches D2 exactly (a later page that follows the README must pass `pageProblems`).

## Done when

- Steps 1–3 hold.
- The Proof command of `plan.md` (stage 02 form, files: `docs/capabilities/README.md docs/code-patterns.md .agents/limen/styleguide.md docs/architecture.md CLAUDE.md`) prints `PROOF_OK`.
