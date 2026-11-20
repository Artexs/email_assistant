import { runCli, type CliRawOutput } from "../platform/cli";

import { runSim } from "./lib/sim-commands";
import { cliDescriptions, parseSimArgs } from "./sim-args";

// The output is for the agent, not a log line: it goes to stdout and holds counts, ids and codes only.
export async function main(argv: string[], out: CliRawOutput): Promise<number> {
  const cmd = parseSimArgs(argv);
  const result = await runSim(cmd);
  if (result.lines.length > 0) out.write(`${result.lines.join("\n")}\n`);
  return result.code;
}

if (import.meta.main) {
  await runCli({ prefix: "sim", descriptions: cliDescriptions, main });
}
