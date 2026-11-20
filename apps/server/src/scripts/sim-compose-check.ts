import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createCliOutput } from "../platform/cli";

import { checkSimCompose } from "./lib/sim-compose-rules";

// Usage: bun run sim:check [compose file]. Default: deploy/compose.sim.yaml. CI runs it (job `image`). It never prints a value of the file.
const out = createCliOutput("sim-compose-check");

const file = process.argv[2] ?? resolve(import.meta.dir, "../../../../deploy/compose.sim.yaml");

let issues: string[];
try {
  issues = checkSimCompose(Bun.YAML.parse(readFileSync(file, "utf8")));
} catch {
  out.fail("the Compose file did not load");
  process.exit(1);
}
if (issues.length > 0) {
  for (const issue of issues) out.fail(issue);
  process.exit(1);
}
out.print("sim compose ok");
