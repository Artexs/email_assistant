import { writeFileSync } from "node:fs";
import path from "node:path";

import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

import {
  formatFor,
  graphPaths,
  loadLayers,
  readModuleGraph,
  renderGraphJson,
  renderGraphMarkdown,
} from "./module-graph-build";

const log = createLog("module-graph");

// Writes docs/diagrams/module-graph.{json,md} from the imports in apps/server/src/modules. No DB, no env.
async function main(): Promise<number> {
  const paths = graphPaths(path.resolve(import.meta.dir, "../../../.."));
  const graph = readModuleGraph(paths.modulesDir);
  const layers = loadLayers(paths.layersFile);
  writeFileSync(paths.json, await formatFor(paths.json, renderGraphJson(graph)));
  writeFileSync(paths.markdown, await formatFor(paths.markdown, renderGraphMarkdown(graph, layers)));
  log.info(`module graph: ${graph.modules.length} modules, ${graph.edges.length} edges`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    log.error(`failed: ${describeError(error)}`);
    process.exit(1);
  }
);
