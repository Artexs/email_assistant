# F086 stage 03 — The border lint: `layers.json`, generated zones, fixture test

Part of [`../plan.md`](../plan.md). Decisions: D1, D7, D8, D9, D10, D11, D12, D13. Needs stages 01 and 02 landed (without them the lint has 2 errors). Three steps.

## Step 1 — The layer data

**Goal.** One file holds the module layers and the allowed same-layer edges (D1, D7).

**Files.** New: `apps/server/src/modules/layers.json`.

**Interfaces.** Exactly this content (Prettier formats it; run `bunx prettier --write apps/server/src/modules/layers.json`):

```json
{
  "$comment": "Server module layers, lowest first. platform sits below layer 1; the composition roots (apps/server/src/*.ts, apps/server/src/scripts/) sit above the last layer. A module imports only the index.ts of a module in a lower layer, or of a module in its own layer when sameLayerEdges names the pair. Read by eslint.config.js and apps/server/src/modules/layers.test.ts. Rules: docs/code-patterns.md § Layers and borders.",
  "layers": [
    ["audit", "tenancy"],
    ["config", "mail"],
    ["triage", "actions", "delegation"],
    ["reports", "channels", "testmail"]
  ],
  "sameLayerEdges": [
    { "from": "tenancy", "to": "audit", "why": "Organization settings changes write their audit row in the same transaction." },
    { "from": "mail", "to": "config", "why": "Connecting a mailbox inserts its default settings; the mailbox views read the settings." },
    { "from": "triage", "to": "actions", "why": "The triage worker writes the planned actions in its transaction." },
    { "from": "triage", "to": "delegation", "why": "The triage worker creates delegations and detects a delegate's reply." },
    { "from": "delegation", "to": "actions", "why": "The chaser plans reminder actions; the service closes reminder sends." },
    { "from": "channels", "to": "reports", "why": "The digest job and /status build the digest text from reports." }
  ],
  "rootDeepImportExceptions": [
    { "file": "scripts/e2e-seed.ts", "why": "E2E test seed: writes a mailbox, its credentials and its inbox folder with the mail repository." },
    { "file": "scripts/e2e-activity-rows.ts", "why": "E2E test seed: writes an inbox folder with the mail repository." }
  ]
}
```

**Decisions.** D7, D10 (the three edges D1 did not name: `tenancy → audit`, `mail → config`, `channels → reports`), D12, D13 (`testmail` in the last layer).

**Test.** Covered by step 3 and by stage 04.

**Check.** `bun -e 'console.log(Object.keys(JSON.parse(await Bun.file("apps/server/src/modules/layers.json").text())))'` prints `[ "$comment", "layers", "sameLayerEdges", "rootDeepImportExceptions" ]`.

**Done when.** The file exists with this content.

**Out of scope.** Moving `testmail` (E2a).

## Step 2 — Generated zones in `eslint.config.js`

**Goal.** `bun run lint` fails on every import across a module border that `layers.json` does not permit (D8).

**Files.** `eslint.config.js`.

**Interfaces.**

Add `import { readdirSync, readFileSync } from "node:fs";` to the imports (import order: builtin group, before `node:path`). Below the line `const gitignorePath = …`, add:

