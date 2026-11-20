import { resolve } from "node:path";

import { renderToolTable } from "@ea/core";

import { type CliSpec, runCli } from "../platform/cli";

import { cliDescriptions, parseCliListArgs } from "./cli-list-args";
import { loadToolRows } from "./lib/cli-tools";

// apps/server/src/scripts → the repository root.
const ROOT = resolve(import.meta.dir, "../../../..");

const main: CliSpec["main"] = async (argv, out) => {
  const args = parseCliListArgs(argv);
  const { rows, missing } = await loadToolRows(ROOT);
  if (args.json) {
    out.json({ tools: rows });
  } else {
    out.write(renderToolTable(rows));
  }
  for (const name of missing) {
    out.fail(`no description for ${name}`);
  }
  return missing.length === 0 ? 0 : 1;
};

if (import.meta.main) {
  await runCli({ prefix: "cli-list", descriptions: cliDescriptions, main });
}
