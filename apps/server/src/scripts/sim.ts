import { describeError } from "../platform/errors";

import { parseSimArgs, usage } from "./sim-args";
import { runSim } from "./sim-commands";

// The output is for the agent, not a log line: it goes to stdout and holds counts, ids and codes only.
async function main() {
  const cmd = parseSimArgs(process.argv.slice(2));
  if (cmd === undefined) {
    process.stderr.write(`${usage}\n`);
    process.exit(1);
  }
  const result = await runSim(cmd);
  if (result.lines.length > 0) process.stdout.write(`${result.lines.join("\n")}\n`);
  process.exit(result.code);
}

main().catch((error) => {
  process.stderr.write(`sim failed: ${describeError(error)}\n`);
  process.exit(1);
});