```js
// Module borders (docs/code-patterns.md § Layers and borders). The layer list lives once, in layers.json.
const serverSrc = "apps/server/src";
const layersFile = path.resolve(__dirname, serverSrc, "modules/layers.json");
const borders = JSON.parse(readFileSync(layersFile, "utf8"));

// One zone per ordered module pair: a permitted pair may import only the index.ts, a forbidden pair nothing.
// The rule resolves each import to a file, so it also catches `import type`, `export … from` and `import()`.
function borderZones() {
  const layerOf = new Map(borders.layers.flatMap((names, index) => names.map((name) => [name, index])));
  const folders = readdirSync(path.resolve(__dirname, serverSrc, "modules"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const missing = folders.filter((name) => !layerOf.has(name));
  if (missing.length > 0) {
    throw new Error(`Modules without a layer in ${layersFile}: ${missing.join(", ")}`);
  }
  const sameLayer = new Set(borders.sameLayerEdges.map(({ from, to }) => `${from}>${to}`));
  const moduleDir = (name) => `${serverSrc}/modules/${name}`;
  // Globs only: a `from` list that mixes globs and plain paths is an error of the rule.
  const roots = [`${serverSrc}/*.ts`, `${serverSrc}/scripts/**`];
  const zones = [];
  for (const [name, layer] of layerOf) {
    for (const [other, otherLayer] of layerOf) {
      if (other === name) continue;
      const permitted = otherLayer < layer || sameLayer.has(`${name}>${other}`);
      zones.push(
        permitted
          ? {
              target: moduleDir(name),
              from: moduleDir(other),
              except: ["./index.ts"],
              message: `Import ${other} only through its index.ts.`,
            }
          : {
              target: moduleDir(name),
              from: moduleDir(other),
              message: `${name} may not import ${other}: it is in a higher layer, or in the same layer without a sameLayerEdges entry (apps/server/src/modules/layers.json).`,
            }
      );
    }
    zones.push({ target: moduleDir(name), from: roots, message: "A module never imports a composition root or a script." });
    zones.push({
      target: [`${serverSrc}/*.ts`, `${serverSrc}/scripts/**/*.ts`],
      from: moduleDir(name),
      except: ["./index.ts"],
      message: `Import ${name} only through its index.ts.`,
    });
  }
  zones.push({
    target: `${serverSrc}/platform`,
    from: [`${serverSrc}/modules/**`, ...roots],
    message: "platform imports no module and no composition root.",
  });
  zones.push({ target: "packages", from: "apps", message: "packages never import apps." });
  return zones;
}
```

In the `export default tseslint.config(…)` list, directly after `nodeConfig,` (the block that registers the `import` plugin), add:

```js
  {
    files: [`${serverSrc}/**/*.ts`, "packages/**/*.ts"],
    // Tests assemble modules like a composition root; the e2e seed scripts write test rows with a repository.
    ignores: ["**/*.test.ts", ...borders.rootDeepImportExceptions.map(({ file }) => `${serverSrc}/${file}`)],
    rules: { "import/no-restricted-paths": ["error", { basePath: __dirname, zones: borderZones() }] },
  },
```

Keep the SDK blocks (`restrictImports`) as they are: they use another rule, so they do not conflict.

**Decisions.** D8 (zones only), D9 (no `import/no-cycle`), D11 (tests ignored), D12. `basePath: __dirname` is required: the rule resolves zone paths against `process.cwd()` by default (plan § Facts).

**Test.**

1. `bun run lint` exits 0 on the repo (stages 01 and 02 removed the 2 violations; probe P1 found no other).
2. Temporarily add `import { getMailbox } from "../mail/repo";` to the top of `apps/server/src/modules/triage/service.ts`, run `bunx eslint apps/server/src/modules/triage/service.ts`: one `import/no-restricted-paths` error. Revert the line (`git diff --stat` is empty for that file afterwards).
3. Temporarily create the folder `apps/server/src/modules/zz-probe/` with an empty `index.ts`, run `bun run lint`: it fails with "Modules without a layer in …: zz-probe". Delete the folder.

**Check.** `bun run lint > /tmp/f086-s03/lint.log 2>&1; echo $?` prints `0`; the timing line of `time bun run lint` is in the final message (about 14 s today).

**Done when.** Tests 1–3 hold; the probe edits of tests 2 and 3 are gone.

**Out of scope.** Border rules for `apps/web` and `tools/`. Cycles inside one module.

## Step 3 — The fixture test

**Goal.** A unit test proves each acceptance line of the lint with a fixture, and proves that permitted imports pass (no false positives).

**Files.** New: `apps/server/src/modules/borders.test.ts` (runs in `bun run test:unit`, which includes `apps/server/src`).

