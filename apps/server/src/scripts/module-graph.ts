import { writeFileSync } from "node:fs";
import path from "node:path";

import { runCli, type CliSpec } from "../platform/cli";

import {
  formatFor,
  graphPaths,
  loadLayers,
  readModuleGraph,
  renderGraphJson,
  renderGraphMarkdown,
} from "./lib/module-graph-build";
import { cliDescriptions, parseModuleGraphArgs } from "./module-graph-args";

// Writes docs/diagrams/module-graph.{json,md} from the imports in apps/server/src/modules. No DB, no env.
const main: CliSpec["main"] = async (argv, out) => {
  parseModuleGraphArgs(argv);
  const paths = graphPaths(path.resolve(import.meta.dir, "../../../.."));
  const graph = readModuleGraph(paths.modulesDir);
  const layers = loadLayers(paths.layersFile);
  writeFileSync(paths.json, await formatFor(paths.json, renderGraphJson(graph)));
  writeFileSync(paths.markdown, await formatFor(paths.markdown, renderGraphMarkdown(graph, layers)));
  out.print(`module graph: ${graph.modules.length} modules, ${graph.edges.length} edges`);
  return 0;
};

if (import.meta.main) {
  await runCli({ prefix: "module-graph", descriptions: cliDescriptions, main });
}
