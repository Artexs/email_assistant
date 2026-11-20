import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runCli, type CliSpec } from "../platform/cli";

import { checkSimCompose } from "./lib/sim-compose-rules";
import { cliDescriptions, parseSimCheckArgs } from "./sim-compose-check-args";

// Usage: bun run sim:check [compose file]. Default: deploy/compose.sim.yaml. CI runs it (job `image`). It never prints a value of the file.
const DEFAULT_FILE = resolve(import.meta.dir, "../../../../deploy/compose.sim.yaml");

const main: CliSpec["main"] = async (argv, out) => {
  const { file } = parseSimCheckArgs(argv);
  let issues: string[];
  try {
    issues = checkSimCompose(Bun.YAML.parse(readFileSync(file ?? DEFAULT_FILE, "utf8")));
  } catch {
    out.fail("the Compose file did not load");
    return 1;
  }
  if (issues.length > 0) {
    for (const issue of issues) out.fail(issue);
    return 1;
  }
  out.print("sim compose ok");
  return 0;
};

if (import.meta.main) {
  await runCli({ prefix: "sim-compose-check", descriptions: cliDescriptions, main });
}