**Interfaces.** The test lints virtual files with ESLint's Node API; nothing is written to disk (probe P1):

```ts
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const eslint = new ESLint({ cwd: repoRoot });

async function borderErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
  expect(result?.messages.filter((message) => message.fatal)).toEqual([]);
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "import/no-restricted-paths")
    .map((message) => message.message);
}
```

Each fixture is a `test(...)` with a 30 000 ms timeout (the first `lintText` loads the config). Fixture file names are `__border-fixture.ts` in the named folder; the files do not exist on disk. Each code string ends with `\n` and has one import plus `export const x = <name>;` (or `export type X = <name>;` for a type).

| # | Virtual file (under `apps/server/src/`) | Code | Expected border errors |
| --- | --- | --- | --- |
| 1 | `modules/triage/__border-fixture.ts` | `import { getMailbox } from "../mail/repo";` | 1, message contains `Import mail only through its index.ts` (acceptance: deep import) |
| 2 | `modules/audit/__border-fixture.ts` | `import { recordFeedback } from "../triage";` | 1, message contains `audit may not import triage` (acceptance: higher layer) |
| 3 | `modules/mail/__border-fixture.ts` | `import { recordFeedback } from "../triage";` | 1, message contains `mail may not import triage` (acceptance: a cycle between two modules: `triage → mail` exists in the code, so this edge closes a cycle) |
| 4 | `modules/actions/__border-fixture.ts` | `import { recordFeedback } from "../triage";` | 1, message contains `actions may not import triage` (a same-layer reverse edge: `triage → actions` is permitted, so this one closes a cycle) |
| 5 | `modules/mail/__border-fixture.ts` | `import type { ActionsScope } from "../actions";` | 1 (a type-only import counts) |
| 6 | `modules/channels/telegram/__border-fixture.ts` | `import { undo } from "../../actions/undo";` | 1 (a deep import from a subfolder) |
| 7 | `modules/mail/__border-fixture.ts` | `import { createRetentionJob } from "../../retention";` | 1, message contains `never imports a composition root` |
| 8 | `platform/__border-fixture.ts` | `import { getMailbox } from "../modules/mail";` | 1, message contains `platform imports no module` |
| 9 | `scripts/__border-fixture.ts` | `import { insertInboxFolder } from "../modules/mail/repo";` | 1 (a root imports a module only through its index) |
| 10 | `modules/triage/__border-fixture.ts` | `export { getMailbox } from "../mail/repo";` | 1 (a re-export counts) |
| 11 | `modules/triage/__border-fixture.ts` | `import { getMailbox } from "../mail";` | 0 (lower layer, index) |
| 12 | `modules/triage/__border-fixture.ts` | `import { createPlanned } from "../actions";` | 0 (same layer, permitted pair) |
| 13 | `modules/mail/__border-fixture.ts` | `import { getMailbox } from "./repo";` | 0 (inside the own module) |
| 14 | `scripts/__border-fixture.ts` | `import { getMailbox } from "../modules/mail";` | 0 (root, index) |

Group them as `describe("module borders: the lint fails", …)` (1–10) and `describe("module borders: the lint passes", …)` (11–14). Name each test by what it proves, for example "a deep import into another module".

**Decisions.** D8, D9 (cases 3 and 4 are the cycle proof), D11.

**Test.** `bun test apps/server/src/modules/borders.test.ts` passes: 14 tests.

**Check.** Mutation check, then revert: in `layers.json`, add `{ "from": "actions", "to": "triage", "why": "probe" }` to `sameLayerEdges`; case 4 now fails. Remove the entry (`git diff apps/server/src/modules/layers.json` is empty).

**Done when.**

- 14 tests pass; the mutation check failed case 4 and is reverted.
- The Proof of `plan.md` ends with `PROOF_OK` (`NN` = `03`).
- A review job checks the stage before the land (plan § Review).

**Out of scope.** The graph and `layers.test.ts` (stage 04). Docs (stages 04 and 05).
